// 昵称里不允许出现的字符。**这一份是唯一真值**：
//   · 后端 `backend/auth.mjs` 用它判定（命中就 invalid_nickname）；
//   · 登录后的资料页 / 账号页把 `source` 渲染进 `data-nickname-forbidden`，
//     浏览器端 `new RegExp(...)` 复用同一套规则 —— 不再是「前端只禁 / 和 \」的子集。
//
// 字符类包含四类，都是复制粘贴最容易带进来的东西：
//   · 路径分隔符 `/` `\`（昵称会出现在链接文字里）；
//   · C0 / C1 控制字符（\u0000-\u001f、\u007f-\u009f）；
//   · 零宽与双向控制（\u200b-\u200f、\u202a-\u202e、\u2060、\u2066-\u2069）；
//   · 行/段分隔符（\u2028、\u2029）与 BOM（\ufeff）。
const CLASS = '/\\\\\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2028\\u2029\\u2060\\u2066-\\u2069\\ufeff';

/** 禁用字符的正则：任意一处命中即不合法。 */
export const NICKNAME_FORBIDDEN = new RegExp(`[${CLASS}]`);

/** 同一份字符类的源码，供模板渲染进 `data-nickname-forbidden` 给浏览器端 `new RegExp(...)`。 */
export const NICKNAME_FORBIDDEN_SOURCE = NICKNAME_FORBIDDEN.source;

/**
 * 昵称里有没有禁用字符。
 * @param {unknown} value 昵称原文。
 * @returns {boolean} 含禁用字符为 true。
 */
export const nicknameForbidden = value => NICKNAME_FORBIDDEN.test(String(value ?? ''));
