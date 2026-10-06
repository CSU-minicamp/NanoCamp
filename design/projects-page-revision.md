# NanoCamp 官网「作品页」改版方案

> 依据 2026-10-05 快速会议（录制 15:42–19:47）的需求整理。
> 现状分析基于实际代码：`src/projects.mjs`、`content/site.mjs`、`src/components.mjs`、`public/projects.css`、`public/styles.css`。

---

## 一、现状梳理（代码事实）

| 维度 | 当前实现 | 代码位置 |
|---|---|---|
| 数据来源 | `content/site.mjs` 的 `projects` 数组，20 条，全部为 minicamp 作品；由 `scripts/sync-minicamp-projects.mjs` 同步 | `content/site.mjs:31-232` |
| 主题分布 | `theme` 取值：`Build for Humans`(10)、`Reimagine Campus`(4)、`Create the Unexpected`(5)、`null`(1，即 project-20) | 同上 |
| 列表渲染 | `projectsPage()` → `catalogGroups()` 按 `theme` 分组全量展示；`theme=null` 渲染为「未分类主题」 | `src/projects.mjs:57-78` |
| 卡片封面 | `projectCard()` 内封面调用 `media()`，封面为 `<a data-lightbox>`，**点击开大图**；标题与「查看详情」才进详情页 | `src/projects.mjs:43`、`src/components.mjs:60-65` |
| 详情页 | `projectDetailPage()` 独立页；左侧 `.project-sidebar`（含本篇目录 TOC）已置于 grid 左列（290px） | `src/projects.mjs:86-109` |
| 全局导航 | `header()` 中 `.desktop-nav` 位于品牌标识右侧；全局基础字号 `body{font-size:16px}` | `src/components.mjs:42-49`、`public/styles.css:5` |
| 作品页小字 | 多处 11–13px：`.project-members 12px`、`.group-label .mono 11px`、`.project-tags` 等 | `public/projects.css:7,13` 等 |
| GitHub 跳转 | 卡片与详情页均已提供 `externalLink(repoUrl,'GitHub 仓库')` | `src/projects.mjs:48,100,102` |

**关键发现**：当前封面点击行为 = 看大图（lightbox），与会议诉求「点封面进作品页」相反；「未分类主题」区块需删除；社区作品 / 个人作品两类数据尚不存在。

---

## 二、需求 ↔ 现状差距对照

| # | 会议需求 | 现状 | 差距等级 |
|---|---|---|---|
| 1 | 三类作品：MiniCamp / 社区 / 个人 | 仅 MiniCamp 一类 | 高（需新增数据维与 UI） |
| 2 | 每主题放 3 个，不堆量 | 按主题全量展示（Build for Humans 10 个） | 高 |
| 3 | 删除「未分类主题」 | project-20 `theme=null` → 显示「未分类主题」 | 中 |
| 4 | 封面点击 → 进作品页；「查看照片」→ 看大图 | 封面点击 = 看大图 | 高（交互反转） |
| 5 | 每个作品独立页，列表页不无限下拉 | 列表页单页全量；详情页已独立 | 低（基本满足，需确认） |
| 6 | GitHub 仓库入口保留 | 已有 | —（确认保留） |
| 7 | 导航栏置于最左边 | 详情页侧栏已在左列；全局 nav 在品牌右侧 | 中（需确认指向） |
| 8 | 偏小字体需调整 | 多处 11–13px 次要信息 | 中（需定规格） |

---

## 三、分模块修改方案

### A. 封面点击行为（高优先级，确定可行）
- **改动**：扩展 `media()` 增加 `linkTo` 参数。当传入作品详情路径时，封面 `<a>` 指向详情页（`href=detail`），移除 `data-lightbox`；同时保留 `.media-zoom`「查看照片」作为一个**独立按钮**，单独挂 `data-lightbox` 触发大图。
- **位置**：`src/components.mjs:60-65`、`src/projects.mjs:43`。
- **效果**：默认点封面进详情页；用户特意点「查看照片」才看大图，完全对齐会议要求。

### B. 三类作品分类（高优先级，需架构决策）
- **数据层**：在 `content/site.mjs` 中为每条作品增加 `category` 字段，默认 `'minicamp'`；新增 `communityProjects = []` 与 `personalProjects = []` 空数组（留位，便于后续填充）。同步脚本 `sync-minicamp-projects.mjs` 输出时补 `category:'minicamp'`。
- **UI 层**：`projectsPage()` 顶部增加分类切换（**推荐 Tab 而非长页堆叠**：MiniCamp / 社区作品 / 成员作品）。切换即过滤 `readyProjects()` 按 `category` 输出；空分类显示占位「待补充 / 留位」。
- **位置**：`src/projects.mjs:76-78`、`content/site.mjs`。

### C. 主题分组 + 每主题 3 个 + 删未分类（高优先级）
- **改动**：`catalogGroups()` 中每组 `slice(0, 3)`；超出 3 个时在该主题末尾加「查看该主题全部 →」链接（指向可选二级视图或锚点展开）。将 `theme=null` 的作品过滤掉（不再生成「未分类主题」区块）；project-20 需补全 `theme` 或标记为隐藏。
- **位置**：`src/projects.mjs:57-74`。
- **说明**：当前恰好 3 个主题值，与「三个主题」吻合；Build for Humans 需从 10 个中精选 3 个（见待确认项 2）。

### D. 独立作品页 / 列表页不无限下拉（低优先级）
- 当前列表页为分组网格、详情页独立，已满足「点封面进独立页」。
- 建议：保持分组网格形态（非自动加载更多即非「无限拉长」）；详情页底部「继续浏览（上/下一篇）」作为导航**保留**，除非会议明确指其需移除（待确认项 5）。

### E. 导航栏最左边（中优先级，需确认指向）
- 若指**详情页左侧 sidebar**（`.project-sidebar`）：当前已在 grid 最左列，建议增强为 `sticky` 并确认层级；基本符合。
- 若指**全局 header 导航移到最左**：当前 `.desktop-nav` 在品牌标识右侧，需调整 `header()` 布局。
- 见待确认项 3。

### F. 字体调整（中优先级，需定规格）
- **建议目标**：卡片成员名 `12px → 13px`；`.group-label .mono 11px → 12px`；其余 11–13px 次要信息统一上调 1px；正文 16–17px 维持。避免大段 10–11px。
- **位置**：`public/projects.css`（局部优先），必要时微调 `public/styles.css` 变量。
- 具体目标值见待确认项 4。

### G. GitHub 跳转（确认保留）
- 卡片与详情页已具备，本次仅确认保留，不改动逻辑。

---

## 四、已确认决策（2026-10-06）

经与用户确认，以下四项采用推荐方案，文档其余章节据此作为最终实现依据：

1. **三类作品展示结构**：采用 **顶部 Tab 切换**（MiniCamp / 社区作品 / 成员作品），切换即过滤，空分类显示占位。契合「不无限下拉」。
2. **每主题超出 3 个的处理**：采用 **精选 3 个 + 「查看该主题全部 →」链接**（二级视图 / 锚点展开）。Build for Humans 当前 10 个，精选标准：**有封面 + 信息完整优先**。
3. **「导航栏最左边」指向**：确认为 **详情页左侧 sidebar**（`.project-sidebar`），当前已在 grid 最左列，实现时增强 `sticky` 吸顶与层级。
4. **字体目标规格**：次要信息统一上调至 **≥13px**（成员名 12→13、主题 mono 11→12 等），正文 16–17px 维持。

**默认约定（未单独确认）**：详情页底部「继续浏览（上/下一篇）」作为导航**保留**。

---

## 五、实施阶段与风险

| 阶段 | 内容 | 验证 |
|---|---|---|
| 1. 设计确认 | 本文档 + 上述 5 项决策 | 用户 review |
| 2. 数据层 | `category` 字段、社区/个人空数组、project-20 `theme` 补全 | 构建不报错 |
| 3. 列表页 | 分类 Tab + 主题分组限 3 + 删未分类 | 本地预览 |
| 4. 卡片交互 | 封面进详情 + 「查看照片」独立按钮 | 点击验证 |
| 5. 详情页/字体 | 导航位置确认、字号调整 | 视觉 review |
| 6. 提交 | review → commit → push（注意 `luoruling` 对 CSU-minicamp/NanoCamp 组织仓库**无写权限**，需协调） | PR 或权限申请 |

**主要风险**：
- 社区/个人作品暂无真实数据，需先以占位结构落地，后续填充。
- project-20 缺 `theme`，须补全或显式排除，否则影响分组与「删未分类」目标。
- 提交阶段受组织仓库写权限限制，需提前协调 push 方式。
