// 转义：把会破坏标记结构的五个字符换成实体。
//
// 原先有两份一模一样的实现（`src/components.mjs` 的 `esc` 与 `backend/base.mjs` 的 `escapeHtml`），
// 两份都是「五个字符、同一套实体」，只是缩进不同 —— 这种东西只该有一份。
// 五个实体在 HTML 与 XML 里都合法，所以 sitemap 也直接用它。
export const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
