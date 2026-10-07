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
7. 作品的 `slug` 决定详情页地址 `/projects/<slug>/`，填写后应尽量保持稳定；缺省时回退为 `/projects/project-<id>/`。字段为：`description`（一句话简介）、`problem` / `solution`（问题与做法，换行即分段）、`theme`（活动主题，列表页据此分组）、`team` / `year`（队伍与年份）、`tools`（工具标签数组，卡片显示前 3 个）、`members`（`{name, role}` 数组）、`cover` / `coverAlt` / `coverFull`（封面与点击查看的原图）、`repoUrl`（GitHub 仓库）、`demoUrl`（在线体验）、`sourceId`（上游系统编号，用于去重）。未提供的地址保持 `null`，页面显示「待补充」而不是编造内容。标题仍为「项目名称」的占位项不会进入列表、详情页路由与站内搜索。
8. `moments` 中填写照片、描述与图注。填写真实图片后自动支持点击查看大图。
9. 执行 `npm run build` 更新生成页面。

外部项目链接使用完整的 http 或 https 地址。未提供的地址保持 `null`，页面会显示待补充状态。

## 合作页面

合作页按「三个合作案例 → 接受的合作类型 → 我们能提供什么 → 希望合作方提供什么 → 合作邮箱」排列，主要内容集中在 `content/partners.mjs`：

- `cases`：赛百味、bonjour！交友卡片、OpenDev。`logo` 是品牌图片路径，`summary` 是卡片简介，`period` 是合作时间；`sponsorship` 和 `promotion` 分别列出赞助内容与社区提供的宣传支持。未确认具体日期时保留待补充说明。`id` 用于页面锚点和站内搜索，请保持唯一且稳定。
- `cases[].photos`：风采照片数组，初始为空并显示照片占位。将照片放入 `public/images/` 后，添加 `{ src: '/images/照片文件名.jpg', alt: '照片描述', caption: '可选图注' }` 即可展示。可选的 `url` 用于真实合作记录链接。
- `formats`、`offers`、`requests`：合作方向与双方支持的初稿，可直接改标题和说明；实际合作安排由双方另行确认。
- `email`：合作邮箱为 `qmzjyyds@163.com`，点击后复制到剪贴板。复制受浏览器限制时会选中邮箱供手动复制；没有邮箱时明确显示「合作邮箱待补充」。

`src/partners.mjs` 负责页面，`public/partners.css` 和 `public/partners.js` 仅在合作页加载。点击品牌卡片会放大为居中的详情卡片，支持关闭按钮、点击遮罩、Esc 关闭与键盘焦点循环；减少动态效果或暂停全站动效后立即展示详情。关闭 JavaScript 时，合作详情直接显示，卡片仍可跳转到对应记录。联系区的本地草稿工具由 `src/partner-draft.mjs` 和 `public/workshop.js` 提供，输入与选项变化会实时同步到预览；填写主题后可复制或下载，清空后可撤销。共享页脚将标语放在 Logo 下方，标题与标语采用 Logo 的蓝色与薄荷绿。网站不会代发邮件或提交申请。修改后运行 `npm run build`、`npm run check` 和 `npm test`。

## 文件说明

- `src/components.mjs`：卡片、媒体、弹窗与文档外壳；构建期输出与 `public/base.js` 一致的导航及页脚署名。`documentPage()` 为内容页（含子页面与 404）统一追加 minicamp 同款加入区和页脚；首页保留 `homeJoinSection()` 专属加入区，站内搜索保留简洁页脚且不追加加入区。
- `public/base.js`：导航、页脚底部与回到顶部的统一数据源及客户端渲染入口。桌面与手机导航均为「首页、minicamp、活动、作品、社区、交流合作、站内搜索」，全部直接显示；共创资源、关于我们与常见问题保留在页脚。首页使用 `home` 标记当前项。静态模板与客户端渲染由导航测试逐节点比对，搜索项保留 Ctrl/⌘ + K 快捷键钩子。
- `public/base.css`：与 `base.js` 配套的站点框架样式，包含顶部栏、桌面/手机导航、共用的 minicamp 同款加入区与页脚、回到顶部浮窗。在 `styles.css` 之后、页面皮肤之前加载；内容页的加入区使用 `join-shared`，首页保留专属加入区与 `home.css` 样式；页脚通过 `footer-shared` 保持各页一致，搜索页除外。浮窗显隐由 `data-visible` 驱动，`details.js` 判断滚动距离。
- `src/pages.mjs`：页面路由与首页、活动回顾、关于页面的内容结构；作品详情页按 `projects` 动态展开。
- `src/projects.mjs`：作品卡片、列表页与详情页；`projectSlug` / `projectPath` 生成地址，`readyProjects` 过滤占位项。
- `public/projects.css`：作品卡片标签、主题分组与详情页版式，在 `gallery.css` 之后、`collage.css` 之前加载。
- `scripts/sync-minicamp-projects.mjs`：从 minicamp 官方接口 `https://minicamp.flipperusc.work/api/projects` 拉取已发布作品，按主题、队伍、编号排序后生成 `projects` 数组片段，加 `--write-images` 会把接口内嵌的 base64 封面导出到 `public/images/projects/`。默认只打印结果，不改动 `content/site.mjs`。
- `src/hero.mjs`：首页品牌舞台与首页专属加入区；`homeJoinSection()` 保留首页邀请文案与加入渠道提示，首页只渲染一次加入区。
- `public/hero.css`、`public/hero.js`：B 版首屏海报与入场动效，仅在首页加载。
- `public/interactions.css`：**首页专属**的鼠标交互层（导航下划线、按钮柔光、卡片抬起、封面推近等 15 项）。所有规则都限定在 `body[data-page="home"]`，其他页面不受影响。由 `documentPage()` 用 `<link>` 引入，**不要改成 `collage.css` 里的 `@import`**：该文件开头已有 `@font-face`，而 CSS 规定 `@import` 必须位于所有规则之前，否则整条被浏览器丢弃，交互会静默失效。规则包在 `@media(hover:hover) and (pointer:fine)` 内，只用 transform / 颜色 / 阴影 / 伪元素，不改变布局。
- `public/collage.css`：当前纸张拼贴视觉的全站样式、字体声明和响应式细节。
- `public/details.css`、`public/details.js`：全站共享的按钮、卡片、照片框、弹窗、阅读进度与滚动入场（导航/页脚/浮窗样式已移到 `public/base.css`）。动效偏好只跟随系统的 `prefers-reduced-motion`：「暂停全站动效」按钮已移除，`window.NanoCampMotion` 仍暴露 `stopped` / `subscribe` 供社区页、相册与合作页判断。
- `public/styles.css`：颜色、排版、组件与响应式样式。
- `public/app.js`：弹窗、图片查看、复制及图片失败处理（导航交互已移至 `public/base.js`）。
- `scripts/build.mjs`：生成 `dist` 中的静态网站。
- `scripts/serve.mjs`：仅绑定本机地址的预览服务。
- `scripts/check.mjs`：验证生成的页面与资源链接。
- `scripts/inspect.mjs`：页面几何自检（`npm run inspect`，可带路由参数）。让页面自行测量关键元素的坐标并渲染成文本，再用 headless 截图取回，输出到 `verify/`。这台机器上 Chrome 的主进程 IPC 走命名管道，受限令牌沙箱禁止跨进程打开命名管道，因此无法用 DevTools 协议驱动真实滚动；这个脚本是那类测量的替代办法。
- `scripts/verify-home-scope.mjs`：首页隔离自检（`npm run verify:scope`）。逐页比对，确认交互层与文案改动只落在首页、其他页面的共享行为与还原前一致。`verify/` 只是本地排查产物，不要提交。

`npm run build` 后执行 `npm run check` 进行基础检查。活动日期、地点、照片、项目资料和入群方式仍为明确占位。

首屏动画在素材就绪后播放一次（等待上限 1.8 秒），不提供重播或暂停控件。入场落座后，三张纸转入幅度 7px 极轻浮沉（`float-soft`，与各自终态旋转对齐，衔接不跳变）。系统开启“减少动态效果”时展示静态完整版，并同样关闭滚动入场与其他装饰动效。关闭 JavaScript 后品牌与内容仍可见。

页脚提供全站动效开关，与首屏暂停、重播保持同步。偏好使用本地 `nanocamp-motion-paused` 设置跨页保存；浏览器禁止存储时，当页操作仍可用。系统的减少动态效果设置优先。`details.js` 在 `hero.js` 之前加载，通过 `window.NanoCampMotion` 共享状态。

所有新增反馈均为渐进增强：按钮按压波纹会自动清理，卡片光泽只在精确指针移动时刷新，阅读进度随滚动更新，屏幕下方内容进入视口后仅显露一次。占位内容维持不可点击；只有已填写的照片和链接提供查看、跳转等操作。项目封面、活动照片补齐后，会自动使用新的照片缩放与查看提示。

## 作品列表与详情

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

- `content/guides.mjs`：四篇通用共创指南、分节正文、准备清单、纯文本模板与外部官方学习入口。
- `src/learning.mjs`：资源中心及指南页面；`src/partners.mjs`：交流合作页面。
- `public/workshop.css` / `public/workshop.js` 仅在资源与合作页加载。
- 构建时自动生成 `dist/downloads/*-template.txt`，下载链接不依赖 JavaScript。
- 准备清单按指南存储在 `nanocamp-checklist-<slug>-v1` 本地键中。仅存勾选项标识；浏览器不允许存储时，本页仍可使用并显示说明。
- 合作工具只在当前页面生成文本，没有网络提交、数据库写入或自动保存。生成后可复制或下载；输入修改后需要重新生成；清空后可撤销。不要把此工具的文案改成「提交成功」或「申请已收到」，除非另外接入并验证真实接收流程。
- 官方学习链接核实于 2026-10-02。社区指南为通用准备建议，不代表某一届 minicamp 的实际规则。
## 站内发现

- 站内搜索 `/search/` 从公开页面、活动形式、指南正文与模板、FAQ 自动生成索引。填写真实作品标题后，该作品自动加入索引并指向详情页；`项目名称` 占位项不加入。作品 `id` 应保持唯一且稳定，`slug` 决定详情页地址。
- `src/search.mjs` 生成索引和无脚本目录；`public/search-core.js` 提供规范化、多词共同匹配、排序及摘要；`public/search.js` 渐进增强查询、分类、分页及安全高亮。所有结果文本使用 DOM 文本节点。
- 搜索使用 `?q=关键词&type=guide`；空格分隔的词共同匹配，支持全角字符。无 JavaScript 或索引无法读取时回退为公开页面目录。
- 主导航搜索入口支持 Ctrl / Command + K，输入控件或打开的弹窗内不会触发。不会绑定纯字符快捷键。
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
