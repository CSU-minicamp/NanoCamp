# 个人资料与账号安全

## 页面职责

个人中心沿用论坛侧栏和全站视觉，右上角头像进入资料页 `/forum/me/?tab=profile`；消息入口已迁至论坛侧栏，进入 `/forum/messages/`。

- `/forum/me/?tab=profile`：只编辑公开昵称与简介；展示当前头像、公开主页入口；支持字数提示、取消、未保存离开提示和保存后的即时更新。没有登录邮箱、密码或退出操作。
- `/forum/me/?tab=security`：展示私有登录邮箱、密码状态和当前浏览器退出入口。修改密码表单默认收起。
- `/profile/`：兼容旧地址，跳转到内嵌资料页。
- `/profile/force/`：保留首次资料补全，只在尚未设置密码时提供初始密码字段。已有密码但缺昵称的账号不会出现直接改密字段。

参考的成熟产品模式：[GitHub 公开资料](https://docs.github.com/en/account-and-profile/tutorials/personalize-your-profile)、[GitLab 密码与认证](https://docs.gitlab.com/user/profile/user_passwords/)。身份再次验证及会话处理依据 [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)。本项目仅借鉴职责分离和流程，视觉使用现有设计系统。

## 接口约束

`POST /api/profile` 继续支持昵称、简介和首次密码初始化。已有密码的账号传入 password 会返回 403 `password_change_required`，不能连同其他资料一起绕过改密。条件更新保证并发初始化不会覆盖已设置的密码。

`POST /api/profile/password` 接收 `currentPassword`、`newPassword`、`confirmPassword`。要求有效会话、同源 Origin 和 CSRF；新密码遵循现有 8–72 字符策略，两次输入一致且不同于当前密码。

错误码：

| 错误 | HTTP | 行为 |
| --- | --- | --- |
| current_password_invalid | 403 | 当前密码验证失败 |
| password_mismatch | 400 | 两次输入不一致 |
| password_unchanged | 400 | 新旧密码相同 |
| invalid_password | 400 | 长度不合法 |
| rate_limited | 429 | 同账号 15 分钟内验证失败 5 次，返回 Retry-After |
| unauthenticated | 401 | 会话不存在或已失效 |

改密以用户行锁串行化验证、失败计数、哈希更新和全部会话撤销。验证失败计数要提交，不能随异常回滚。成功后清除浏览器 Cookie 并要求重新登录。密码登录签发会话前再次检查哈希，避免验证旧密码后与改密并发生成旧凭据会话。

## 验证与边界

集成测试覆盖首次初始化、旧接口绕过拒绝、CSRF、错误当前密码、确认不一致、新旧相同、正确改密、多会话失效、新旧凭据登录及失败限流。

浏览器验证资料取消/保存/刷新、桌面与手机布局、错误当前密码反馈、正确改密后重新登录。浏览器安全验证使用临时测试账号，结束后只清理该账号，不改动手工验收角色口令。

头像上传使用独立接口，存储与迁移说明见 [头像接口](avatar-api.md)；资料页提供修改头像、预览、保存、取消及确认恢复默认，失败可重试。当前不提供邮箱更换、MFA、设备列表或忘记密码重置，不展示不可用操作。邮箱验证码登录仍保留，但不能因此绕过已有密码的修改验证。
