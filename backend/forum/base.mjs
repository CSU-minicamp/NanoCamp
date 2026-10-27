// 论坛域的公共层 —— 注意不是 backend/base.mjs（那个是全局基础件：转义、静态资源、cookie 解析）。
//
// 单独成一个文件的原因只有一个 —— **打断循环依赖**：dm 要用论坛的成员校验与错误类型，
// 论坛的消息页又要读 dm 的数据；两边直接互相 import 就成环。把这些共同依赖放这里，
// 依赖方向变成 `base ← dm ← {index, read}`：dm 不认识 index/read，index/read 认识 dm。
//
// 所以这里只放「与具体内容无关」的东西：错误类型、编号形状、长度校验、分页、成员校验、事务里的查询助手。
// 帖子怎么排序、私信怎么分页这类规则，各自留在 index/read 与 dm.mjs 里。
// 词表（分类名、举报理由）不在这里 —— 那两份是内容，被模板和后端共用，放在 content/forum.mjs。
import {missingFields} from '../auth.mjs';

/**
 * 社区侧的失败原因。状态码一起带着，接口层直接拿它回 HTTP，不用再翻译一遍。
 */
export class CommunityError extends Error{
  /**
   * @param {string} code 错误码（会原样返回给前端）。
   * @param {number} [status=422] 对应的 HTTP 状态码。
   */
  constructor(code, status = 422){
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * 抛出社区错误。写成函数是为了让业务代码保持「一行一个 if」的读法。
 * @param {string} code 错误码。
 * @param {number} [status=422] HTTP 状态码。
 * @returns {never} 一定抛出。
 */
export const fail = (code, status = 422) => { throw new CommunityError(code, status); };

/**
 * 全站编号的唯一形状：1 到 15 位十进制、不以 0 开头。
 *
 * 只在这里定义一次，`isId()` / `idOf()` 都用它。路由正则只负责「是不是一串数字」，
 * 合法性一律回到这里判 —— 以前 `/user/` 用 `\d{1,18}`、论坛页面用 `\d+`，
 * 结果 `/user/0195/` 打得开而 `/forum/users/0195/` 是 404，同一个 id 两套行为。
 */
const ID_RE = /^[1-9]\d{0,14}$/;

/**
 * 这个值是不是一个合法编号（不抛错，供路由层判断）。
 * @param {unknown} value 待判断的值。
 * @returns {boolean} 合法为 true。
 */
export const isId = value => ID_RE.test(String(value ?? ''));

/**
 * 解析 URL 或请求体里的编号：只收 1 到 15 位的正整数，其余一律当成「不存在」。
 * @param {unknown} value 待解析的值。
 * @returns {number} 编号。
 */
export const idOf = value => {
  const raw = String(value ?? '');
  if(!ID_RE.test(raw))
    fail('not_found', 404);
  return Number(raw);
};

/**
 * 在一笔事务里跑一条预处理语句。
 *
 * 只在 transaction(callback) 的 c 上用：这样调用点一眼能看出「这几条语句在同一笔事务里」。
 * @param {object} c 事务连接。
 * @param {string} sql 带 ? 占位符的语句。
 * @param {Array} [args] 参数。
 * @returns {Promise<Array<object>|object>} 结果集（INSERT 时是 ResultSetHeader）。
 */
export const rows = async (c, sql, args = []) => {
  const [result] = await c.execute(sql, args);
  return result;
};

/** 页码上限：只用来挡住荒谬的 OFFSET（`(page-1)*20`），不是业务页数上限。 */
export const MAX_PAGE = 500;

/**
 * 分页参数：只接受 `1`–`MAX_PAGE` 的十进制正整数，其余一律 404 —— **不做任何钳位**。
 *
 * 以前是 `Math.min(500, Math.max(1, parseInt(…)))`，把 `?page=9999` 静默变成第 500 页并回 200，
 * 同一篇内容于是有了两个地址；`?page=0`、`?page=abc` 也会被悄悄改写。
 * 现在「没给参数」才等于第 1 页，给了但不在范围内就是不存在。
 * @param {unknown} value 原始分页参数。
 * @returns {number} 页码。
 */
export const pageOf = value => {
  const raw = String(value ?? '');
  if(raw === '')
    return 1;
  if(!/^[1-9]\d{0,5}$/.test(raw) || Number(raw) > MAX_PAGE)
    fail('not_found', 404);
  return Number(raw);
};

/**
 * 页码超过实际页数时当作不存在（返回 404），而不是给一页空白或落回最后一页。
 * @param {number} page 请求的页码。
 * @param {number} total 该列表的总条数。
 * @param {number} per 每页条数。
 * @returns {number} 总页数（至少 1）。
 */
export const ensurePage = (page, total, per) => {
  const pages = Math.max(1, Math.ceil(total / per));
  if(page > pages)
    fail('not_found', 404);
  return pages;
};

/**
 * 文本字段：去首尾空白后按**字符数**（不是字节数）校验长度。
 * 用字符数是因为中文一个字三字节，按字节算会把「20 字」变成「6 字」。
 * @param {unknown} value 原始值。
 * @param {number} min 最少字符数。
 * @param {number} max 最多字符数。
 * @returns {string} 去空白后的文本。
 */
export const text = (value, min, max) => {
  if(typeof value !== 'string')
    fail('invalid_content');
  const cleaned = value.trim();
  const length = Array.from(cleaned).length;
  if(length < min || length > max)
    fail('invalid_content');
  return cleaned;
};

/**
 * 成员校验：任何写内容的动作之前都要过一遍。
 *
 * 顺序是刻意的：先确认登录，再锁用户行（同一人的写请求串行，限流与幂等重放才准），
 * 最后才检查资料完整度与封禁状态。`passive` 用于「只改自己的阅读状态」那种动作（标记已读）：
 * 仍然要求登录、仍然加锁，但不拦资料不完整或被禁言的人 —— 否则被禁言的人连已读都标不了。
 * @param {object} c 事务连接。
 * @param {object|null} user 会话里的用户。
 * @param {boolean} [passive=false] 是否跳过资料与封禁检查。
 * @returns {Promise<void>} 无。
 */
export async function checkMember(c, user, passive = false){
  if(!user)
    fail('unauthenticated', 401);
  const [actor] = await rows(c, 'SELECT id FROM users WHERE id=? FOR UPDATE', [user.id]);
  if(!actor)
    fail('unauthenticated', 401);
  if(passive)
    return;
  if(missingFields(user).length)
    fail('profile_incomplete', 403);
  const [state] = await rows(c, 'SELECT * FROM forum_members WHERE user_id=?', [user.id]);
  if(state?.banned_at || state?.suspended_until && new Date(state.suspended_until) > new Date())
    fail('posting_suspended', 403);
}
