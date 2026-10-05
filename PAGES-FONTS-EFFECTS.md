# NanoCamp 各页面字体与特效汇总

> 本文件由脚本扫描 `public/*.css` 与 `dist/*.html` 生成，用于排查字体与动效的归属。
> 它记录的是**当前构建产物**的状态，改动源码后需重新生成。
> 这是本地排查用的说明文件，未纳入版本控制，也不应自动提交。

- 页面数：**35**（含 404）
- 样式表：**12** 个 · 脚本：**10** 个
- `@font-face`：**3** 条 · `@keyframes`：**32** 个动画名

## 一、字体

### 1.1 字体文件与 @font-face 声明

| 家族 | 权重 | display | unicode-range 覆盖 | 声明位置 | 来源文件 |
| --- | --- | --- | --- | --- | --- |
| `NanoLatin` | 400 800 | swap | （全量） | `collage.css` | `/fonts/nano-latin.woff2` |
| `NanoDisplay` | 700 900 | swap | 351 个码点 | `collage.css` | `/fonts/nano-display.woff2` |
| `NanoDisplay` | 700 900 | swap | 328 个码点 | `collage.css` | `/fonts/nano-display-ui.woff2` |

说明：`--font` / `--latin` 用 `NanoLatin`（拉丁与数字），`--display` 用 `NanoDisplay`（标题，按码点子集拆分两个文件），`--mono` 实为 `NanoLatin` 复用。中文字符由系统字体兜底。

### 1.2 字体变量的使用分布

| 声明文件 | font-family 取值 | 用到的选择器数 | 代表性选择器 |
| --- | --- | --- | --- |
| `collage.css` | `var(--display)` | 2 | `h1,h2,h3`、`.row-label` |
| `collage.css` | `var(--latin)` | 11 | `.event-page-hero h1`、`.community-badge b`、`.ticket-number strong` |
| `collage.css` | `var(--font)` | 1 | `.guide-template pre` |
| `community.css` | `var(--mono)` | 6 | `.program-card::after`、`.ticket-number strong`、`.ticket-cut` |
| `details.css` | `var(--mono)` | 1 | `.media-label > span:last-child` |
| `discovery.css` | `var(--mono)` | 1 | `.missing-art` |
| `gallery.css` | `var(--latin)` | 1 | `.album-thumbnails button>span` |
| `hero.css` | `var(--display)` | 3 | `.b-intro h1`、`.b-mint-caption strong`、`.b-note-title` |
| `hero.css` | `var(--latin)` | 3 | `.b-sheet-top>span:last-child`、`.b-print`、`.b-sheet-bottom` |
| `partners.css` | `var(--display)` | 3 | `.collab-case-sheet h3>span`、`.collab-detail-header h2`、`.collab-detail-header h2>span` |
| `partners.css` | `var(--latin),var(--display)` | 2 | `.collab-case--lilac h3`、`.collab-case--lilac .collab-detail-heade…` |
| `partners.css` | `var(--latin)` | 1 | `.collab-case--yellow h3` |
| `partners.css` | `inherit` | 1 | `.collab-email-link` |
| `styles.css` | `var(--font)` | 1 | `body` |
| `styles.css` | `var(--mono)` | 4 | `.mono,.eyebrow`、`.interest-strip .container`、`.media-glyph` |
| `styles.css` | `Arial,sans-serif` | 2 | `.join-symbol`、`.project-page-symbol` |
| `styles.css` | `Georgia,serif` | 1 | `.event-cover-word i` |
| `workshop.css` | `var(--mono)` | 1 | `.guide-cover>b` |
| `workshop.css` | `var(--font)` | 1 | `.template-paper` |

## 二、各页面加载的样式与脚本

同一组合的页面已合并。`hero.css` / `hero.js` 只在首页；`projects.css`、`partners.css`、`recap.css`、`workshop.css` 按页面类型加载。

### 2.1 速查表（全部页面）

| 路由 | data-page | CSS 数 | JS 数 | 该页独占的样式/脚本 |
| --- | --- | --- | --- | --- |
| `/` | `home` | 9 | 6 | `/gallery.css`、`/projects.css`、`/hero.css`、`/gallery.js`、`/hero.js` |
| `/404.html` | `missing` · noindex | 6 | 4 | — |
| `/about/` | `about` | 6 | 4 | — |
| `/activities/` | `activities` | 6 | 4 | — |
| `/community/` | `community` | 6 | 4 | — |
| `/faq/` | `faq` | 6 | 4 | — |
| `/minicamp/` | `minicamp` | 9 | 6 | `/gallery.css`、`/projects.css`、`/recap.css`、`/gallery.js`、`/recap.js` |
| `/partners/` | `partners` | 8 | 6 | `/workshop.css`、`/partners.css`、`/partners.js`、`/workshop.js` |
| `/projects/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/aiclassrep/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/build-to-taste-light-of-yuelu/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/csu-online-game/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/memodot/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-02/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-05/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-06/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-07/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-08/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-10/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-12/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-13/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-14/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-15/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-16/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-17/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-18/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-19/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/project-20/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/projects/supernote/` | `projects` | 8 | 5 | `/gallery.css`、`/projects.css`、`/gallery.js` |
| `/resources/` | `resources` | 7 | 5 | `/workshop.css`、`/workshop.js` |
| `/resources/demo-story/` | `resources` | 7 | 5 | `/workshop.css`、`/workshop.js` |
| `/resources/find-your-team/` | `resources` | 7 | 5 | `/workshop.css`、`/workshop.js` |
| `/resources/from-idea-to-demo/` | `resources` | 7 | 5 | `/workshop.css`、`/workshop.js` |
| `/resources/host-a-sharing/` | `resources` | 7 | 5 | `/workshop.css`、`/workshop.js` |
| `/search/` | `search` · noindex | 6 | 5 | `/search.js` |

> `interactions.css` 每个页面都会加载，但规则限定 `body[data-page="home"]`，只对首页生效；上表把它算作公共样式。

### 2.2 按资产组合分组

### 1 个页面（data-page: `home`）

- 标题：NanoCamp · 让有趣的人相遇
- 页面：`/`
- CSS：`/styles.css`、`/details.css`、`/community.css`、`/discovery.css`、`/gallery.css`、`/projects.css`、`/collage.css`、`/hero.css`、`/interactions.css`
- JS：`/app.js`、`/details.js`、`/community.js`、`/discovery.js`、`/gallery.js`、`/hero.js`

### 1 个页面（data-page: `missing` · noindex）

- 标题：页面未找到 · NanoCamp
- 页面：`/404.html`
- CSS：`/styles.css`、`/details.css`、`/community.css`、`/discovery.css`、`/collage.css`、`/interactions.css`
- JS：`/app.js`、`/details.js`、`/community.js`、`/discovery.js`

### 1 个页面（data-page: `about`）

- 标题：关于社区 · NanoCamp
- 页面：`/about/`
- CSS：`/styles.css`、`/details.css`、`/community.css`、`/discovery.css`、`/collage.css`、`/interactions.css`
- JS：`/app.js`、`/details.js`、`/community.js`、`/discovery.js`

### 1 个页面（data-page: `activities`）

- 标题：活动总览 · NanoCamp
- 页面：`/activities/`
- CSS：`/styles.css`、`/details.css`、`/community.css`、`/discovery.css`、`/collage.css`、`/interactions.css`
- JS：`/app.js`、`/details.js`、`/community.js`、`/discovery.js`

### 1 个页面（data-page: `community`）

- 标题：参与社区 · NanoCamp
- 页面：`/community/`
- CSS：`/styles.css`、`/details.css`、`/community.css`、`/discovery.css`、`/collage.css`、`/interactions.css`
- JS：`/app.js`、`/details.js`、`/community.js`、`/discovery.js`

### 1 个页面（data-page: `faq`）

- 标题：常见问题 · NanoCamp
- 页面：`/faq/`
- CSS：`/styles.css`、`/details.css`、`/community.css`、`/discovery.css`、`/collage.css`、`/interactions.css`
- JS：`/app.js`、`/details.js`、`/community.js`、`/discovery.js`

### 1 个页面（data-page: `minicamp`）

- 标题：minicamp 2026 活动回顾 · NanoCamp
- 页面：`/minicamp/`
- CSS：`/styles.css`、`/details.css`、`/community.css`、`/discovery.css`、`/gallery.css`、`/projects.css`、`/recap.css`、`/collage.css`、`/interactions.css`
- JS：`/app.js`、`/details.js`、`/community.js`、`/discovery.js`、`/gallery.js`、`/recap.js`

### 1 个页面（data-page: `partners`）

- 标题：交流与合作 · NanoCamp
- 页面：`/partners/`
- CSS：`/styles.css`、`/details.css`、`/community.css`、`/discovery.css`、`/workshop.css`、`/collage.css`、`/partners.css`、`/interactions.css`
- JS：`/app.js`、`/details.js`、`/partners.js`、`/community.js`、`/discovery.js`、`/workshop.js`

### 21 个页面（data-page: `projects`）

- 页面：`/projects/`、`/projects/aiclassrep/`、`/projects/build-to-taste-light-of-yuelu/`、`/projects/csu-online-game/`、`/projects/memodot/`、`/projects/project-02/`、`/projects/project-05/`、`/projects/project-06/`、`/projects/project-07/`、`/projects/project-08/`、`/projects/project-10/`、`/projects/project-12/`、`/projects/project-13/`、`/projects/project-14/`、`/projects/project-15/`、`/projects/project-16/`、`/projects/project-17/`、`/projects/project-18/`、`/projects/project-19/`、`/projects/project-20/`、`/projects/supernote/`
- CSS：`/styles.css`、`/details.css`、`/community.css`、`/discovery.css`、`/gallery.css`、`/projects.css`、`/collage.css`、`/interactions.css`
- JS：`/app.js`、`/details.js`、`/community.js`、`/discovery.js`、`/gallery.js`

### 5 个页面（data-page: `resources`）

- 页面：`/resources/`、`/resources/demo-story/`、`/resources/find-your-team/`、`/resources/from-idea-to-demo/`、`/resources/host-a-sharing/`
- CSS：`/styles.css`、`/details.css`、`/community.css`、`/discovery.css`、`/workshop.css`、`/collage.css`、`/interactions.css`
- JS：`/app.js`、`/details.js`、`/community.js`、`/discovery.js`、`/workshop.js`

### 1 个页面（data-page: `search` · noindex）

- 标题：站内搜索 · NanoCamp
- 页面：`/search/`
- CSS：`/styles.css`、`/details.css`、`/community.css`、`/discovery.css`、`/collage.css`、`/interactions.css`
- JS：`/app.js`、`/details.js`、`/community.js`、`/discovery.js`、`/search.js`

## 三、动效来源

### 3.1 @keyframes 动画字典

| 动画名 | 定义位置 |
| --- | --- |
| `backdrop-arrive` | `details.css` |
| `collab-place` | `partners.css` |
| `community-curve-enter` | `collage.css` |
| `community-orbit` | `community.css` |
| `community-paper-drift` | `collage.css` |
| `community-soft-enter` | `collage.css` |
| `dialog-arrive` | `details.css` |
| `float-soft` | `hero.css` |
| `mark-in` | `hero.css` |
| `menu-unfold` | `details.css` |
| `minicamp-breathe` | `recap.css` |
| `minicamp-footer-mark` | `recap.css` |
| `minicamp-join-lines` | `recap.css` |
| `minicamp-mark-float` | `recap.css` |
| `minicamp-mark-orbit` | `recap.css` |
| `minicamp-mark-spin` | `recap.css` |
| `minicamp-mark-spin-reverse` | `recap.css` |
| `minicamp-photo-sweep` | `recap.css` |
| `minicamp-signal` | `recap.css` |
| `minicamp-stamp` | `recap.css` |
| `minicamp-star` | `recap.css` |
| `minicamp-sweep` | `recap.css` |
| `minicamp-track` | `recap.css` |
| `nc-sheen` | `interactions.css` |
| `note-in` | `hero.css` |
| `photo-arrive` | `gallery.css` |
| `photo-dot` | `gallery.css` |
| `sheet-one` | `hero.css` |
| `sheet-two` | `hero.css` |
| `sticker-in` | `community.css` |
| `tap-wave` | `details.css` |
| `wordmark-in` | `hero.css` |

### 3.2 谁在触发这些动画

按 `animation:` 的声明位置列出。

| 选择器 | 声明文件 | animation 值 |
| --- | --- | --- |
| `.activity-orbit` | `community.css` | `community-orbit 36s linear infinite` |
| `.album-photo` | `gallery.css` | `photo-arrive .25s ease both` |
| `.collab-case-sheet` | `partners.css` | `collab-place .85s var(--ease) backwards` |
| `.collab-detail[open]` | `partners.css` | `none` |
| `.missing-orbit` | `collage.css` | `none` |
| `.missing-orbit i` | `collage.css` | `none` |
| `.mobile-nav:not([hidden])` | `details.css` | `menu-unfold .3s var(--detail-ease) both` |
| `.motion-stopped *, .motion-stopped *::before, .m…` | `details.css` | `none !important` |
| `.photo-loader i` | `gallery.css` | `photo-dot 1.1s ease-in-out infinite` |
| `.poster-b.is-intro .b-mark-wrap` | `hero.css` | `mark-in 1s .15s var(--ease) both` |
| `.poster-b.is-intro .b-note` | `hero.css` | `note-in .85s .2s var(--ease) both,float-soft 4.6s ease-in-out 1.05s in…` |
| `.poster-b.is-intro .b-sheet-lilac` | `hero.css` | `sheet-one 1s var(--ease) both,float-soft 4.6s ease-in-out 1s infinite` |
| `.poster-b.is-intro .b-sheet-mint` | `hero.css` | `sheet-two 1.1s .1s var(--ease) both,float-soft 4.6s ease-in-out 1.2s i…` |
| `.site-header .brand-asset` | `hero.css` | `wordmark-in .8s .2s var(--ease) both` |
| `.tap-wave` | `details.css` | `tap-wave .58s var(--detail-ease) both` |
| `body.motion-stopped .activity-orbit` | `community.css` | `none` |
| `body.motion-stopped .collab-case-sheet,body.moti…` | `partners.css` | `none` |
| `body[data-page="minicamp"] .camp-banner > strong` | `recap.css` | `minicamp-breathe 5s ease-in-out infinite` |
| `body[data-page="minicamp"] .camp-banner::before` | `recap.css` | `minicamp-sweep 6s ease-in-out infinite` |
| `body[data-page="minicamp"] .community-help::afte…` | `recap.css` | `minicamp-star 8s linear infinite` |
| `body[data-page="minicamp"] .edition-stamp` | `recap.css` | `minicamp-stamp 7s ease-in-out infinite` |
| `body[data-page="minicamp"] .event-cover .media-f…` | `recap.css` | `minicamp-photo-sweep 7s ease-in-out infinite` |
| `body[data-page="minicamp"] .event-page-hero .tit…` | `recap.css` | `minicamp-star 6s var(--ease) infinite` |
| `body[data-page="minicamp"] .event-page-hero::aft…` | `recap.css` | `minicamp-track 8s linear infinite` |
| `body[data-page="minicamp"] .event-page-hero::bef…` | `recap.css` | `minicamp-signal 5s var(--ease) infinite` |
| `body[data-page="minicamp"] .footer-signoff-mark …` | `recap.css` | `minicamp-footer-mark 6s ease-in-out infinite` |
| `body[data-page="minicamp"] .join-minicamp::befor…` | `recap.css` | `minicamp-join-lines 12s linear infinite` |
| `body[data-page="minicamp"] .recap-brand-mark .br…` | `recap.css` | `minicamp-mark-float 5s ease-in-out infinite` |
| `body[data-page="minicamp"] .recap-brand-mark::af…` | `recap.css` | `minicamp-mark-spin-reverse 15s linear infinite` |
| `body[data-page="minicamp"] .recap-brand-mark::be…` | `recap.css` | `minicamp-mark-spin 22s linear infinite` |
| `body[data-page="minicamp"] .recap-brand-orbit-a` | `recap.css` | `minicamp-mark-orbit 6s ease-in-out infinite` |
| `body[data-page="minicamp"] .recap-brand-orbit-b` | `recap.css` | `minicamp-mark-orbit 7s ease-in-out -2s infinite` |
| `dialog[open]` | `details.css` | `dialog-arrive .3s var(--detail-ease) both` |
| `dialog[open]::backdrop` | `details.css` | `backdrop-arrive .25s ease both` |

### 3.3 谁在驱动过渡

共 130 个选择器声明了 `transition`。

| 选择器 | 声明文件 | transition 值 |
| --- | --- | --- |
| `.activity-node` | `community.css` | `transform .5s cubic-bezier(.2,.75,.2,1)` |
| `.album-arrow` | `gallery.css` | `background .2s,border-color .2s` |
| `.album-thumbnails button` | `gallery.css` | `border-color .2s,background .2s` |
| `.album-thumbnails img` | `gallery.css` | `opacity .2s` |
| `.archive-links b::after` | `collage.css` | `transform .25s var(--ease)` |
| `.archive-links>a` | `collage.css` | `transform .3s var(--ease)` |
| `.b-event svg` | `hero.css` | `transform .3s var(--ease)` |
| `.back-top-arrow` | `details.css` | `background .3s, color .3s, transform .35s var(--detail-ease)` |
| `.belief-list article` | `details.css` | `background .35s` |
| `.belief-list article > .mono` | `details.css` | `transform .4s var(--detail-ease), color .3s` |
| `.belief-list h3` | `details.css` | `color .3s` |
| `.button` | `collage.css` | `background-color .2s,color .2s,border-color .2s,transform .2s var(--ea…` |
| `.button` | `details.css` | `background .25s, color .25s, border-color .25s, box-shadow .3s, transf…` |
| `.button` | `styles.css` | `background .2s,transform .2s,border-color .2s` |
| `.button-plus` | `details.css` | `transform .5s var(--detail-ease)` |
| `.button::before` | `details.css` | `transform .7s var(--detail-ease)` |
| `.card-arrow` | `community.css` | `transform .3s` |
| `.check-box` | `workshop.css` | `background .2s,border-color .2s` |
| `.check-box::after` | `workshop.css` | `transform .2s,opacity .2s` |
| `.checklist-progress progress::-webkit-progress-v…` | `collage.css` | `none` |
| `.checklist-progress progress::-webkit-progress-v…` | `workshop.css` | `width .35s` |
| `.checklist-spark` | `workshop.css` | `transform .6s` |
| `.collab-case-sheet` | `partners.css` | `transform .3s var(--ease),box-shadow .3s var(--ease)` |
| `.collab-detail-close` | `partners.css` | `background .15s var(--ease)` |
| `.collab-intro-link svg,.collab-case-link svg,.co…` | `partners.css` | `transform .24s var(--ease)` |
| `.collab-plus-vertical` | `partners.css` | `transform .24s var(--ease)` |
| `.community-badge i` | `community.css` | `transform .65s` |
| `.community-pathway-item>a` | `collage.css` | `gap .2s ease` |
| `.community-row` | `collage.css` | `background .2s` |
| `.connection-label` | `workshop.css` | `transform .45s` |
| `.content-placeholder` | `details.css` | `border-color .3s` |
| `.copy-status` | `details.css` | `color .2s` |
| `.desktop-nav a` | `details.css` | `color .2s` |
| `.desktop-nav a::after` | `details.css` | `transform .35s var(--detail-ease)` |
| `.desktop-nav a::after` | `styles.css` | `transform .2s` |
| `.desktop-nav a::before` | `details.css` | `opacity .25s, transform .4s var(--detail-ease)` |
| `.dialog-close` | `details.css` | `background .25s, transform .4s var(--detail-ease), border-color .25s` |
| `.ecosystem-foot a span` | `community.css` | `transform .3s` |
| `.edition-stamp` | `details.css` | `transform .6s var(--detail-ease), box-shadow .4s` |
| `.event-detail-facts > div` | `details.css` | `background .3s` |
| `.event-detail-facts strong` | `details.css` | `color .3s` |
| `.event-detail-facts>div` | `collage.css` | `none` |
| `.event-facts > span` | `details.css` | `color .2s` |
| `.event-panel` | `details.css` | `border-color .35s, box-shadow .35s` |
| `.event-poster-copy` | `details.css` | `transform .7s var(--detail-ease)` |
| `.faq-item` | `community.css` | `background .2s` |
| `.faq-plus` | `community.css` | `background .25s,transform .35s` |
| `.faq-plus::before,.faq-plus::after` | `community.css` | `transform .3s` |
| `.filter-bar button` | `community.css` | `background .2s,border-color .2s,box-shadow .2s` |
| `.footer-top nav a::after, .footer-top nav button…` | `details.css` | `transform .3s var(--detail-ease)` |
| `.form-field :is(input,select,textarea)` | `workshop.css` | `background .2s,border-color .2s,box-shadow .2s` |
| `.formats-section .program-card` | `collage.css` | `transform .25s var(--ease),box-shadow .25s var(--ease)` |
| `.formats-section .program-card .card-arrow` | `collage.css` | `transform .22s var(--ease)` |
| `.guide-card` | `collage.css` | `border-color .2s,transform .25s var(--ease)` |
| `.guide-card` | `workshop.css` | `transform .35s,box-shadow .35s,border-color .35s` |
| `.guide-card h3 a>span` | `workshop.css` | `transform .3s` |
| `.guide-cover-icon` | `workshop.css` | `transform .5s` |
| `.guide-cover>b` | `workshop.css` | `transform .5s` |
| `.guide-next a>span` | `workshop.css` | `transform .3s` |
| `.guide-toc nav a` | `workshop.css` | `background .2s,color .2s` |
| `.hero-recap-link, .chapter-link, .motion-button,…` | `details.css` | `color .2s, background .2s` |
| `.join-symbol` | `details.css` | `transform 1s var(--detail-ease)` |
| `.learning-arrow` | `workshop.css` | `transform .3s` |
| `.learning-link` | `workshop.css` | `background .25s` |
| `.link-arrow` | `details.css` | `transform .35s var(--detail-ease)` |
| `.media-corner` | `details.css` | `width .4s var(--detail-ease), height .4s var(--detail-ease), opacity .…` |
| `.media-frame` | `details.css` | `box-shadow .4s, outline-color .3s` |
| `.media-frame::after` | `details.css` | `transform .85s var(--detail-ease)` |
| `.media-glyph` | `details.css` | `transform .55s var(--detail-ease), opacity .4s` |
| `.media-label` | `details.css` | `background .3s` |
| `.media-open img` | `details.css` | `transform .8s var(--detail-ease), filter .6s` |
| `.media-open img` | `styles.css` | `transform .5s` |
| `.media-placeholder::before, .media-placeholder::…` | `details.css` | `opacity .4s` |
| `.media-zoom` | `details.css` | `opacity .3s, transform .4s var(--detail-ease)` |
| `.menu-toggle` | `details.css` | `background .2s` |
| `.menu-toggle span` | `styles.css` | `transform .2s` |
| `.missing-orbit i` | `discovery.css` | `transform .6s` |
| `.mobile-nav a` | `details.css` | `color .2s, background .2s, padding-left .25s var(--detail-ease)` |
| `.moments-grid figcaption, .event-gallery figcapt…` | `details.css` | `color .3s` |
| `.motion-levels > i` | `details.css` | `height .35s var(--detail-ease)` |
| `.motion-stopped *, .motion-stopped *::before, .m…` | `details.css` | `none !important` |
| `.nav-more summary svg` | `collage.css` | `transform .2s` |
| `.nav-more-panel a` | `collage.css` | `background .18s,color .18s` |
| `.page-share-button svg` | `discovery.css` | `transform .3s` |
| `.program-card` | `community.css` | `transform .35s var(--detail-ease),box-shadow .35s,border-color .35s` |
| `.program-card::after` | `community.css` | `transform .35s,opacity .35s` |
| `.program-card::before,.role-card::before` | `community.css` | `opacity .3s` |
| `.program-icon svg` | `community.css` | `transform .45s cubic-bezier(.2,.8,.2,1)` |
| `.project-card` | `details.css` | `box-shadow .4s, border-color .35s, transform .45s var(--detail-ease)` |
| `.project-card .media-frame` | `styles.css` | `transform .25s` |
| `.project-card h3` | `details.css` | `color .25s` |
| `.project-card h3 a::after` | `projects.css` | `transform .35s var(--ease, cubic-bezier(.16,1,.3,1))` |
| `.project-card::before` | `details.css` | `opacity .4s` |
| `.project-detail-next-links a` | `projects.css` | `background-color .2s, border-color .2s` |
| `.project-links a::after` | `details.css` | `transform .3s` |
| `.project-links::before` | `details.css` | `width .5s var(--detail-ease)` |
| `.query-clear` | `discovery.css` | `background .2s,transform .2s` |
| `.recap-nav-end` | `recap.css` | `background .2s,transform .3s` |
| `.recap-nav-links a` | `collage.css` | `background-color .2s,color .2s` |
| `.recap-nav-links a` | `recap.css` | `color .2s` |
| `.recap-nav-links a i` | `recap.css` | `transform .3s` |
| `.reveal-pending` | `details.css` | `opacity .75s var(--detail-ease), transform .75s var(--detail-ease)` |
| `.role-card` | `community.css` | `box-shadow .3s,border-color .3s` |
| `.role-resource-link>span` | `community.css` | `transform .3s` |
| `.row-action b` | `collage.css` | `transform .25s` |
| `.search-field` | `community.css` | `box-shadow .25s,border-color .25s` |
| `.search-field button` | `community.css` | `background .2s,transform .2s` |
| `.search-result` | `collage.css` | `background .2s,border-color .2s` |
| `.search-result` | `discovery.css` | `transform .25s,border-color .25s,box-shadow .25s` |
| `.search-result-arrow` | `discovery.css` | `transform .3s` |
| `.search-suggestions button` | `discovery.css` | `background .2s,border-color .2s` |
| `.section-index` | `details.css` | `background .3s, color .3s, border-color .3s` |
| `.site-header` | `details.css` | `background .3s, box-shadow .3s, border-color .3s` |
| `.site-header .brand-asset` | `styles.css` | `transform .3s ease` |
| `.site-header,.site-header.is-scrolled` | `collage.css` | `border-color .22s,background-color .22s` |
| `.site-search-input` | `discovery.css` | `border-color .25s,box-shadow .25s` |
| `.stack-sheet` | `workshop.css` | `transform .6s var(--detail-ease)` |
| `.start-steps::before` | `collage.css` | `transform .85s cubic-bezier(.2,.7,.2,1)` |
| `.step-prompt` | `community.css` | `transform .3s` |
| `.text-link` | `details.css` | `color .2s, background-size .35s var(--detail-ease)` |
| `.text-link::after` | `collage.css` | `transform .22s var(--ease)` |
| `.text-link::after` | `details.css` | `transform .35s var(--detail-ease)` |
| `.title-star, .project-page-symbol, .about-hero-s…` | `details.css` | `transform .8s var(--detail-ease)` |
| `.values-row article` | `details.css` | `background .35s` |
| `.values-row article::before, .belief-list articl…` | `details.css` | `width .55s var(--detail-ease)` |
| `.values-row h3` | `details.css` | `color .3s` |
| `.welcome-type` | `details.css` | `transform .7s var(--detail-ease), box-shadow .5s` |
| `.welcome-type b` | `details.css` | `transform .55s var(--detail-ease)` |
| `body.motion-stopped :is(.program-card,.role-card…` | `community.css` | `none` |
| `body.motion-stopped :is(.site-header,.button,.se…` | `collage.css` | `none` |
| `body.motion-stopped .archive-links b::after` | `collage.css` | `none` |
| `body.motion-stopped .collab-case-sheet,body.moti…` | `partners.css` | `none` |
| `body.motion-stopped .nav-more-panel a` | `collage.css` | `none` |
| `body.motion-stopped .stack-sheet,body.motion-sto…` | `workshop.css` | `none` |
| `body[data-page="minicamp"] .event-gallery figure…` | `recap.css` | `transform .55s var(--ease), filter .55s var(--ease)` |
| `body[data-page="minicamp"] .event-official-link …` | `recap.css` | `transform .25s var(--ease)` |
| `body[data-page="minicamp"] .event-official-link:…` | `recap.css` | `transform .5s var(--ease)` |
| `body[data-page="minicamp"] .event-theme-item` | `recap.css` | `transform .25s var(--ease), box-shadow .25s var(--ease)` |
| `html.community-motion-ready [data-community-reve…` | `collage.css` | `opacity .65s ease,transform .65s cubic-bezier(.2,.7,.2,1)` |

## 四、无障碍与降级

- 所有装饰动效都有对应的 `@media (prefers-reduced-motion: reduce)` 规则，系统开启「减少动态效果」时静态呈现。
- 站内另有页脚「暂停全站动效」开关，通过 body 的 `.motion-stopped` 类整站停用（定义在 `details.js`，状态存 `nanocamp-motion-paused`）。
- 交互层 `interactions.css` 全部包在 `@media (hover: hover) and (pointer: fine)` 内，触摸设备不启用；其规则限定 `body[data-page="home"]`，只作用于首页。
- 关闭 JavaScript 后内容仍可见：`html.no-js` 控制回退显示，`html:not(.progress-ready)` 保证滚动入场元素不会停在透明状态。
