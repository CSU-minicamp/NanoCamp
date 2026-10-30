// 收录规则：**默认不收录，白名单才收录**。
//
// 以前论坛页写的是黑名单（`route.includes('/me') || route.includes('/messages') || …`），
// 新增页面忘了加就会被搜索引擎收进去 —— 漏写的方向应该是「保守（不收录）」，而不是「激进（收录）」。
// 现在反过来：只有这里点了名的形状才允许收录，其余一律 `<meta name="robots" content="noindex, follow">`。
//
// 两张清单：
//   · 静态页：`src/pages.mjs` 的 routes 表里逐页声明，派生 `indexablePaths`（sitemap、搜索索引、
//     check.mjs 都从它推导，改一处三处跟着变）；
//   · 动态页：下面手写的**形状**白名单 —— 只有确实值得被搜到的几种地址形态。
// 不在这里的，包括 `/forum/messages/*`、`/profile/*`、`/user/<id>/`，全部 noindex。
import {indexablePaths} from './pages.mjs';

/**
 * 动态路由里允许被收录的形状（不是具体地址）。
 * ID 用 `[1-9]\d{0,14}` 而不是 `\d+`，和 backend 的编号规则保持一致。
 */
export const dynamicIndexable = [
  /^\/forum\/$/,
  /^\/forum\/topics\/[1-9]\d{0,14}\/$/,
  /^\/forum\/user\/[1-9]\d{0,14}\/$/
];

/**
 * 这个地址要不要被搜索引擎收录。
 * @param {string} route 路径（不含查询串）。
 * @returns {boolean} 收录为 true。
 */
export const isIndexable = route => indexablePaths.includes(route) || dynamicIndexable.some(pattern => pattern.test(route));

/**
 * 页面该不该输出 `noindex`。
 * 渲染处直接写 `noindex: isNoindex(route)`，别再自己拼字符串条件。
 * @param {string} route 路径。
 * @returns {boolean} 要 noindex 为 true。
 */
export const isNoindex = route => !isIndexable(route);
