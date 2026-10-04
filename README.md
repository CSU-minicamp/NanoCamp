# NanoCamp 官网

十四个页面：首页、首届 minicamp 回顾、活动总览、作品、参与指南、常见问题、关于社区、共创资源、四篇独立指南、交流合作、站内搜索，另有专用 404 页面。使用静态页面，无需安装依赖。活动和项目真实资料集中在 `content/site.mjs`，全年活动形式与 FAQ 在 `content/community.mjs`。

## 本地预览

需要 Node.js 20 或更新版本，无需安装依赖。

```sh
git clone https://github.com/CSU-minicamp/NanoCamp.git
cd NanoCamp
npm run dev
```

打开终端输出的本地地址，默认是 `http://127.0.0.1:4187`。修改源文件后执行 `npm run build` 并刷新页面。

## 协作开发与发布

本次交接包含已发布官网第 18 版的源码、原始 Logo、字体及授权文件、构建产物和测试，来源提交为 `427b06374cc3f47b8067662bfbb2f3489025e458`。网站采用原生 HTML、CSS、JavaScript 和 Node.js 静态页面生成脚本。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 构建页面并启动本地预览 |
| `npm run build` | 从源码与内容数据重新生成 `dist/` |
| `npm run check` | 检查脚本语法、页面、资源、锚点与元信息 |
| `npm test` | 运行内容、图片与站内搜索的回归测试 |

开发时修改 `src/`、`public/` 和 `content/`，然后重新构建；直接编辑 `dist/` 的改动会在构建时被覆盖。当前仓库保留 `dist/`，提交功能改动前请一并更新对应构建产物，并执行 `npm run check` 和 `npm test`。多人协作可以从 `main` 创建功能分支，再通过 Pull Request 合并。

当前视觉为 B 版纸张拼贴海报：`public/collage.css` 定义全站最终配色、字体和组件样式，`public/hero.css` 定义首屏。它们会覆盖前面加载的基础样式；调整视觉时先检查这两个文件。`public/fonts/` 保留精简标题字库、备用字库和字体许可证，来源与字形范围记录在 `FONT-SOURCES.txt`。

发布时构建并上传 `dist/` 到静态托管服务，配置目录路由和自定义 `404.html`。网站资源使用以 `/` 开头的路径，应部署在域名根路径；更换正式域名时修改 `content/site.mjs` 的 `site.url` 后重新构建。`.openai/hosting.json` 是现有 Sites 站点的托管配置，普通本地开发不依赖该平台。GitHub 推送与现有 `chatgpt.site` 网站发布是独立操作，本仓库尚未配置自动部署。

## 替换真实资料

1. 将图片放入 `public/images/`，例如 `public/images/minicamp-cover.jpg`。
2. 编辑 `content/site.mjs`，图片地址填写 `/images/minicamp-cover.jpg`。
3. `site.logo` 是横版 Logo，`site.symbol` 是 NC 图形标志。当前已放入两张官方原图。`logoCrop` 和 `signatureCrop` 用 `[x, y, 宽, 高, 原图宽]` 指定网页显示范围，分别用于导航和带标语的完整字标；原图不经过修改。换成无留白的新素材时，可把裁切设为 `null`。
4. `site.join.qrCode` 填写入群二维码，`contact` 填写联系账号，`contactLabel` 填写账号类型。缺少资料时显示加入方式待公布。
5. `event` 中填写活动时间、地点、主题、总结与主图；`summary` 数组的每一项为一段正文。
6. `projects` 中填写作品标题、简介、图片、成员、介绍链接和 Demo 链接。添加或删减数组项即可调整作品数量。
7. `moments` 中填写照片、描述与图注。填写真实图片后自动支持点击查看大图。
8. 执行 `npm run build` 更新生成页面。

外部项目链接使用完整的 http 或 https 地址。未提供的地址保持 `null`，页面会显示待补充状态。

## 文件说明

- `src/components.mjs`：导航、卡片、媒体、弹窗、页脚与文档外壳。
- `src/pages.mjs`：页面路由与首页、活动回顾、作品、关于页面的内容结构。
- `src/hero.mjs`：首页品牌舞台，以及首页专属的加入区 `homeJoinSection()`。
- `public/hero.css`、`public/hero.js`：B 版首屏海报与入场动效，仅在首页加载。
- `public/collage.css`：当前纸张拼贴视觉的全站样式、字体声明和响应式细节。
- `public/interactions.css`：**首页专属**的鼠标交互层（导航下划线、按钮柔光、卡片抬起、封面推近等 15 项）。所有规则都限定在 `body[data-page="home"]`，其他页面不受影响。由 `documentPage()` 用 `<link>` 引入，**不要改成 `collage.css` 里的 `@import`**：该文件开头已有 `@font-face`，而 CSS 规定 `@import` 必须位于所有规则之前，否则整条被浏览器丢弃，交互会静默失效。规则包在 `@media(hover:hover) and (pointer:fine)` 内，只用 transform / 颜色 / 阴影 / 伪元素，不改变布局。
- `public/details.css`、`public/details.js`：全站共享的按钮、导航、卡片、照片框、弹窗、阅读进度、滚动入场、全站动效开关，以及右下角的回到顶部浮窗。
- `public/styles.css`：颜色、排版、组件与响应式样式。
- `public/app.js`：菜单、弹窗、图片查看、复制及图片失败处理。
- `scripts/build.mjs`：生成 `dist` 中的静态网站。
- `scripts/serve.mjs`：仅绑定本机地址的预览服务。
- `scripts/check.mjs`：验证生成的页面与资源链接。
- `scripts/inspect.mjs`：页面几何自检（`npm run inspect`，可带路由参数）。让页面自行测量关键元素的坐标并渲染成文本，再用 headless 截图取回，输出到 `verify/`。这台机器上 Chrome 的主进程 IPC 走命名管道，受限令牌沙箱禁止跨进程打开命名管道，因此无法用 DevTools 协议驱动真实滚动；这个脚本是那类测量的替代办法。
- `scripts/verify-home-scope.mjs`：首页隔离自检（`npm run verify:scope`）。逐页比对，确认交互层与文案改动只落在首页、其他页面的共享行为与还原前一致。`verify/` 只是本地排查产物，不要提交。

### 改动范围约定（多人协作）

`src/` 里只有 `hero.mjs`、`pages.mjs` 属于首页；`components.mjs` 的导航与页脚、`details.*`、`collage.css`、`community.*`、`workshop.*`、`learning.mjs` 等被多个页面共用，改动前请与对应负责人确认。本次首页改动的落点：

| 内容 | 位置 | 是否影响其他页 |
| --- | --- | --- |
| 首屏浮动动效 | `public/hero.css` | 否（仅首页加载） |
| 鼠标交互 15 项 | `public/interactions.css`（新文件）+ `body[data-page="home"]` | 否 |
| 首页加入区文案 | `src/hero.mjs` 的 `homeJoinSection()` | 否 |
| 引入 `interactions.css` | `src/components.mjs` 的 `documentPage()` 一行 `<link>` | 是（所有页面都会加载该文件，但规则被首页选择器挡掉） |

`npm run build` 后执行 `npm run check` 进行基础检查。活动日期、地点、照片、项目资料和入群方式仍为明确占位。

首屏动画在素材就绪后播放一次（等待上限 1.8 秒），不提供重播或暂停控件。入场落座后，三张纸转入幅度 7px 的极轻浮沉（`float-soft`，与各自终态旋转对齐，衔接不跳变）。系统开启“减少动态效果”时展示静态完整版，并同样关闭滚动入场与其他装饰动效。关闭 JavaScript 后品牌与内容仍可见。

页脚的全站动效开关、`window.NanoCampMotion` 与「复制页面链接」按钮**保持原状**，属共享件，本次未改动。

`body` 上的 `id="top"` 已移除，回到顶部改为右下角的圆形浮窗（`data-back-to-top`，`details.css` + `details.js`）。无 hash 时 `details.js` 会把 `history.scrollRestoration` 设为 `manual`，避免加载期间浏览器恢复到一个对不上的滚动位置；带 hash 的直达仍走原生锚点。首页按钮里的「+」保持静止，不随悬停旋转。

所有新增反馈均为渐进增强：按钮按压波纹会自动清理，卡片光泽只在精确指针移动时刷新，阅读进度随滚动更新，屏幕下方内容进入视口后仅显露一次。下滑超过一屏后，右下角出现圆形的回到顶部浮窗，用原生平滑滚动返回顶部，并尊重“减少动态效果”。占位内容维持不可点击；只有已填写的照片和链接提供查看、跳转等操作。项目封面、活动照片补齐后，会自动使用新的照片缩放与查看提示。

「加入方式」按钮在未配置二维码或联系方式时仍然打开弹窗，弹窗内是二维码预留卡与「加入渠道尚未公布」的说明；填入 `site.join.qrCode` 或 `contact` 后自动转为可用状态。

带 hash 的直达沿用浏览器原生锚点跳转；无 hash 时由页面把 `history.scrollRestoration` 设为 `manual`，避免加载期间浏览器自行恢复到一个对不上的滚动位置。修改 `public/hero.js` 或 `public/details.js` 时请保留这一行。

## 全年社区

- `src/community.mjs`：首页全年社区模块、活动总览、参与指南和常见问题。
- `content/community.mjs`：四种活动形式、FAQ 分类和问答。活动形式不是已排期的场次，不应在没有确认时改为招募或报名状态。
- `public/community.css`、`public/community.js`：社区页面布局、活动分类、FAQ 文本搜索、问题直达和可见时才播放的装饰轨道。
- 活动类型使用 `?topic=sharing` 等查询；FAQ 支持 `?topic=events&q=报名`。问题有稳定的 `#id`，直达时自动展开；文字搜索按空格拆分为多个关键词共同匹配。
- 无 JavaScript 时不显示搜索与筛选控件，所有活动形式和原生 FAQ 折叠项仍然可阅读。
- 导航在 860px 及以下改为菜单；CSS 与 `app.js` 的断点应同步维护。

增加联系方式、报名政策或未来场次后，请同时核对 FAQ 的当前状态说明。网页不会收集或提交报名信息；缺少的联系方式仍明确显示待公布。
## 共创资源与交流草稿

- `content/guides.mjs`：四篇通用共创指南、分节正文、准备清单、纯文本模板与外部官方学习入口。
- `src/learning.mjs`：资源中心及指南页面；`src/partners.mjs`：交流合作页面。
- `public/workshop.css` / `public/workshop.js` 仅在资源与合作页加载。
- 构建时自动生成 `dist/downloads/*-template.txt`，下载链接不依赖 JavaScript。
- 准备清单按指南存储在 `nanocamp-checklist-<slug>-v1` 本地键中。仅存勾选项标识；浏览器不允许存储时，本页仍可使用并显示说明。
- 合作工具只在当前页面生成文本，没有网络提交、数据库写入或自动保存。生成后可复制或下载；输入修改后需要重新生成；清空后可撤销。不要把此工具的文案改成「提交成功」或「申请已收到」，除非另外接入并验证真实接收流程。
- 官方学习链接核实于 2026-10-02。社区指南为通用准备建议，不代表某一届 minicamp 的实际规则。
## 站内发现

- 站内搜索 `/search/` 从公开页面、活动形式、指南正文与模板、FAQ 自动生成索引。填写真实作品标题后，该作品自动加入索引；`项目名称` 占位项不加入。作品 `id` 应保持唯一且稳定。
- `src/search.mjs` 生成索引和无脚本目录；`public/search-core.js` 提供规范化、多词共同匹配、排序及摘要；`public/search.js` 渐进增强查询、分类、分页及安全高亮。所有结果文本使用 DOM 文本节点。
- 搜索使用 `?q=关键词&type=guide`；空格分隔的词共同匹配，支持全角字符。无 JavaScript 或索引无法读取时回退为公开页面目录。
- 主导航搜索入口支持 Ctrl / Command + K，输入控件或打开的弹窗内不会触发。不会绑定纯字符快捷键。
- 导航的「更多」面板使用 `::details-content` 配合 `@starting-style` 与 `transition-behavior: allow-discrete` 实现缓入缓出；不支持这些特性的浏览器直接显示/隐藏面板，功能不受影响。精确指针设备上悬停即展开，键盘仍通过点击或 Enter 切换。
- `site.url` 是网站的正式公开地址，更换域名后需修改并重新构建。`src/metadata.mjs` 生成 canonical、Open Graph、社交卡片和基于真实页面内容的结构化数据。
- `design/social-card.html` 是分享预览图的原始排版，`public/images/nanocamp-social.png` 为 1200 × 630 输出。原始两张 Logo 不修改。
- `design/animation-lab.html` 是首页动效选型页（16 个纯 CSS 候选，按板块分组，右上角可重播或定格）。它不是站点页面，`npm run build` 不会生成；本地查看时执行 `Copy-Item design\animation-lab.html dist\`，再打开 `/animation-lab.html`。选定动效后，把对应 CSS 与标记并入正式样式与 `src/`。
- `npm test` 运行搜索核心、真实内容索引和内联 JSON 安全回归。
- 构建生成 `sitemap.xml` 与 `robots.txt`。搜索页和 404 标记为 noindex；站点地图只列入普通公开页面，不捏造最后更新时间。
- `scripts/check.mjs` 检查页面标题/描述、元素 ID、站内文件与锚点、搜索记录、内联 JSON、canonical 与社交元信息、站点地图和分享图尺寸。上线后仍需确认托管平台对未知地址返回 HTTP 404。
## minicamp 回顾与相册

- 年度回顾提供四个章节锚点：`#recap`、`#moments`、`#camp-projects`、`#keep-building`。顶部章节导航按阅读位置更新；窄屏保持紧凑，手机横屏时不额外占用固定高度。关闭脚本后仍是普通可用链接。
- `src/recap.mjs` 提供章节导航和相册结构。`public/recap.css/js` 只在 minicamp 回顾页加载；`public/gallery.css/js` 只在首页、回顾和作品页加载。
- 图片预览是直接指向原图的链接，在脚本可用时增强为相册。按活动现场、作品封面分组；相同原图不重复计数。提供缩略图、上一张/下一张、键盘方向键和 Home/End、触摸滑动、加载与失败重试。Esc 关闭后焦点回到原照片。
- `moments[].src` 可填写压缩后的预览图，另用可选的 `fullSrc` 指向原图；活动和作品封面分别使用 `event.coverFull`、`projects[].coverFull`。没有提供这些可选字段时，使用同一张图片。全部地址规则与原图片字段相同。
- 如果预览图无法加载，但配置了不同的原图地址，页面保留「点击查看原图」入口。缺少图片的占位框仍不生成假相册按钮。
- 相册尊重全站动效与系统减少动态效果设置；切换或关闭时清理待处理图片，不会让迟到的照片覆盖新选择。缩略图延迟加载；配置独立预览图时，原图只在选择时请求。
