// 认证模块。
//
// 本版本分两半，界线是「要不要存储」：
//   1. **发验证码**不依赖存储 —— 生成 6 位码、交给邮件通道发出，就是真实现（可测、可在页面上点）。
//   2. **验证码校验 / 密码登录 / 会话**都要把挑战和会话写到某个地方，而本版本没有接数据库，
//      也没有任何替代存储。这几个函数保留签名、抛 `not_implemented`，接口返回 503。
//      宁可不提供，也不要给一个「重启就没了、只在一个进程里有效」的假登录。
//
// 接上数据库后只填下面带 notImplemented 的函数体，api.mjs 与前端都不用改。
import {randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

import {authConfig} from './config.mjs';
import {createCode, sendLoginCode} from './mail.mjs';

/** 邮箱规范化：去首尾空白 + 全转小写。按小写存、按小写比，大小写不同的同一邮箱不会建出两个账号。 */
export const normalizeEmail = value => String(value?? '').trim().toLowerCase();

/** 粗略但够用的邮箱格式校验（真正的可达性只能靠发信验证）。 */
export const isEmail = value => value.length >= 6 && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

/**
 * 认证链路可对外区分的错误码。接口层据此映射 HTTP 状态码，不把内部原因写进响应。
 */
export class AuthError extends Error{
  /**
   * @param {string} code invalid_email / rate_limited / mail_failed / not_implemented
   * @param {string} message 内部说明（不返回给前端）
   * @param {{retryAfter?: number}} [details] 建议的重试等待秒数
   */
  constructor(code, message, details = {}){
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.retryAfter = details.retryAfter || 0;
  }
}

// ---------------- 密码 ----------------
// 为什么用 scrypt 而不是 bcrypt/argon2：Node 内置，零依赖；参数按 Node 文档的常用档位取。
// 存储格式自带参数（scrypt$N$r$p$salt$hash），以后调高成本也能同时验证旧记录。
const scryptAsync = promisify(scrypt);
const SCRYPT = {N: 16384, r: 8, p: 1, keylen: 64};

/** 密码长度边界：与前端 input 的 minlength/maxlength 对齐。 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

/**
 * 生成密码哈希。
 * @param {string} password 明文密码。
 * @returns {Promise<string>} `scrypt$N$r$p$salt$hash` 形式的字符串。
 */
export async function hashPassword(password){
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, {N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p});
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * 校验密码。比较用 timingSafeEqual，避免按字节提前返回。
 * @param {string} password 明文密码。
 * @param {string} stored 存储中的哈希。
 * @returns {Promise<boolean>} 是否匹配。
 */
export async function verifyPassword(password, stored){
  const parts = String(stored || '').split('$');
  if(parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  if(!expected.length) return false;
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, {N: Number(N), r: Number(r), p: Number(p)});
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------------- 发验证码 ----------------

/**
 * 阶梯限额：按「滚动一小时内已发次数」决定下一次发送的最小间隔。
 *   前 5 次      → 1 分钟
 *   第 6–8 次    → 5 分钟
 *   第 9 次起    → 20 分钟
 * 一小时没有新发送就自然跌回第一档，不需要额外的「解封」逻辑。
 */
const SEND_TIERS = [
  {limit: 5, intervalMs: 60 * 1000},
  {limit: 8, intervalMs: 5 * 60 * 1000},
  {limit: Infinity, intervalMs: 20 * 60 * 1000}
];

/** 计数窗口：决定了「跌回第一档」要等多久。 */
const SEND_WINDOW_MS = 60 * 60 * 1000;

/**
 * 已发 count 次之后，下一次发送的最小间隔。
 * @param {number} count 窗口内已发次数。
 * @returns {number} 最小间隔（毫秒）。
 */
export function sendIntervalFor(count){
  const tier = SEND_TIERS.find(entry => count < entry.limit);
  return (tier || SEND_TIERS[SEND_TIERS.length - 1]).intervalMs;
}

/**
 * 防刷记录：邮箱 → 最近的发送时间戳。
 *
 * 这不是账号数据，只是「别让人拿这个接口当发信机」的闸门：进程重启就清零，单实例内有效。
 * 真正的账号、挑战与会话要等数据库，绝不放在这里。
 * @type {Map<string, number[]>}
 */
const recentSends = new Map();

/** 清掉窗口外的时间戳，顺带避免 Map 只增不减。 */
function pruneSends(times, now){
  return times.filter(at => now - at < SEND_WINDOW_MS);
}

/**
 * 申请登录验证码：校验邮箱 → 防刷 → 交给邮件通道发出。
 *
 * ⚠️ 本版本只发信，不保存挑战 —— 所以这串码**暂时无法被验证**（校验要等数据库）。
 * 接口会明确返回 `canVerify: false`，页面据此提示，而不是假装登录流程能继续。
 *
 * @param {object} options 参数。
 * @param {string} options.email 用户填的邮箱。
 * @param {Function} [options.deliver] 投递函数，默认 sendLoginCode（测试可注入）。
 * @returns {Promise<{provider: string, retryAfter: number, canVerify: boolean}>} 投递结果。
 */
export async function requestCode({email, deliver = sendLoginCode}){
  const normalized = normalizeEmail(email);
  if(!isEmail(normalized)) throw new AuthError('invalid_email', '邮箱格式无效');

  const now = Date.now();
  const times = pruneSends(recentSends.get(normalized) || [], now);
  // 间隔由「已经发过几次」决定，不是固定 60 秒。
  const interval = sendIntervalFor(times.length);
  const last = times[times.length - 1];
  if(last && now - last < interval){
    const retryAfter = Math.max(1, Math.ceil((last + interval - now) / 1000));
    throw new AuthError('rate_limited', '重发间隔未到', {retryAfter});
  }

  const {codeMinutes} = authConfig();
  let result;
  try{
    result = await deliver({to: normalized, code: createCode(), minutes: codeMinutes});
  }
  catch(error){
    // 服务商拒绝时不要把这次计入限额 —— 用户没收到信，不该被罚等下一次。
    throw new AuthError('mail_failed', `投递失败：${error.message}`);
  }
  times.push(now);
  recentSends.set(normalized, times);
  // 返回的 retryAfter 是**下一次**的最小间隔，前端倒计时才和真正生效的规则一致。
  return {provider: result.provider, retryAfter: Math.round(sendIntervalFor(times.length) / 1000), canVerify: false};
}

// ======================= 以下是需要存储的接口（本版本留空） =======================
//
// 签名先定下来：接上数据库时只填函数体，api.mjs 与前端都不用改。
// 现在调用它们一律抛错 —— 绝不会「成功返回一个没存下来的结果」。

/**
 * 尚未实现的占位错误。
 * @param {string} name 函数名，便于定位是哪条链路还没接。
 * @returns {Error} 带 code 的错误。
 */
function notImplemented(name){
  const error = new Error(`认证功能尚未接入数据库：${name}()`);
  error.code = 'not_implemented';
  return error;
}

/**
 * 邮箱/IP 在存储与日志里的统一化名（HMAC 后）。
 * @returns {never} 本版本未实现。
 */
export function subjectOf(){
  throw notImplemented('subjectOf');
}

/**
 * 会话令牌的存储形态：只存 sha256，令牌原文只出现在 cookie 里。
 * @returns {never} 本版本未实现。
 */
export function hashToken(){
  throw notImplemented('hashToken');
}

/**
 * 生成一个挑战 id（22 字符 base64url，128 位随机）。
 * @returns {never} 本版本未实现。
 */
export function createChallenge(){
  throw notImplemented('createChallenge');
}

/**
 * 校验验证码并建立会话（邮箱首次验证时自动建号）。
 * @returns {never} 本版本未实现。
 */
export function verifyCode(){
  throw notImplemented('verifyCode');
}

/**
 * 邮箱 + 密码登录。
 * @returns {never} 本版本未实现。
 */
export function loginWithPassword(){
  throw notImplemented('loginWithPassword');
}

/**
 * 读取会话。没有存储时「没有会话」是诚实的答案，所以返回 null 而不是抛错。
 * @returns {Promise<null>} 恒为 null。
 */
export async function readSession(){
  return null;
}

/**
 * 撤销会话。没有存储时无事可做。
 * @returns {Promise<void>} 无。
 */
export async function revokeSession(){}
