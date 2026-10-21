# backend/

站点服务端。**不用框架、不用构建、没有 npm 之外的依赖**（只有 `mysql2`），
`node backend/main.mjs` 就是全部。

页面在请求到达时由 `src/` 渲染成 HTML —— 这个目录只负责：解析地址、挑渲染函数、发响应、
以及账号体系（会话 / 验证码 / 密码 / 限流）。

---

## 1. 文件职责

| 文件 | 只做这一件事 | 不做什么 |
|---|---|---|
| `main.mjs` | 监听端口、读请求体、算客户端 IP、收日志、优雅退出 | 不判断业务、不读页面 |
| `app.mjs` | 路由分发（三张表）、渲染缓存、401/303/404/500 的响应形态 | 不写 SQL、不碰 cookie 语义 |
| `api.mjs` | `/api/*`：cookie 解析、CSRF 校验、JSON 解析、错误码映射 | 不判断验证码对错、不做业务决策 |
| `auth.mjs` | 身份规则：发码、验码、密码登录、会话、必填项、限流 | 不发信、不碰 HTTP |
| `db.mjs` | 连接池、`select()` / `execute()`、建表语句、连通性探活 | 不写业务 SQL |
| `mail.mjs` | 投递适配器（resend / console） | 不写邮件文案 |
| `config.mjs` | **唯一**的配置读取入口 | 不自己打日志 |
| `base.mjs` | `public/` 静态资源、MIME、路径逃逸防护 | 不碰页面路由 |

> 邮件文案在 `content/mail.mjs`（文案归内容、发送归后端）。

---

## 2. 一次请求怎么走

```
main.mjs           监听 → 读 body（上限 64 KB）→ clientIp() → handleRequest()
   ↓
app.mjs            解析 URL（decodeURI，保留 %2F）→ 拒绝非法路径
   ↓
   ├─ /api/*        → api.mjs
   ├─ sessionRoutes → 读会话、按人渲染，不缓存（/profile/、/profile/force/）
   ├─ textRoutes    → sitemap.xml / robots.txt / 404.html / 401.html / 指南模板
   ├─ dynamicRoutes → 按路由缓存的静态页（`renderOnce`），37 个
   ├─ 补斜杠         → /about → 301 /about/
   ├─ public/       → 静态资源（带 MIME 白名单与路径逃逸防护）
   └─ 都没命中       → 404 页
```

三张路由表的区别是**缓存与入参**：

- `dynamicRoutes`：值是 `() => html`，同一份 HTML 发给所有人，**渲染一次就缓存**。
- `sessionRoutes`：值是 `{render({method, url, headers, ip})}`，**自己返回完整响应**（可能 200 / 303 / 503），
  **绝不缓存** —— 缓存下来的第一份会被发给下一个人。
- `textRoutes`：值是 `{type, render}`，现场生成的文件，同样按路由缓存。

---

## 3. 认证体系

### 3.1 三种身份状态

| 状态 | 判定 | 页面表现 |
|---|---|---|
| 游客 | 没有有效会话 | 公开页照常；`/profile/*` 303 去登录页 |
| 登录但资料不全 | 有会话，`missingFields()` 非空 | `/profile/*` 303 去 `/profile/force/` |
| 正常登录 | 有会话且必填项齐全 | 全部开放 |

### 3.2 会话

- cookie `nc_sid`：32 字节随机串，**库里只存 sha256**。
- 双时效：绝对 7 天（`auth.sessionDays`）+ 空闲 24 小时（`auth.idleHours`）。
- `last_seen_at` 最多每小时写一次，避免每个请求都 UPDATE。
- 退出 = 删除库里的那一行，不是只清 cookie。

### 3.3 CSRF

双提交（double-submit）：

- `GET /api/session` 下发 `nc_csrf`（非 HttpOnly，前端要读得到）；
- 所有 POST 必须同时满足：`Origin` 与 `Host` 同源 **且** `x-nc-csrf` 头等于 cookie。
- 校验顺序是**先 CSRF 再认证** —— 缺令牌直接 403，不是 401。

### 3.4 验证码

1. `POST /api/auth/email-captcha` → 生成 6 位码（`crypto.randomInt`）→ 发信 → 写 `login_email_captcha`。
2. 挑战 id 放在 `nc_chal`（HttpOnly），库里一行 = 一个浏览器的登录流程；同一挑战重发是**替换**不是新增。
3. 库里只存 `HMAC(secret, challenge:code)`，不存明文（6 位码只有 100 万种，裸哈希可离线爆破）。
4. 校验成功靠**一条带条件的 UPDATE** 的 `affectedRows === 1` —— 并发提交同一枚码只有一个请求能成功。
5. 有效期 10 分钟（`auth.codeMinutes`），同一枚码错 5 次即作废（`auth.maxAttempts`，之后再输对也没用）。
6. **重发作废旧码**：同一浏览器重发是 UPDATE 同一行，旧的 `code_hmac` 被覆盖。
7. **多设备**：每台设备各持一个挑战（cookie），互不覆盖；但发码间隔按**邮箱**算，
   第二台设备要等 60 秒 —— 限流是防刷的，不是按设备发的。

### 3.5 密码

- scrypt，参数写进哈希本身（`scrypt$N$r$p$salt$hash`），以后调高成本不影响旧记录。
- 「邮箱不存在 / 没设过密码 / 密码错」对外**都是** `credentials_invalid`，且不存在时也跑一次同成本的哈希 ——
  否则响应时间就是一个账号枚举接口。

### 3.6 限流（存在 `rate_events` 表里，不在内存）

| 对象 | 规则 |
|---|---|
| 发码（按邮箱） | 阶梯：前 5 次间隔 60 秒 → 第 6–8 次 5 分钟 → 第 9 次起 20 分钟 |
| 验证码错猜（按邮箱） | 15 分钟内 10 次 |
| 密码错猜（按邮箱） | 15 分钟内 10 次 |
| 猜错过多时发码 | 该邮箱 15 分钟内猜错满 10 次 → **连发新码也 429**（否则换个码就能继续猜） |
| **任意一次登录成功** | **清空该邮箱的全部计数**（这是本人，旧账一笔勾销） |

计数主体是 `HMAC(email)` / `HMAC(ip)`，库表与日志里都不出现明文邮箱。

### 3.7 必填项

唯一真相在 `auth.mjs` 的 `PROFILE_FIELDS`：

```js
{key: 'password', label: '密码', filled: user => Boolean(user.hasPassword)}
{key: 'nickname', label: '昵称', filled: user => Boolean(user.nickname.trim())}
```

`missingFields(user)` 返回还缺哪些；`landing()` 决定登录后是回原目标还是先去 `/profile/force/`。
补全页把昵称**预填成「新伙伴」**（可改、不可为空）。
**加一个强制字段只改这个数组 + 页面模板**，「部分有部分没有」天然成立。

---

## 4. API 一览

所有接口都是 `application/json; charset=utf-8`，响应一律 `Cache-Control: no-store`。

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| `GET` | `/api/session` | 无 | 当前会话、CSRF 令牌、能力开关、缺失项 |
| `POST` | `/api/auth/email-captcha` | CSRF | 发 6 位邮箱验证码，建立挑战 |
| `POST` | `/api/auth/verify` | CSRF | 验证码登录；邮箱首次验证时自动建号 |
| `POST` | `/api/auth/login` | CSRF | 邮箱 + 密码登录 |
| `POST` | `/api/auth/logout` | CSRF | 撤销当前会话 |
| `POST` | `/api/profile` | CSRF + 会话 | 更新昵称 / 密码 / 一句话介绍 |

### `GET /api/session`

```json
{
  "user": {"id": 3, "email": "a@b.c", "nickname": "", "bio": "", "hasPassword": false},
  "csrf": "…32 hex…",
  "disabled": false,
  "canSendCode": true,
  "missing": ["password", "nickname"]
}
```

- 未配置数据库或 `auth.secret` → `200 {user: null, disabled: true, canSendCode: false}`；
- 数据库连不上 → `503 {error: "unavailable"}`（前端据此提示「暂时不可用」，而不是「功能没开放」）。
- `disabled` 与 `canSendCode` 是两个独立信号，别合并。

### `POST /api/auth/email-captcha`

```json
{"email": "a@b.c"}
```

成功：`200 {ok: true, provider: "resend", retryAfter: 60, canVerify: true}` + 下发 `nc_chal`。
`retryAfter` 是**下一次**的最小间隔（会随档位变成 300 / 1200），前端拿它做倒计时。
失败：`400 invalid_email`、`429 rate_limited`（带 `Retry-After`）、`502 mail_failed`。

### `POST /api/auth/verify`

```json
{"emailCaptcha": "123456", "next": "/minicamp/"}
```

成功：`200 {ok: true, user, isNew, missing, redirect}` + 下发 `nc_sid`、清除 `nc_chal`。
`redirect` 由服务端算：资料完整→ `next` 或 `/`；缺项→ `/profile/force/?next=…`。
失败：`400 email_captcha_invalid`、`429 rate_limited`。

### `POST /api/auth/login`

```json
{"email": "a@b.c", "password": "…", "next": "/minicamp/"}
```

成功同上（`login_fail` 计数清零）；失败：`401 credentials_invalid`、`429 rate_limited`。
**没有密码的账号只能走验证码登录**，这里一律 401。

### `POST /api/auth/logout`

请求体可省略。返回 `200 {ok: true}`，并让 `nc_sid` / `nc_csrf` 立即过期。
已失效的会话也返回 200（重放不报错）。

### `POST /api/profile`

```json
{"nickname": "阿岚", "bio": "在做一个小工具", "password": "…（可选）"}
```

- 至少要带一个字段，否则 `400 invalid_profile`；
- 昵称传了就必须非空（必填项）；`bio` 可以为空；`password` 不传表示不改；
- 成功返回 `{ok: true, user, missing}` —— `missing` 为空就说明资料齐了。

---

## 5. 数据表

四张，全 InnoDB / utf8mb4（`utf8mb4_0900_ai_ci`，邮箱靠它做大小写不敏感唯一索引）。

| 表 | 装什么 | 关键索引 |
|---|---|---|
| `users` | id / email / password_hash / email_verified_at / nickname / bio / 时间 | `uniq_users_email` |
| `sessions` | token_hash / user_id / 时间戳 / ua_hash | PK `token_hash` |
| `login_email_captcha` | challenge / email / code_hmac / attempts / consumed_at / expires_at | `uniq_captcha_challenge` |
| `rate_events` | kind（send / verify_fail / login_fail）/ subject / at | `(kind, subject, at)` |

约定：**时间只由 Node 算好再写入**，SQL 里不出现 `NOW()`；连接设 `timezone: 'Z'`。

`sessions.user_id` 是**外键**（`fk_sessions_user`，`ON DELETE CASCADE`）：会话必然属于一个用户，
删号时会话跟着走，不会留下指向不存在用户的孤儿行。验证码表的外键则**不能加** ——
一行验证码可以先于账号存在（首次注册就是从发码开始的）；`rate_events` 存的是 HMAC，也没有外键可连。

### 一次请求打几条 SQL

| 接口 | 条数 | 说明 |
|---|---|---|
| `GET /api/session`（游客） | 0 | 不为游客探活；带会话时 1 条（读会话） |
| `POST /api/auth/email-captcha` | 3 | 限流记录（一次查两种）+ 写挑战 + 记一次发送 |
| `POST /api/auth/verify` | 6–7 | 老账号 6 条、首次建号 7 条 |
| `POST /api/auth/login` | 4 | 失败计数 + 查用户 + 建会话 + 清计数 |
| `GET /profile/`、`/profile/force/` | 1 | 读会话 |
| `POST /api/profile` | 2 | 读会话 + 更新 |

---

## 6. 配置（`data/config.json`）

`data/` 不进版本库，每台机器一份。**读一次就缓存，改完要重启。**

```json
{
  "host": "127.0.0.1",
  "port": 8099,
  "name": "Nanocamp-test",
  "url": "https://test.nanocamp.club/",
  "db":   {"host": "127.0.0.1", "port": 3306, "user": "nanocamp-test", "password": "…", "database": "Nanocamp-test"},
  "auth": {"secret": "…", "trustProxy": false, "sessionDays": 7},
  "mail": {"provider": "resend", "apiKey": "…", "streams": {"auth": {"from": "NanoCamp <captcha@mail.nanocamp.club>", "replyTo": "hello@nanocamp.club"}}}
}
```

| 段 | 关键项 | 缺失时 |
|---|---|---|
| 顶层 | `host` / `port` / `name`（日志前缀，多实例区分） | 用默认值，日志打 warning |
| `url` | 域名覆盖（canonical / OG / sitemap / robots 整体跟着变） | 用 `content/site.mjs` 里的 `site.url` |
| `db` | `database` 必填，**库名与实例 `name` 一致** | 认证整体不可用，接口 503 |
| `auth` | `secret` 必填（HMAC 用）；`trustProxy` 只在 nginx 反代时开 | 认证整体不可用 |
| `mail` | `provider` = `resend` / `console`；`streams.auth.from` | 落回 console，不发真信 |

`trustProxy` 打开后才会采信 `x-forwarded-for` —— 否则客户端随手加个头就能绕过来源级限额。

---

## 7. 运维命令

```bash
npm run dev         # node --watch，本地开发
npm start           # 生产启动
npm test            # 154 条测试（含 21 条打真库）
npm run check       # 全站完整性：页面数、锚点、搜索索引、sitemap、元数据

npm run db:migrate  # 建表（幂等；需要应用账号有 DDL 权限）
node scripts/migrate.mjs --print | sudo mysql --default-character-set=utf8mb4 'Nanocamp-test'  # 没 DDL 权限时
npm run db:check    # 连接 / 版本 / 四张表 / 行数
npm run mail:test -- 你的邮箱                                   # 真发一封，验证域名与密钥
```

日志只走 stdout / stderr，不写文件、不做轮转（systemd 收进 journald）。

### 暂停发信（运维开关）

邮件服务商开始退信、发信额度被刷、或者正在排查投递问题时，可以在**不重启**的情况下立刻停掉新增发信：

```bash
npm run mail:pause    # 等于 touch data/PAUSE_MAIL
npm run mail:resume   # 等于 rm data/PAUSE_MAIL
```

| 项 | 说明 |
|---|---|
| 影响范围 | 只停「发新码」。**已发出的验证码仍可校验**，密码登录、退出、改资料都不受影响 |
| 生效速度 | 立即。开关是**文件存在性检查**（每次请求 stat 一次），不走配置缓存 |
| 客户端表现 | `/api/session` 返回 `mailPaused: true`，登录页把「获取验证码」置灰并提示；直接调接口得 `503 {"error":"mail_paused"}` |
| PM2 / 多进程 | 因为状态在文件里而不是进程内存里，`pm2 start -i 4` 的每个 worker 会同时看到，不需要 `pm2 reload` |
| 忘记恢复 | 登录页会一直显示「验证码暂停发送中」，不会静默 |
| 版本库 | `data/` 不进版本库，`git pull` 不会覆盖或删掉这个文件 |

如果你后来把「暂停」做成进程内变量（例如加缓存），**多实例就会失效** —— 只有收到请求的那个 worker 知道。
这个开关刻意用文件，就是为了避开这个坑。

### 首次上线：建库建表

应用账号按设计**只有 DML 权限**，建表必须用有 DDL 权限的账号（root；Ubuntu 上是 `sudo mysql`，
root 走 auth_socket，不需要密码）。

```bash
# 1) 依赖：只有 mysql2 一个（纯 JS，不用编译）
npm install --omit=dev

# 2) 建库 + 专用账号（库名与实例 name 一致；带连字符的名字在 SQL 里必须用反引号）
DB='Nanocamp-test'; USER='nanocamp-test'
PASS=$(node -e "console.log('test-' + require('crypto').randomBytes(12).toString('base64url'))")

sudo mysql -e "CREATE DATABASE IF NOT EXISTS \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
# 两个 host 都建：config 里 host 写 127.0.0.1 时，MySQL 未必把连接解析成 localhost
sudo mysql -e "CREATE USER IF NOT EXISTS '$USER'@'localhost' IDENTIFIED BY '$PASS';"
sudo mysql -e "CREATE USER IF NOT EXISTS '$USER'@'127.0.0.1' IDENTIFIED BY '$PASS';"
sudo mysql -e "GRANT SELECT, INSERT, UPDATE, DELETE ON \`$DB\`.* TO '$USER'@'localhost';"
sudo mysql -e "GRANT SELECT, INSERT, UPDATE, DELETE ON \`$DB\`.* TO '$USER'@'127.0.0.1';"

# 3) 把 host / port / user / password / database 写进 data/config.json 的 db 段

# 4) 建表：把 DDL 交给 root 执行（幂等，可反复跑）
node scripts/migrate.mjs --print | sudo mysql --default-character-set=utf8mb4 "$DB"

# 5) 用应用账号自检
npm run db:check
```

也可以直接 `npm run db:migrate`（前提是给应用账号授了 CREATE）—— 但**不建议**：
DDL 权限留在应用上，一个 SQL 注入就能改表结构、删库。

### 从旧结构升级

**还没上线时最简单**：直接删表重建（`migrate` 是 `CREATE TABLE IF NOT EXISTS`，不会改已存在的表）。

```bash
sudo mysql 'Nanocamp-test' -e "SET FOREIGN_KEY_CHECKS=0; DROP TABLE sessions, login_email_captcha, users, rate_events; SET FOREIGN_KEY_CHECKS=1;"
node scripts/migrate.mjs --print | sudo mysql --default-character-set=utf8mb4 'Nanocamp-test'
```

已经有真实数据、不能删表时，才用下面这套 ALTER：

```sql
RENAME TABLE login_codes TO login_email_captcha;

ALTER TABLE `Nanocamp-test`.users
  ADD COLUMN nickname VARCHAR(24) NOT NULL DEFAULT '',
  ADD COLUMN bio VARCHAR(160) NOT NULL DEFAULT '';

-- 先清孤儿会话，否则下一步加外键会失败
DELETE s FROM `Nanocamp-test`.sessions s
  LEFT JOIN `Nanocamp-test`.users u ON u.id = s.user_id
  WHERE u.id IS NULL;

ALTER TABLE `Nanocamp-test`.sessions
  ADD CONSTRAINT fk_sessions_user
  FOREIGN KEY (user_id) REFERENCES `Nanocamp-test`.users (id) ON DELETE CASCADE;
```

表结构的唯一真相是 `backend/db.mjs` 的 `schemaStatements`，`--print` 打出来的就是它。

---

## 8. 状态码

| 码 | 什么时候 | 备注 |
|---|---|---|
| 200 | 页面、API 成功、`/401/` 页面本身 | 静态错误页以 200 提供，方便 nginx `error_page` |
| 301 | 补斜杠 | 地址规范稳定，允许长期缓存 |
| 303 | 登录 / 补全 / 重定向 | 语义是「去别处用 GET 看结果」 |
| 304 | ETag 命中 | 只发生在公开页面；`/profile/*` 用 `no-store` 且不发 ETag |
| 400 | URL 解析失败、路径非法、JSON 非法、字段校验失败 | 统一 400 + 具体 `error` 码，不用 422 |
| 401 | 需要会话但没有（`/api/profile`） | 与 403 分工见下 |
| 403 | 跨站 Origin、缺 CSRF 令牌 | 请求来源不被接受 |
| 404 | 路径不存在、未知 `/api/*` | |
| 405 | 方法不对 | 带 `Allow` 头 |
| 413 | 请求体超过 64 KB | 先回一句话再断开（客户端还在上传，连接不能复用） |
| 429 | 发码 / 猜错限流 | 带 `Retry-After` |
| 500 | 未捕获异常（渲染、非连接类 SQL 错误） | 堆栈进 stderr，正常不该出现 |
| 502 | 上游邮件服务失败 | 我们是网关角色 |
| 503 | 数据库不可用、认证未配置 | 语义是「稍后再试」 |

**401 vs 403**：401 = 你还没证明自己是谁；403 = 你的请求本身不被接受（跨站/缺令牌）。
所以 CSRF 校验放在认证之前。

---

## 9. 几个刻意的取舍

- **没有 store 抽象层**：`auth.mjs` 直接写 SQL。多一层转发只会让「改了一条查询」需要对照三处。
- **验证码只存 HMAC**：6 位码空间太小，裸哈希不设防。
- **限流存库而不是内存**：重启不清零、多实例共享、可审计。代价是每次发码多一次查询。
- **登录成功清空计数**：限流是为了挡「猜」和「刷」，登录成功证明是本人。
- **会话页面不进缓存**：`dynamicRoutes` 的缓存是按路由的，同一 URL 对不同人内容不同，缓存会串号。
- **私人响应 `no-store` 且不发 ETag**：`no-cache + ETag` 那套对「因人而异」的响应没意义。
- **邮件失败是 502 不是 400**：不是客户端的问题，也不该让调用方以为可以改参数重试。
- **超限请求体回 413 而不是直接断连**：断连时客户端只看到「连接被重置」，完全不知道自己错在哪。
- **退出登录失败回 503 且不清 cookie**：会话没撤掉却把 cookie 清了，等于让人以为自己退了。

---

## 10. 已知未做

- **没有 IP 级限流**：只按邮箱算，换邮箱就能继续刷发信（`login_email_captcha.ip_hash` 存了但未用于限流）。
- **`rate_events` 没有定期清理**：登录成功会清掉自己的，但从未登录成功的邮箱会一直累积。
- **改配置必须重启**：`config.mjs` 读一次就缓存（有意为之，避免「一半请求用新配置」）。
- **没有健康检查端点**：库是否可用靠 `npm run db:check` 或 `/api/session` 的 503 判断。
