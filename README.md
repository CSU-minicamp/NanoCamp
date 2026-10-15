# NanoCamp 官网

十四个页面：首页、首届 minicamp 回顾、活动总览、作品、参与指南、常见问题、关于社区、共创资源、四篇独立指南、交流合作、站内搜索，另有专用 404 页面。页面由 Node.js 后端在请求到达时生成，无需安装依赖。站点与活动资料集中在 `content/site.mjs`，2026 届作品数据在 `content/minicamp2026.json`，全年活动形式与 FAQ 在 `content/community.mjs`。

> **迁移进行中**：目前只有首页（含首屏海报）、`sitemap.xml`、`robots.txt` 与 404 页由后端生成，其余页面访问会返回 404，用来直观显示进度。详见「部署」一节的迁移说明。

## 本地预览

需要 Node.js 20 或更新版本，无需安装依赖。

```sh
git clone https://github.com/CSU-minicamp/NanoCamp.git
cd NanoCamp
npm run dev
```

打开终端输出的本地地址（默认绑本机所有网卡、端口 `8080`，由 `data/config.json` 决定）。页面在请求到达时渲染，改完 `src/`、`public/`、`content/` 刷新即可看到，不需要重新构建（`npm run dev` 用 `node --watch` 自动重启）。本机开发想只对自己开放就在 `data/config.json` 里写 `"host": "127.0.0.1"`，见「部署」一节。

## 协作开发与发布

本次交接包含官网第 18 版的源码、原始 Logo、字体及授权文件和测试，来源提交为 `427b06374cc3f47b8067662bfbb2f3489025e458`。网站采用原生 HTML、CSS 与 JavaScript；页面由 Node.js 在后端渲染，不依赖任何第三方包。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动动态服务，改文件自动重启 |
| `npm start` | 只启动动态服务 |
| `npm run check` | 检查服务端语法、页面、资源、锚点与元信息 |
| `npm test` | 运行内容、图片、站内搜索与后端路由的回归测试 |

开发时只需修改 `src/`、`public/` 和 `content/`，刷新页面即可生效。多人协作可以从 `main` 创建功能分支，再通过 Pull Request 合并，合并前执行 `npm run check` 和 `npm test`。

当前视觉为 B 版纸张拼贴海报：`public/collage.css` 定义全站最终配色、字体和组件样式，`public/hero.css` 定义首屏。它们会覆盖前面加载的基础样式；调整视觉时先检查这两个文件。`public/fonts/` 保留精简标题字库、备用字库和字体许可证，来源与字形范围记录在 `FONT-SOURCES.txt`。

## 部署

站点是动态服务：`backend/` 在请求到达时渲染 HTML，`public/` 直接提供图片、字体、CSS 与 JS。只需要能运行 Node.js 20 的环境，**没有 npm 依赖、没有构建步骤**，`git clone` 完就能跑。

本地试跑：

```sh
git clone https://github.com/CSU-minicamp/NanoCamp.git
cd NanoCamp
npm start
```

### 配置：`data/config.json`

只有一个配置入口：`data/config.json`。整个 `data/` 目录不进版本库，所以在服务器上直接改它，不会影响任何人的 clone。

```json
{ "host": "0.0.0.0", "port": 38083, "name": "Nanocamp-test" }
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `host` | `0.0.0.0` | 监听地址。默认绑本机所有网卡（含它自己的 IP），部署后直接可访问；本机开发想只对自己开放就写 `"127.0.0.1"` |
| `port` | `8080` | 监听端口 |
| `name` | `nanocamp` | 日志前缀。每行日志会写成 `[name] …`，同一台机器上跑多个实例时用来区分输出 |

文件不存在、只写一个字段、或某个字段类型写错，都用默认值兜住，服务照常启动。没有别的启动参数 —— 不读环境变量，也没有示例文件，直接改这一个 JSON 即可。两个实例（不同端口）就放两份 clone，各自写自己的 `data/config.json`。

### 服务器部署（systemd）

`data/` 不进版本库，所以 `git clone` 之后**必须手动建配置文件**，否则会用默认的 `0.0.0.0:8080` 且实例名为 `nanocamp`。

```sh
# 1) 确认 Node 版本（不需要 npm install）
node -v                                   # 需要 >= 20
which node                                # 记下路径，下一步 ExecStart 要用

# 2) 拉代码。每个实例一份独立 clone：实例名 = 目录名 = systemd 的 %i
sudo mkdir -p /srv && cd /srv
sudo git clone https://github.com/CSU-minicamp/NanoCamp.git NanoCamp-test

# 3) 写实例配置
cd /srv/NanoCamp-test
sudo mkdir -p data
sudo tee data/config.json >/dev/null <<'JSON'
{
  "host": "127.0.0.1",
  "port": 38083,
  "name": "Nanocamp-test"
}
JSON

# 4) 装 systemd 模板单元：%i 就是实例名，同时决定工作目录 /srv/%i
sudo tee /etc/systemd/system/nanocamp@.service >/dev/null <<'UNIT'
[Unit]
Description=NanoCamp 动态站点（%i）
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/%i
ExecStart=/usr/bin/node backend/main.mjs
User=www-data
Restart=always
RestartSec=3
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
UNIT

# 5) 启动并设为开机自启
sudo systemctl daemon-reload
sudo systemctl enable --now nanocamp@Nanocamp-test

# 6) 验证
systemctl status nanocamp@Nanocamp-test --no-pager
journalctl -u nanocamp@Nanocamp-test -n 40 --no-pager
curl -sS -D- -o/dev/null http://127.0.0.1:38083/ | head -3
curl -sS -o/dev/null -w '%{http_code}\n' http://127.0.0.1:38083/about/   # 期望 404（还没迁移）
```

**别漏了服务端口本身。** 用哪种访问方式决定了要不要把它对外开：

- **直接用 `IP:端口` 访问**（`host` 要设成 `0.0.0.0`）：必须在云平台放行该端口的**入站**规则 —— 云服务器 CVM 在「安全组」，轻量应用服务器 Lighthouse 在「防火墙」（名字不一样，别找错页签），默认只开 22/80/443。**不放行的话请求压根到不了机器，服务器上也不会留下任何日志**，很容易误以为是程序问题。系统防火墙（`ufw` / `firewalld`）同样要放行。
- **走 nginx 反代 80/443**（`host` 保持 `127.0.0.1`，见下）：这个端口不用对外开，只放行 80/443。

要起第二个实例（不同端口）：再 clone 一份到 `/srv/<另一个名字>`，改它自己的 `data/config.json`，然后 `systemctl enable --now nanocamp@<另一个名字>`。日志天然按 unit 分开。

**更新代码**：

```sh
cd /srv/NanoCamp-test && sudo git pull && sudo systemctl restart nanocamp@Nanocamp-test
```

没有 `npm install`、没有构建产物要同步。`node --watch`（`npm run dev`）只用于本地开发，别拿它做守护。

用 pm2 守护也可以，两条命令即可：

```sh
cd /srv/NanoCamp-test
pm2 start backend/main.mjs --name NanoCamp-test --interpreter node   # .mjs 要显式指定解释器
# 或者借 package.json 的 start 脚本（更稳，不受 pm2 对扩展名判断的影响）
pm2 start npm --name NanoCamp-test -- start
pm2 save && pm2 startup        # 否则机器重启后不会自动拉起
pm2 logs NanoCamp-test         # 日志在 ~/.pm2/logs/ 下也有一份
```

### 反向代理与 HTTPS

服务本身不处理 HTTPS，证书与 443 交给反向代理；`host` 设成 `127.0.0.1` 时 Node 不对外暴露，只有同机 nginx 能访问，这是推荐配置。

⚠️ 如果这台机器上**已经有 nginx 在跑别的站点**，先看清现状再动手，只加自己的 server block，别覆盖现有的：

```sh
nginx -T | grep -nE "server_name|listen|root"     # 现有哪些站点、听哪些端口
ls /etc/nginx/sites-enabled/
```

```nginx
server {
  listen 80;
  server_name test.example.com;

  location / {
    proxy_pass http://127.0.0.1:38083;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/nanocamp-test /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d test.example.com          # 上 HTTPS
```

只写 `listen 80` 那一段就够了，`certbot --nginx` 会自己补上 `listen 443 ssl`、证书路径和 http→https 跳转。想放在子域名上（例如 `test.example.com` 挂在 `example.com` 下）不需要重新备案 —— 顶级域名备案过，二级域名即可用。

**用域名就必须先 ICP 备案**：托管在中国境内服务器上的站点，域名解析过去后 80/443 都会被云厂商的未备案监测拦截（HTTPS 一样拦，且不分端口）。只用公网 IP 访问则不需要备案。备案有办理周期，计划上域名就早点办。

HTTPS 还有一种"纯 IP"的做法：Let's Encrypt 从 2026 年 1 月起支持给 IP 签发证书（IPv4/IPv6 都行），不需要域名也不需要备案。但它**强制 6 天有效期**（必须自动化续期），而且 certbot 的 nginx 插件**不支持 IP 证书** —— 只能 `certonly` 签发后手写证书路径、再用 `--deploy-hook` 在续期后 reload nginx。有域名的话不必走这条。

如果不想用 nginx、要直接用 `IP:端口` 访问，就把 `data/config.json` 的 `host` 改成 `"0.0.0.0"`，并在防火墙放行该端口（如 `sudo ufw allow 38083/tcp`）。反过来，**一旦挂上 nginx，就应该把 `host` 改回 `127.0.0.1`**，让 Node 不再直接暴露在公网，安全组里那个高位端口也就可以撤掉了。

网站资源使用以 `/` 开头的路径，没有子路径支持，必须部署在域名根路径。换正式域名时改 `content/site.mjs` 的 `site.url`（它决定 canonical、Open Graph 与 `sitemap.xml`），这份文件进版本库，所以在测试实例上改会被下一次 `git pull` 覆盖。

### 日志

进程只往 **stdout / stderr** 写日志，不自己开文件、不管理日志轮转 —— 这些交给外部工具做。所以日志能不能看到，取决于谁接管了这两条流：

```sh
# systemd：stdout/stderr 自动进 journald，日志带时间戳、按 unit 分开、支持 -f 跟随
journalctl -u nanocamp@Nanocamp-test -f
journalctl -u nanocamp@Nanocamp-test --since today
#   /etc/systemd/journald.conf 设 Storage=persistent 可让日志跨重启保留

# 不用 systemd 时的裸后台运行：必须自己重定向，否则会话一断输出就没了
node backend/main.mjs >> logs/app.log 2>&1 &
```

裸重定向到文件时行首只有 `[name]` 没有时间戳，需要时间的话用 systemd（journald 自带），或自己包一层 `ts`。`SIGTERM` / `SIGINT` 会先停止接收新连接、把在途请求处理完再退出，所以 systemd 重启不会丢请求；配合 `Restart=always` 就是完整的守护方案。



### 页面全部在请求期渲染，没有构建步骤

所有页面都由 `src/pages.mjs` 的 `renderPage` 渲染，`backend/app.mjs` 的路由表直接按 `routePaths` 展开 —— 新增页面只要写进 `src/pages.mjs` 就自动生效，不存在「写了页面忘了挂路由」的情况。渲染方式特殊的 `/intro/`（首页 iframe 嵌入的海报）单独列出。

另有 7 个文件不落磁盘、在请求期现场生成：`sitemap.xml`、`robots.txt`、`/404.html`，以及 4 个指南模板下载 `/downloads/<slug>-template.txt`（正文取自 `content/guides.mjs` 的 `template` 字段）。仓库里没有任何页面产物，也没有 `dist/`。

响应头 `x-nanocamp-source` 标明每次请求的来源：`dynamic` 请求期渲染、`asset` 来自 `public/`、`notfound` 地址不存在、`redirect` 301 补斜杠。

### 性能与缓存

渲染结果按路由缓存（`backend/app.mjs` 的 `renderOnce`）：**第一次请求时渲染，之后直接复用**。内容是进程启动时固定的 —— 没有任何运行时写入路径，只有重新部署（`git pull` + 重启）才会变，所以这个缓存不需要任何失效逻辑。404 页也共用同一份缓存，被扫描器狂打不存在的地址时不会反复重建。

实测（单进程、同一台机器）：

| | 每个请求都渲染 | 缓存命中后 |
| --- | --- | --- |
| 首页 | 0.91 ms | 0.07 ms |
| 作品列表（65 KB） | 1.23 ms | 0.10 ms |
| 站内搜索（83 KB） | 0.92 ms | 0.09 ms |
| 全站 34 页跑一遍 | 14.9 ms | 1.22 ms |

冷启动时全站渲染一遍约 14 ms，全部页面常驻内存约 0.8 MB。剩下的 0.03–0.1 ms 是对响应体算 sha1（生成强 ETag）的成本，与渲染无关。

⚠️ `/search/` 是唯一随内容量线性增长的页面：它把全站检索索引内嵌进页面（当前 92 条 / **64.7 KB**，占该页 81.2 KB 的 **80%**；每条约 720 字节）。索引大小随记录数线性增长 —— 500 条约 368 KB、1000 条约 720 KB。要改造时首选「服务端过滤」（实测一次查询只要 0.5–0.64 ms），可让页面瘦到约 20 KB 并让无 JS 也能搜索。

⚠️ 索引随页面全量下发，**不能放非公开内容** —— 访问一次 `/search/` 就能拿到全部记录。
## 替换真实资料

1. 将图片放入 `public/images/`，例如 `public/images/minicamp-cover.jpg`。
2. 编辑 `content/site.mjs`，图片地址填写 `/images/minicamp-cover.jpg`。
3. `site.logo` 是横版 Logo，`site.symbol` 是 NC 图形标志。当前已放入两张官方原图。`logoCrop` 和 `signatureCrop` 用 `[x, y, 宽, 高, 原图宽]` 指定网页显示范围，分别用于导航和带标语的完整字标；原图不经过修改。换成无留白的新素材时，可把裁切设为 `null`。
4. `site.join.qrCode` 填写入群二维码，`contact` 填写联系账号，`contactLabel` 填写账号类型。缺少资料时显示加入方式待公布。
5. `event` 中填写活动时间、地点、主题、总结与主图；`summary` 数组的每一项为一段正文。
6. `projects` 中填写作品标题、简介、图片、成员、介绍链接和 Demo 链接。添加或删减数组项即可调整作品数量。
7. 作品的 `slug` 决定详情页地址 `/projects/<slug>/`，填写后应尽量保持稳定；缺省时回退为 `/projects/project-<id>/`。字段为：`description`（一句话简介）、`problem` / `solution`（问题与做法，换行即分段）、`theme`（活动主题，列表页据此分组）、`team` / `year`（队伍与年份）、`tools`（工具标签数组，卡片显示前 3 个）、`members`（`{name, role}` 数组）、`cover` / `coverAlt` / `coverFull`（封面与点击查看的原图）、`repoUrl`（GitHub 仓库）、`demoUrl`（在线体验）、`sourceId`（上游系统编号，用于去重）。未提供的地址保持 `null`，页面显示「待补充」而不是编造内容。标题仍为「项目名称」的占位项不会进入列表、详情页路由与站内搜索。
8. `moments` 中填写照片、描述与图注。填写真实图片后自动支持点击查看大图。
9. 页面在请求到达时渲染，不需要再执行构建。

外部项目链接使用完整的 http 或 https 地址。未提供的地址保持 `null`，页面会显示待补充状态。

## 合作页面

合作页按「三个合作案例 → 接受的合作类型 → 我们能提供什么 → 希望合作方提供什么 → 合作邮箱」排列，主要内容集中在 `content/partners.mjs`：

- `cases`：赛百味、bonjour！交友卡片、OpenDev。`logo` 是品牌图片路径，`summary` 是卡片简介，`period` 是合作时间；`sponsorship` 和 `promotion` 分别列出赞助内容与社区提供的宣传支持。未确认具体日期时保留待补充说明。`id` 用于页面锚点和站内搜索，请保持唯一且稳定。
- `cases[].photos`：风采照片数组，初始为空并显示照片占位。将照片放入 `public/images/` 后，添加 `{ src: '/images/照片文件名.jpg', alt: '照片描述', caption: '可选图注' }` 即可展示。可选的 `url` 用于真实合作记录链接。
- `formats`、`offers`、`requests`：合作方向与双方支持的初稿，可直接改标题和说明；实际合作安排由双方另行确认。
- `email`：合作邮箱为 `qmzjyyds@163.com`，点击后复制到剪贴板。复制受浏览器限制时会选中邮箱供手动复制；没有邮箱时明确显示「合作邮箱待补充」。

`src/partners.mjs` 负责页面，`public/partners.css` 和 `public/partners.js` 仅在合作页加载。点击品牌卡片会放大为居中的详情卡片，支持关闭按钮、点击遮罩、Esc 关闭与键盘焦点循环；减少动态效果或暂停全站动效后立即展示详情。关闭 JavaScript 时，合作详情直接显示，卡片仍可跳转到对应记录。联系区的本地草稿工具由 `src/partner-draft.mjs` 和 `public/workshop.js` 提供，输入与选项变化会实时同步到预览；填写主题后可复制或下载，清空后可撤销。共享页脚将标语放在 Logo 下方，标题与标语采用 Logo 的蓝色与薄荷绿。网站不会代发邮件或提交申请。修改后运行 `npm run check` 和 `npm test`。

## 文件说明

- `backend/app.mjs`：服务端渲染核心，导出 `handleRequest({ method, url, headers })`，返回 `{ status, headers, body }`，与 HTTP 服务器解耦、可直接单测。解析顺序为「派生文件 → 页面 → 目录补斜杠 → `public/` 资源 → 404」。响应头 `x-nanocamp-source` 标明来源（`dynamic` / `asset` / `notfound` / `redirect`）。渲染结果按路由缓存（见「性能与缓存」）。不读配置、不碰端口。
- `backend/base.mjs`：站点的**唯一文件系统出口** —— `assetRoot`、后缀到 Content-Type 的映射表、`readFileWithin()` 与 `readAsset()`。请求进入 `handleRequest` 后先过 `safeRoute()`（拒绝 `\0`、`.`/`..` 段与含 `\` 的段，回 400），再由 `readFileWithin` 兜住最后一层。
- **路径安全规则**：任何由 URL 推导出的文件路径都必须经 `readFileWithin()` 读，它把路径 `path.resolve` 展开后要求仍落在允许的根目录内，因此 `/../package.json`、`/images/../../x` 以及 Windows 风格的 `..\..\x` 都读不到目录外的文件；`decodeURI`（而非 `decodeURIComponent`）保证编码过的 `/`（`%2F`）不会被还原成分隔符。更好的做法是根本不让 URL 决定文件路径 —— 能让内容来自 `content/` 里的内存数据就别落磁盘。另外注意 `public/` 下的任何文件都是公开可下载的，别往里放密钥。
- `backend/main.mjs`：入口。读 `data/config.json` 的 `host`/`port`/`name`，监听端口、`SIGTERM`/`SIGINT` 优雅退出，并在启动时打印访问地址与渲染规模。日志只走 stdout / stderr，每行带 `[name]` 前缀，由外部（systemd / 重定向）接管。
- `data/config.json`：实例配置（`host` / `port` / `name` 三个字段），整个 `data/` 目录不进版本库。服务启动时读一次。
- `src/components.mjs`：卡片、媒体、弹窗与文档外壳；请求期输出与 `public/base.js` 一致的导航及页脚署名。`documentPage()` 为内容页（含子页面与 404）统一追加 minicamp 同款加入区和页脚；首页保留 `homeJoinSection()` 专属加入区，站内搜索沿用同一页脚，但同样不追加加入区。
- `public/base.js`：导航、页脚底部与回到顶部的统一数据源及客户端渲染入口。桌面与手机导航均为「首页、minicamp、活动、作品、社区、合作、站内搜索」，全部直接显示；共创资源、关于我们与常见问题保留在页脚。首页使用 `home` 标记当前项。渲染结果与客户端渲染由导航测试逐节点比对，搜索项保留 Ctrl/⌘ + K 快捷键钩子。
- `public/base.css`：与 `base.js` 配套的站点框架样式，包含顶部栏、桌面/手机导航、共用的 minicamp 同款加入区与页脚、回到顶部浮窗。在 `styles.css` 之后、页面皮肤之前加载；内容页的加入区使用 `join-shared`，首页保留专属加入区与 `home.css` 样式；页脚通过 `footer-shared` 保持各页一致（搜索页也用它，只是同样不追加加入区）。浮窗显隐由 `data-visible` 驱动，`details.js` 判断滚动距离。
- `src/pages.mjs`：页面路由与首页、活动回顾、关于页面的内容结构；作品详情页按 `projects` 动态展开。
- `src/projects.mjs`：作品卡片、列表页与详情页；`projectSlug` / `projectPath` 生成地址，`readyProjects` 过滤占位项。
- `public/projects.css`：作品卡片标签、主题分组与详情页版式，在 `gallery.css` 之后、`collage.css` 之前加载。
- `scripts/sync-minicamp-projects.mjs`：从 minicamp 官方接口 `https://minicamp.flipperusc.work/api/projects` 拉取已发布作品，按主题、队伍、编号排序后输出 JSON，加 `--write-images` 会把接口内嵌的 base64 封面导出到 `public/images/projects/`。默认只打印结果，不改动任何文件；核对后整体替换 `content/minicamp2026.json` 的 `projects` 数组。中文标题没法自动转成好读的英文，所以人工起的英文名记在脚本内的 `englishSlugs` 表里，重新同步不会冲掉。
- `src/hero.mjs`：首页品牌舞台与首页专属加入区；`homeJoinSection()` 保留首页邀请文案与加入渠道提示，首页只渲染一次加入区。
- `public/hero.css`、`public/hero.js`：B 版首屏海报与入场动效，仅在首页加载。
- `public/interactions.css`：**首页专属**的鼠标交互层（导航下划线、按钮柔光、卡片抬起、封面推近等 15 项）。所有规则都限定在 `body[data-page="home"]`，其他页面不受影响。由 `documentPage()` 用 `<link>` 引入，**不要改成 `collage.css` 里的 `@import`**：该文件开头已有 `@font-face`，而 CSS 规定 `@import` 必须位于所有规则之前，否则整条被浏览器丢弃，交互会静默失效。规则包在 `@media(hover:hover) and (pointer:fine)` 内，只用 transform / 颜色 / 阴影 / 伪元素，不改变布局。
- `public/collage.css`：当前纸张拼贴视觉的全站样式、字体声明和响应式细节。
- `public/details.css`、`public/details.js`：全站共享的按钮、卡片、照片框与弹窗（导航/页脚/浮窗样式已移到 `public/base.css`）。动效偏好只跟随系统的 `prefers-reduced-motion`：「暂停全站动效」按钮与滚动入场已移除，正文元素不做初始隐藏；`window.NanoCampMotion` 仍暴露 `stopped` / `subscribe` 供社区页、相册与合作页判断。
- `public/styles.css`：颜色、排版、组件与响应式样式。
- `public/app.js`：弹窗、图片查看、复制及图片失败处理（导航交互已移至 `public/base.js`）。
- `scripts/check.mjs`：验证生成的页面与资源链接。
- `scripts/inspect.mjs`：页面几何自检（`npm run inspect`，可带路由参数）。让页面自行测量关键元素的坐标并渲染成文本，再用 headless 截图取回，输出到 `verify/`。这台机器上 Chrome 的主进程 IPC 走命名管道，受限令牌沙箱禁止跨进程打开命名管道，因此无法用 DevTools 协议驱动真实滚动；这个脚本是那类测量的替代办法。
- `scripts/verify-home-scope.mjs`：首页隔离自检（`npm run verify:scope`）。逐页比对，确认交互层与文案改动只落在首页、其他页面的共享行为与还原前一致。`verify/` 只是本地排查产物，不要提交。

内容改完后执行 `npm run check` 与 `npm test` 进行基础检查。活动日期、地点、照片、项目资料和入群方式仍为明确占位。

首屏动画在素材就绪后播放一次（等待上限 1.8 秒），不提供重播或暂停控件。入场落座后，三张纸转入幅度 7px 极轻浮沉（`float-soft`，与各自终态旋转对齐，衔接不跳变）。系统开启“减少动态效果”时展示静态完整版，并同时关闭其他装饰动效。关闭 JavaScript 后品牌与内容仍可见。

全站动效不提供手动开关，只跟随系统的减少动态效果设置：`window.NanoCampMotion` 的 `stopped` 为真时，`body` 会带上 `motion-stopped` 整站停用装饰动效。`details.js` 在 `hero.js` 之前加载，通过 `window.NanoCampMotion` 共享状态。

所有新增反馈均为渐进增强：按钮按压波纹会自动清理，卡片光泽只在精确指针移动时刷新。占位内容维持不可点击；只有已填写的照片和链接提供查看、跳转等操作。项目封面、活动照片补齐后，会自动使用新的照片缩放与查看提示。

## 作品列表与详情

- 作品数据在 `content/minicamp2026.json`：`projects` 数组是 20 条作品，`featuredProjectIds` 是首页推荐哪几个。改内容只动这个 JSON，不用碰代码；`content/site.mjs` 只负责读它并补上默认分类。
- 详情页地址由每条作品的 `slug` 决定（`/projects/<slug>/`），中文标题没法自动转出好读的英文，所以 15 条占位编号（`project-05` 这类）已人工改为英文名（`bookmark-rescue` 这类）。改 slug 就会换地址，旧地址直接 404，不做跳转。
- `/projects/` 是卡片网格；点击卡片标题或「查看详情」进入 `/projects/<slug>/`。卡片不做整卡链接，避免与封面相册、Demo、仓库等外链形成嵌套 `<a>`。
- 详情页依次为：面包屑、主题标签、标题与导语、工具标签、外链按钮、封面、侧栏目录与元信息、想解决的问题、我们的做法、用到的工具、参与的同学、上一个/下一个作品。未填写的章节显示待补充占位框。
- 作品超过 6 个时，列表页按 `theme` 分组，每组一条 `.project-group` 并带 `id="theme-<slug>"` 锚点；无主题的条目归入末尾的「未分类主题」。
- 所有外部地址经 `safeUrl()` 只放行 http / https，统一 `target="_blank"` + `rel="noopener noreferrer"`，并带箭头图标与「（新标签页打开）」读屏提示；未填写时显示待补充，不生成链接。
- 详情页复用 `active: 'projects'` 的相册脚本与 `collage.css` 视觉；桌面为侧栏 + 正文双栏，860px 以下单栏。

## 全年社区

- `src/community.mjs`：首页全年社区模块、活动总览、参与指南和常见问题。
- `content/community.mjs`：四种活动形式、FAQ 分类和问答。活动形式不是已排期的场次，不应在没有确认时改为招募或报名状态。
- `public/community.css`、`public/community.js`：社区页面布局、活动分类、FAQ 文本搜索、问题直达和可见时才播放的装饰轨道。
- 活动类型使用 `?topic=sharing` 等查询；FAQ 支持 `?topic=events&q=报名`。问题有稳定的 `#id`，直达时自动展开；文字搜索按空格拆分为多个关键词共同匹配。
- 无 JavaScript 时不显示搜索与筛选控件，所有活动形式和原生 FAQ 折叠项仍然可阅读。
- 导航在 860px 及以下改为菜单；CSS 与 `app.js` 的断点应同步维护。

增加联系方式、报名政策或未来场次后，请同时核对 FAQ 的当前状态说明。网页不会收集或提交报名信息；缺少的联系方式仍明确显示待公布。
## 共创资源与交流草稿

- `content/minicamp2026.json`：2026 届作品数据（20 条作品 + 首页推荐编号）。纯 JSON，便于非代码方式编辑。
- `content/guides.mjs`：四篇通用共创指南、分节正文、准备清单、纯文本模板与外部官方学习入口。
- `src/learning.mjs`：资源中心及指南页面；`src/partners.mjs`：交流合作页面。
- `public/workshop.css` / `public/workshop.js` 仅在资源与合作页加载。
- 模板下载 `/downloads/*-template.txt` 由后端从 `content/guides.mjs` 的 `template` 字段现场生成。下载链接本身不依赖 JavaScript。
- 准备清单按指南存储在 `nanocamp-checklist-<slug>-v1` 本地键中。仅存勾选项标识；浏览器不允许存储时，本页仍可使用并显示说明。
- 合作工具只在当前页面生成文本，没有网络提交、数据库写入或自动保存。生成后可复制或下载；输入修改后需要重新生成；清空后可撤销。不要把此工具的文案改成「提交成功」或「申请已收到」，除非另外接入并验证真实接收流程。
- 官方学习链接核实于 2026-10-02。社区指南为通用准备建议，不代表某一届 minicamp 的实际规则。
## 站内发现

- 站内搜索 `/search/` 从公开页面、活动形式、指南正文与模板、FAQ 自动生成索引。填写真实作品标题后，该作品自动加入索引并指向详情页；`项目名称` 占位项不加入。作品 `id` 应保持唯一且稳定，`slug` 决定详情页地址。
- `src/search.mjs` 生成索引和无脚本目录；`public/search-core.js` 提供规范化、多词共同匹配、排序及摘要；`public/search.js` 渐进增强查询、分类、分页及安全高亮。所有结果文本使用 DOM 文本节点。
- 搜索使用 `?q=关键词&type=guide`；空格分隔的词共同匹配，支持全角字符。无 JavaScript 或索引无法读取时回退为公开页面目录。
- 主导航搜索入口支持 Ctrl / Command + K，输入控件或打开的弹窗内不会触发。不会绑定纯字符快捷键。
- `site.url` 是网站的正式公开地址，更换域名后改这里并重启即可（`content/site.mjs`）。`src/metadata.mjs` 生成 canonical、Open Graph、社交卡片和基于真实页面内容的结构化数据。
- `public/images/nanocamp-social.png` 是 1200 × 630 的分享预览图输出。原始两张 Logo 不修改。
- `npm test` 运行搜索核心、真实内容索引和内联 JSON 安全回归。
- `sitemap.xml` 与 `robots.txt` 由后端现场生成。搜索页和 404 标记为 noindex；站点地图只列入普通公开页面，不捏造最后更新时间。
- `scripts/check.mjs` 检查页面标题/描述、元素 ID、站内文件与锚点、搜索记录、内联 JSON、canonical 与社交元信息、站点地图和分享图尺寸。上线后仍需确认托管平台对未知地址返回 HTTP 404。
## minicamp 回顾与相册

- 年度回顾提供四个章节锚点：`#recap`、`#moments`、`#camp-projects`、`#keep-building`。顶部章节导航按阅读位置更新；窄屏保持紧凑，手机横屏时不额外占用固定高度。关闭脚本后仍是普通可用链接。
- `src/recap.mjs` 提供章节导航和相册结构。`public/recap.css/js` 只在 minicamp 回顾页加载；`public/gallery.css/js` 只在首页、回顾和作品页加载。
- 图片预览是直接指向原图的链接，在脚本可用时增强为相册。按活动现场、作品封面分组；相同原图不重复计数。提供缩略图、上一张/下一张、键盘方向键和 Home/End、触摸滑动、加载与失败重试。Esc 关闭后焦点回到原照片。
- `moments[].src` 可填写压缩后的预览图，另用可选的 `fullSrc` 指向原图；活动和作品封面分别使用 `event.coverFull`、`projects[].coverFull`。没有提供这些可选字段时，使用同一张图片。全部地址规则与原图片字段相同。
- 如果预览图无法加载，但配置了不同的原图地址，页面保留「点击查看原图」入口。缺少图片的占位框仍不生成假相册按钮。
- 相册尊重全站动效与系统减少动态效果设置；切换或关闭时清理待处理图片，不会让迟到的照片覆盖新选择。缩略图延迟加载；配置独立预览图时，原图只在选择时请求。
