// 论坛域的公共层
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
 * 只在这里定义一次，`isId()` / `idOf()` 都用它。路由正则只负责「是不是一串数字」，合法性一律回到这里判
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

/**
 * 分页参数：只接受十进制正整数，其余一律 404，钳位10^10。
 *
 * 有两条形状检查：
 *   1. 不能是 `0` / `0195` / `-1` / `1.5` / `1e3` / ` 1` 这类根本不是页码的东西；
 *   2. 最多 9 位，保证 `(page-1)*每页` 落在双精度安全整数内。
 * 「没给参数」才是第 1 页；给了但不存在的页由 ensurePage() 回 404，不是悄悄改成最后一页。
 * @param {unknown} value 原始分页参数。
 * @returns {number} 页码。
 */
export const pageOf = value => {
  const raw = String(value ?? '');
  if(raw === '')
    return 1;
  if(!/^[1-9]\d{0,8}$/.test(raw))
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
 * 这个人此刻实际的身份：没有行、或那一行已过期 → `member`（等于完全普通的成员）。
 *
 * 唯一该用来判断身份的函数 —— 直接读 `row.type` 会把过期行当成还在生效。
 * @param {object|null|undefined} row forum_member_roles 的一行（带 type / expired_at）。
 * @returns {'member'|'mute'|'ban'|'moderator'|'admin'} 身份。
 */
export const memberType = row => (Boolean(row) && (!row.expired_at || new Date(row.expired_at) > new Date()))? row.type: 'member';

/**
 * 是不是仍然在任的版务（moderator / admin）。被封的人即使以前是版务也不算。
 * @param {object|null|undefined} row forum_member_roles 的一行。
 * @returns {boolean} 是版务为 true。
 */
export const isStaff = row => ['moderator', 'admin'].includes(memberType(row));

/**
 * 成员校验：任何写动作之前都要过一遍。
 *
 * 顺序是刻意的：先确认登录，再锁用户行（同一人的写请求串行，限流与幂等重放才准），
 * 最后才检查资料完整度与处罚状态。两个开关各有分工：
 *   · `passive`  只改自己的阅读状态（标记已读）时用：仍然要求登录、仍然加锁，但不拦资料与被处罚的人（否则被处罚的人连红点都清不掉）
 *   · `speaking` 这个动作算不算「公开发言」。`mute` 只拦公开发言，`ban` 拦全部写动作；私信、收藏、关注、删自己的内容都不算发言，被禁言也能做。
 * 两种处罚都**不影响登录与浏览**：处罚是社区内的，不是账号层面的。
 * @param {object} c 事务连接。
 * @param {object|null} user 会话里的用户。
 * @param {object} [options] 参数。
 * @param {boolean} [options.passive=false] 只改自己的阅读状态（跳过资料与处罚检查）。
 * @param {boolean} [options.speaking=false] 这个动作算不算公开发言（决定 mute 拦不拦）。
 * @returns {Promise<void>} 无。
 */
export async function checkMember(c, user, {passive = false, speaking = false} = {}){
  if(!user)
    fail('unauthenticated', 401);
  const [actor] = await rows(c, 'SELECT id FROM users WHERE id=? FOR UPDATE', [user.id]);
  if(!actor)
    fail('unauthenticated', 401);
  if(passive)
    return;
  if(missingFields(user).length)
    fail('profile_incomplete', 403);
  const [state] = await rows(c, 'SELECT type,expired_at FROM forum_member_roles WHERE member_id=?', [user.id]);
  const type = memberType(state);
  if(type === 'ban')
    fail('posting_suspended', 403);
  if(type === 'mute' && speaking)
    fail('posting_muted', 403);
}
