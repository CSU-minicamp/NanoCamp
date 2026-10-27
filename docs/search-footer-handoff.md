# NanoCamp 搜索页页脚交接

> 2026-10-27 更新：main 已迁移为请求期渲染。下面的模板与行号保留自 2026-10-11 的交接快照；其中构建、dist 和启动流程已过时，以本说明和当前 README 为准。当前使用 `npm run dev`（默认 http://localhost:8080），无需 `npm run build`；backend/ 动态生成页面，静态资源从 public/ 提供，不再提交 dist/。修改后执行 `npm run check` 和 `npm test`。

整理日期：2026-10-11。源码基线：feat/search-page-style，3cb278a。

## 交接范围

当前样式仅用于搜索结果页。采用类似 Discord 的布局：上部左侧标语、右侧三列导航，下部通栏 NanoCamp 字标；整体使用浅蓝、薄荷绿渐变。本次仅新增交接文档，没有修改页面源码。

## 涉及文件与修改位置

以下路径相对于仓库根目录，行号对应本次源码基线；后续修改后可能变化。

| 分类 | 文件与位置 | 负责内容 / 修改说明 |
| --- | --- | --- |
| 主要修改入口 | [src/components.mjs](../src/components.mjs)，105–107 行 | footer(active) 的搜索页分支：标语、三列导航、底部字标 HTML。其他页面走 sharedFooter()，不要误改。 |
| 主要修改入口 | [public/search.css](../public/search.css)，99–117 行 | 页脚高度、渐变、网格、字体、颜色、字标尺寸；120、137–140 行为响应式规则。 |
| 显示条件 | [public/search.css](../public/search.css)，11 行；[public/search.js](../public/search.js)，69 行 | 通过 body 的 data-search-state 控制搜索页页脚是否显示。 |
| 文案同步依赖 | [public/base.js](../public/base.js)，122 行 signoff()、162 行 footerBottom() | 客户端重建 data-nav="footer-bottom"。修改社区说明文案时，要同步这里与 components.mjs 中的静态文案。 |
| 公共样式依赖 | [public/styles.css](../public/styles.css)，2、19 行 | 基础字体、容器与全局布局规则。 |
| 公共样式依赖 | [public/base.css](../public/base.css) | site-footer、footer-bottom、footer-signoff 等公共样式。 |
| 公共样式依赖 | [public/collage.css](../public/collage.css)，977–982 行 | 品牌色类与标语分行；同时提供公共字体及页脚覆盖样式。 |
| 图片资源 | [public/images/nanocamp-wordmark-1170.webp](../public/images/nanocamp-wordmark-1170.webp) | 1170 × 290 的现有品牌字标；当前直接引用，没有重画或改色。 |
| 样式加载 | [src/components.mjs](../src/components.mjs)，documentPage() | 仅搜索页在公共样式后加载 search.css，且 body 带 data-page="search"。 |
| 构建入口 | [scripts/build.mjs](../scripts/build.mjs)，20 行 | 生成页面并将 public 资源复制到 dist。 |
| 关联回归检查 | [tests/nav.test.mjs](../tests/nav.test.mjs) | 检查静态和客户端页脚底部的一致性。 |

构建产物：dist/search/index.html、dist/search.css、dist/base.js、dist/search.js、dist/styles.css、dist/base.css、dist/collage.css、dist/images/nanocamp-wordmark-1170.webp。这些是对应输出，修改应从上表源码入口开始，然后构建；不要只修改 dist。

## 当前样式规格

| 项目 | 当前设置 |
| --- | --- |
| 页脚高度 | min-height: 100svh，至少一屏，内容多时自然增长 |
| 桌面内边距 | 顶部 110px，底部 46px |
| 内容宽度 | 最大 1360px，左右合计留白 80px |
| 上部布局 | 标语 / 导航为 1fr : 1.35fr，间距 70px |
| 导航 | 三列，列间距 28px；标题 16px，链接 19px |
| 标语 | 30–50px 自适应；蓝色 #557fcf、绿色 #4d8577 |
| 辅助文字 / 链接 | #607a91 / #405f82；悬停 #355ba2 |
| 字标 | 占容器全宽，高度等比；multiply 混合图片底色 |
| 上下部间距 | clamp(48px, 7vh, 90px)，内层垂直居中 |
| ≤900px | 上部改为单列，标语和导航间距 44px |
| ≤600px | 顶部 48px；容器左右合计留白 40px；上下部间距 42px；导航链接 14px |

页面背景为浅蓝到浅绿的渐变；页脚从透明开始，逐渐过渡到浅蓝、薄荷绿。这里是颜色的空间渐变，并非滚动触发的渐入渐出动画。

## 当前 HTML 模板

以下直接从 footer('search') 提取，保留现有链接、图片与客户端挂载点。

```html
<footer class="site-footer search-footer">
<div class="container search-footer-inner">
<div class="search-footer-top">
<div class="search-footer-message">
<p class="footer-slogan">
<span class="brand-blue">Meet. Build.</span>
<span class="brand-mint">Make something together.</span>
</p>
<div data-nav="footer-bottom">
<div class="footer-bottom">
<span class="footer-signoff">
<i aria-hidden="true">
</i>一个属于学生创造者的社区。</span>
</div>
</div>
</div>
<nav class="search-footer-nav" aria-label="页脚导航">
<div>
<h2>发现</h2>
<a href="/minicamp/">年度 minicamp</a>
<a href="/activities/">活动总览</a>
<a href="/projects/">社区作品</a>
</div>
<div>
<h2>一起创造</h2>
<a href="/community/">参与指南</a>
<a href="/resources/">共创资源</a>
<a href="/partners/">交流合作</a>
</div>
<div>
<h2>了解社区</h2>
<a href="/faq/">常见问题</a>
<a href="/about/">关于我们</a>
<a href="/search/">站内搜索</a>
</div>
</nav>
</div>
<a class="search-footer-wordmark" href="/" aria-label="NanoCamp 首页">
<img src="/images/nanocamp-wordmark-1170.webp" alt="NanoCamp" width="1170" height="290" loading="lazy" decoding="async">
</a>
</div>
</footer>
```

## 当前 CSS 模板

以下只提取页脚相关样式与响应式规则，避免把搜索框、内容卡片样式一起复制。

```css
body[data-page="search"] .search-footer {
  min-height: 100svh;
  padding: 110px 0 46px;
  background: linear-gradient(180deg, transparent 0%, #e1ecfc55 15%, #d8e7fdcc 46%, #daf2e8 100%);
  border-top: 0;
  display: flex;
}
body[data-page="search"] .search-footer-inner { display: flex; flex-direction: column; justify-content: center; gap: clamp(48px, 7vh, 90px); max-width: 1360px; width: calc(100% - 80px); }
body[data-page="search"] .search-footer-top { display: grid; grid-template-columns: 1fr 1.35fr; gap: 70px; }
body[data-page="search"] .search-footer .footer-slogan { font-family: var(--font); font-size: clamp(30px, 3.4vw, 50px); line-height: 1.45; font-weight: 700; margin: 0; }
body[data-page="search"] .search-footer .brand-blue { color: #557fcf; }
body[data-page="search"] .search-footer .brand-mint { color: #4d8577; }
body[data-page="search"] .search-footer .footer-bottom { border: 0; padding-top: 22px; font-size: 16px; color: #607a91; }
body[data-page="search"] .search-footer-nav { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; }
body[data-page="search"] .search-footer-nav h2 { font-family: var(--font); font-size: 16px; font-weight: 500; color: #7389a3; margin-bottom: 22px; }
body[data-page="search"] .search-footer-nav a { display: block; width: fit-content; padding-block: 14px; font-size: 19px; color: #405f82; }
body[data-page="search"] .search-footer-nav a:hover { color: #355ba2; text-decoration: underline; text-underline-offset: 5px; }
body[data-page="search"] .search-footer-wordmark { display: block; width: 100%; }
body[data-page="search"] .search-footer-wordmark img { display: block; width: 100%; height: auto; mix-blend-mode: multiply; }
@media (max-width: 900px) {
  body[data-page="search"] .search-footer-top { grid-template-columns: 1fr; gap: 44px; }
}
@media (max-width: 600px) {
  body[data-page="search"] .search-footer { padding-top: 48px; }
  body[data-page="search"] .search-footer-inner { gap: 42px; width: calc(100% - 40px); }
  body[data-page="search"] .search-footer-nav { gap: 12px; }
  body[data-page="search"] .search-footer-nav a { font-size: 14px; padding-block: 12px; }
}
```

该模板依赖公共样式中的字体变量、容器居中、全局盒模型、标语 span 分行及 footer-signoff 小圆点样式，因此不是完全独立的组件。迁移至其他页面时，需要明确加载这些依赖，并调整 body[data-page="search"] 的作用域；不要直接复制搜索状态隐藏规则。

## 显示行为与交接注意事项

- 有有效搜索关键词时，body 设置 data-search-state="results"，结果区与页脚显示；无关键词的 /search/ 会隐藏主搜索区域及页脚，仅保留导航等公共部分。
- 搜索完成后清空输入框不会立即清空结果或隐藏页脚；用户可以重新输入并回车搜索。空内容回车不提交。
- 页脚的“站内搜索”链接指向 /search/，不带关键词，因此会进入上述无关键词状态。
- 修改“一个属于学生创造者的社区。”时，必须同步静态 HTML 和 base.js 的搜索页 signoff() 分支，否则客户端挂载后会覆盖静态文案。
- 修改布局、颜色、渐变优先在 search.css 的搜索页作用域内完成；公共 CSS 的调整可能影响其他页面。
- 修改品牌图片前确认背景兼容性；当前通过 mix-blend-mode: multiply 融合图片底色。

## 常见修改任务对应位置

| 想修改的内容 | 修改位置 |
| --- | --- |
| Meet. Build. 等标语、导航标题与链接 | components.mjs 的 footer('search') 分支 |
| 社区说明文案 | components.mjs + base.js 的 signoff() |
| 渐变、留白、字体大小、导航列间距 | search.css 的页脚规则及两个断点 |
| 底部 logo | components.mjs 的图片路径 + public/images 资源；尺寸在 search.css |
| 页脚显示时机 | search.js 的搜索状态 + search.css 第 11 行隐藏规则 |

## 本地验证流程

在仓库根目录执行：

```powershell
npm run build
npm run check
npm test
npm start
```

若预览服务已启动，不要重复占用端口。用 [搜索结果预览](http://127.0.0.1:4187/search/?q=%E7%BB%84%E9%98%9F) 查看页脚，不要用无关键词的 /search/ 验证可见性。

人工检查：桌面及 900px、600px 附近的布局；三列导航是否拥挤；底部字标是否保持比例；结果区到页脚的渐变是否连贯；清空并重新回车搜索后页脚仍正常显示、页面位置保持。

本次文档根据当前源码整理，HTML/CSS 模板由源码提取；本次没有重新运行页面构建、测试或进行浏览器视觉验收。
