# 头像接口与存储迁移

## 初始化

```powershell
npm ci
npm run avatar:migrate
```

依赖 `sharp` 做图片解码、方向纠正、裁剪和重编码。迁移只创建 `avatar_blobs` 和 `user_avatars`，不修改已有用户字段；可重复执行。迁移账号需要 DDL 权限，日常应用账号只需数据读写权限。

## HTTP 契约

| 方法与路径 | 用途 | 权限 |
| --- | --- | --- |
| `PUT /api/profile/avatar` | 上传或替换自己的头像 | 有效会话、资料完整、同源 Origin 和 `x-nc-csrf` |
| `GET /api/profile/avatar` | 查询自己的头像元数据 | 有效会话 |
| `DELETE /api/profile/avatar` | 移除自己的头像、恢复默认 | 同 PUT |
| `GET /api/users/:userId/avatar` | 读取公开头像 | 公开，支持 HEAD、ETag 条件请求 |

PUT 使用**原始图片字节**作为请求体，Content-Type 为 `image/jpeg`、`image/png` 或 `image/webp`。不是 JSON、base64 或 multipart/form-data。最大 2 MiB，最多 16,777,216 输入像素；拒绝动画、SVG、损坏文件和与声明类型不符的文件。归一化为 256×256 WebP，不保留 EXIF 原始元数据；不保存原文件名和客户端提供的路径。

上传/查询/删除均返回元数据，例如：

```json
{
  "url": "/api/users/19/avatar",
  "isDefault": false,
  "version": "normalized-image-sha256",
  "contentType": "image/webp",
  "width": 256,
  "height": 256,
  "size": 12345,
  "updatedAt": "ISO timestamp"
}
```

请求不能指定另一个 userId，服务端始终取当前会话用户。每账号上传/删除合计最多 5 次/分钟。删除不存在的头像仍成功，但计入写入频率。

错误码包括：401 `unauthenticated`；403 `csrf_invalid` / `profile_incomplete`；413 `avatar_too_large`（HTTP 入口也可能直接返回通用 413）；415 `unsupported_image_type`；422 `invalid_image`；429 `rate_limited`；503 `avatar_unavailable`。未注册的存储驱动或其他内部错误返回 500，详情仅写服务端日志。

公开读取不存在用户返回 404，存在但没有自定义头像时 302 到站内默认图。自定义头像响应为 `image/webp`、`nosniff`、`public, no-cache`；ETag 随规范化内容更新，相同 ETag 返回 304。头像地址稳定，前端不感知内部存储位置。上传后客户端若要即时刷新现有 img，可使用 `url + '?v=' + version`；重新加载页面也会重新验证缓存。会话用户对象包含 `avatarUrl`，现有顶栏、帖子、回复、用户主页及个人资料展示已接入。

前端入口位于“我的资料”头像旁的“修改头像”。选择图片后只在本地预览，点击“保存头像”才上传；取消保留原头像。已有自定义头像时提供“恢复默认头像”，需确认后删除。上传失败保留所选图片供重试，保存后同步刷新页面内当前用户头像。选择器会先检查格式、体积、可解码性和像素大小，服务端仍执行完整校验。

浏览器调用例子（参数 file 是文件选择器返回的 File）：

```javascript
async function uploadAvatar(file) {
  const session = await (await fetch('/api/session', {cache:'no-store'})).json();
  const response = await fetch('/api/profile/avatar', {
    method:'PUT',
    headers:{'Content-Type':file.type, 'x-nc-csrf':session.csrf},
    body:file
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
```

## 分层与对象存储迁移

- `backend/avatar-api.mjs`：HTTP、身份、CSRF、状态码及缓存。
- `backend/avatar.mjs`：图片归一化、配额、用户引用替换与清理。
- `backend/avatar-storage.mjs`：存储驱动注册及当前 MySQL 实现。
- `user_avatars`：user_id、storage_driver、storage_key、类型、尺寸、大小、ETag、更新时间，不包含图片内容。
- `avatar_blobs`：当前 MySQL 驱动的 key → MEDIUMBLOB 文件内容。

适配器契约：

```javascript
registerAvatarStore('s3', {
  async put({key, bytes, contentType}) { /* 写入一个新对象；成功后必须立即可读 */ },
  async get(key) { /* 返回 Buffer；对象不存在返回 null，服务异常应抛错 */ },
  async delete(key) { /* 删除；对象不存在也视作成功 */ }
});
```

以后在应用启动时注册真实适配器，将 `data/config.json` 的 `avatarStorage.driver` 改为其名称，即可让新上传写入对象存储。当前只内置 mysql，不能仅填写 s3 配置就认为对象存储已实现；第三方凭据保留在部署配置中。读取始终使用记录自身的 driver，因此新旧存储可共存。

已有头像批量迁移应逐条：读取旧对象 → 写入新随机 key → 校验字节长度/哈希 → 条件更新引用（WHERE user_id、原 driver 和原 key 仍匹配）→ 成功后删除旧对象。条件更新失败意味着用户并发换头像，删除本次迁移副本，不能覆盖用户新头像。仅复制原始规范化 WebP，不重新生成内容，保持 ETag 与公开 URL 稳定。批量迁移命令将在实际选择对象存储供应商后实现。

替换采用“先写新对象、提交引用、再清旧对象”。写入或引用提交失败时尝试清理新对象并保留旧引用；旧对象清理失败不会回滚已成功的新头像，日志 `[avatar:cleanup]` 用于补偿。跨 MySQL 与未来对象存储无法做共同事务，进程崩溃可能留下未引用对象；上线对象存储时应配置带安全时间窗口的孤儿对象巡检，不能盲删正在上传的对象。头像存储错误返回不可用，不悄悄伪装成默认头像。

## 验证

`node --test tests/avatar.test.mjs` 使用本地 MySQL 和独立测试账号，验证权限、文件校验、像素限制、BLOB 内容、ETag/HEAD、替换清理、限流失败、存储失败、混合驱动读取和恢复默认；结束只清理本次测试数据。内存对象存储适配器用于验证替换契约，不代表真实云服务已联调。
