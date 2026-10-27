// 认证核心：发码、验码、密码登录、会话。
//
// 数据落在 MySQL（backend/db.mjs），这里直接写 SQL —— 没有中间的 store 层。
// 三条约定，改动前先读：
//   1. 验证码只存 HMAC，不存明文（6 位码只有 100 万种，裸哈希可离线爆破，必须带服务端密钥）；
//   2. 消费验证码是一次「带条件的原子写」，成败只看 affectedRows —— 不能让调用方「先查再改」；
//   3. 所有时间都由这里算好再交给数据库，SQL 里不出现 NOW()。
import {createHash, createHmac, randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

import {authConfig, mailPaused} from './config.mjs';
import {dbReady, select, execute, transaction} from './db.mjs';
import {createEmailCaptcha, sendLoginCode} from './mail.mjs';
import {BIO_MAX, NICKNAME_MAX, PASSWORD_MAX, PASSWORD_MIN} from '../common/limits.mjs';

/** 挑战 cookie 与验证码有效期一致（分钟）之外的兜底：cookie 本身多留 5 分钟。 */
const CHALLENGE_COOKIE_SLACK_MINUTES = 5;
/** 猜错计数的窗口（分钟）与阈值。 */
const FAIL_WINDOW_MINUTES = 15;
const FAIL_LIMIT = 10;
/** last_seen_at 最多每小时写一次，避免每个请求都更新会话行。 */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** 发信 cookie 的有效期（秒）。 */
export const challengeCookieMaxAge = () => (authConfig().codeMinutes + CHALLENGE_COOKIE_SLACK_MINUTES) * 60;
/** 会话 cookie 的有效期（秒）。 */
export const sessionCookieMaxAge = () => authConfig().sessionDays * 24 * 60 * 60;

/**
 * 认证链路可对外区分的错误码。接口层据此映射 HTTP 状态码，不把内部原因写进响应。
 */
export class AuthError extends Error{
  /**
   * @param {string} code invalid_email / rate_limited / mail_failed / email_captcha_invalid / credentials_invalid / unavailable
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

/**
 * 昵称里不允许出现的字符：路径分隔符、C0/C1 控制字符、不可见的空白/连接/方向/隔离字符。
 *
 * 昵称只当显示文本用（链接一律走 `/forum/users/<id>/`），所以这些字符不会立刻炸掉什么；
 * 但 `/` `\` 会被读成路径或「某组织/某人」；零宽空格、连接符、方向标记、BOM 这类看不见的字符
 * 能造出视觉上同名或空名的账号 —— 都不该放进来。
 *
 * **组合 emoji 因此不被支持**：👨‍👩‍👧 这种用 U+200D（ZWJ）拼起来的序列会被拒。
 * 这是有意的取舍 —— 宁可少支持一类 emoji，也不留「看起来同名、字符串不同」的缝隙。
 * 单码点 emoji（🌱、👩）与肤色修饰符不受影响。
 * 用**黑名单**而不是白名单：emoji、日文、全角符号这些正常昵称不该被误伤。
 */
const FORBIDDEN_NICKNAME = /[/\\\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060\u2066-\u2069\ufeff]/;

/** 邮箱规范化：去首尾空白 + 全转小写。 */
export const normalizeEmail = value => String(value ?? '').trim().toLowerCase();

/** 粗略但够用的邮箱格式校验（真正的可达性只能靠发信验证）。 */
export const isEmail = value => value.length >= 6 && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = value => createHmac('sha256', authConfig().secret).update(value).digest('hex');

/** 邮箱/IP 在存储与日志里的统一化名（HMAC 后），库里不出现明文。 */
export const subjectOf = value => hmac(String(value ?? ''));

/** 会话令牌只存 sha256，令牌原文只出现在 cookie 里。 */
export const hashToken = token => sha256(token);

/** 生成一个挑战 id（22 字符 base64url，128 位随机）。 */
export const createChallenge = () => randomBytes(16).toString('base64url');

/**
 * 把查询行收敛成对外的用户对象。
 * hasPassword 只在「是否已设置密码」上暴露布尔值，哈希本身绝不出这个模块。
 * @param {object} row users 表的一行（需带 has_password 别名）。
 * @returns {object} 用户对象。
 */
const toUser = row => ({
  id: row.id,
  email: row.email,
  nickname: row.nickname || '',
  bio: row.bio || '',
  hasPassword: Boolean(row.has_password),
  avatarUrl: `/api/users/${row.id}/avatar`
});

/** 验证码的存储形态：HMAC(challenge:code)，同一串码在不同挑战里哈希也不同。 */
const codeDigest = (challenge, code) => hmac(`${challenge}:${code}`);

/**
 * 认证是否就绪：既要有数据库，也要有 secret。
 * 接口层用它在建会话/发信之前先给出 503。
 * @returns {boolean} 是否可用。
 */
export function authAvailable(){
  return dbReady() && Boolean(authConfig().secret);
}

/** 不可用时统一抛 unavailable，由接口层转成 503。 */
function assertAvailable(){
  if(!dbReady())
    throw new AuthError('unavailable', '没有配置数据库（db.database）');
  if(!authConfig().secret)
    throw new AuthError('unavailable', '缺少 auth.secret');
}

// ---------------- 密码 ----------------
// scrypt 参数按 Node 文档的常用档位取。
// 存储格式自带参数（scrypt$N$r$p$salt$hash），以后调高成本也能同时验证旧记录。
const scryptAsync = promisify(scrypt);
const SCRYPT = {N: 16384, r: 8, p: 1, keylen: 64};

/** 密码长度边界在 common/limits.mjs —— 模板的 minlength/maxlength 也从那里取，只有一处默认值。 */

/**
 * 生成密码哈希。
 * @param {string} password 明文密码。
 * @returns {Promise<string>} `scrypt$N$r$p$salt$hash`。
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
  if(parts.length !== 6 || parts[0] !== 'scrypt')
    return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  if(!expected.length)
    return false;
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, {N: Number(N), r: Number(r), p: Number(p)});
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// 邮箱不存在时也跑一次同成本的哈希，避免通过响应时间判断某个邮箱是否注册过。
let dummyHash = '';
async function burnPasswordTime(password){
  if(!dummyHash)
    dummyHash = await hashPassword('nanocamp-timing-equalizer');
  await verifyPassword(password, dummyHash);
}

// ---------------- 频率事件 ----------------
// TODO: 目前没有IP级限流、db的rate_event没有定时清理
/** 记一条限流事件。subject 是 HMAC 后的邮箱或 IP。 */
const recordEvent = (kind, subject, at) => execute('INSERT INTO rate_events (kind, subject, at) VALUES (?, ?, ?)', [kind, subject, at]);

/**
 * 登录成功后清空这个邮箱的限流计数。
 *
 * 清空失败不影响这次登录（已经签发了会话），所以只记日志不抛错。
 * @param {string} email 规范化邮箱。
 * @returns {Promise<void>} 无。
 */
async function clearRateEvents(email){
  try{
    // 带上 kind 才能用上 idx_rate_lookup(kind, subject, at)：只给 subject 时只能 skip scan。
    await execute("DELETE FROM rate_events WHERE subject = ? AND kind IN ('send', 'verify_fail', 'login_fail')", [hmac(email)]);
  }
  catch(error){
    console.error('[auth] 清空限流计数失败：', error.message);
  }
}

/**
 * 统计窗口内的事件数与最早一条时间（用于算 Retry-After）。
 * @param {string} kind 事件类型。
 * @param {string} subject HMAC 后的邮箱/IP。
 * @param {number} windowMs 窗口长度（毫秒）。
 * @param {Date} now 当前时间。
 * @returns {Promise<{count: number, retryAfter: number}>} 条数与建议等待秒数。
 */
async function countEvents(kind, subject, windowMs, now){
  const since = new Date(now.getTime() - windowMs);
  const rows = await select('SELECT at FROM rate_events WHERE kind = ? AND subject = ? AND at > ? ORDER BY at ASC', [kind, subject, since]);
  const oldest = rows[0]?.at;
  const retryAfter = oldest ? Math.max(1, Math.ceil((oldest.getTime() + windowMs - now.getTime()) / 1000)) : 0;
  return {count: rows.length, retryAfter};
}

// ---------------- 发验证码 ----------------

/**
 * 阶梯限额：按「滚动一小时内已发次数」决定下一次的最小间隔。
 *   前 5 次 → 60 秒；第 6–8 次 → 5 分钟；第 9 次起 → 20 分钟。
 * 一小时没有新发送就自然跌回第一档。
 */
const SEND_TIERS = [
  {limit: 5, intervalMs: 60 * 1000},
  {limit: 8, intervalMs: 5 * 60 * 1000},
  {limit: Infinity, intervalMs: 20 * 60 * 1000}
];

/** 计数窗口：决定「跌回第一档」要等多久。 */
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
 * 申请登录验证码：校验邮箱 → 阶梯限额 → 发信 → 写入/替换挑战。
 *
 * 发信在前、落库在后：邮件服务拒绝时不动已有的挑战，而不是把用户手上那枚还有效的码换成一个没发出去的。
 *
 * @param {object} options 参数。
 * @param {string} options.email 用户填的邮箱。
 * @param {string} [options.ip] 来源 IP，用于审计（只存 HMAC）。
 * @param {string} [options.challenge] 浏览器已有的挑战 id；没有则新建。
 * @param {Function} [options.deliver] 投递函数，默认 sendLoginCode（测试可注入）。
 * @returns {Promise<{challenge: string, retryAfter: number, provider: string}>} 新挑战与投递结果。
 */
export async function requestEmailCaptcha({email, ip = '', challenge = '', deliver = sendLoginCode}){
  assertAvailable();
  const normalized = normalizeEmail(email);
  if(!isEmail(normalized))
    throw new AuthError('invalid_email', '邮箱格式无效');
  // 运维开关：暂停发信时直接拒绝（校验与登录仍然可用）。
  if(mailPaused())
    throw new AuthError('mail_paused', '发信已暂停（data/PAUSE_MAIL）');
  const now = new Date();
  const subject = hmac(normalized);
  // 一条查询同时拿「发码记录」和「猜错记录」：条数决定档位与是否封禁，最后一条决定还要等多久。
  // 两者窗口不同（1 小时 / 15 分钟），所以统一按大窗口取，再在内存里按时间分开 —— 少一次往返。
  const events = await select(
    "SELECT kind, at FROM rate_events WHERE subject = ? AND kind IN ('send', 'verify_fail') AND at > ? ORDER BY at ASC",
    [subject, new Date(now.getTime() - SEND_WINDOW_MS)]
  );
  const sends = events.filter(event => event.kind === 'send');
  const guessWindowStart = now.getTime() - FAIL_WINDOW_MINUTES * 60 * 1000;
  const failures = events.filter(event => event.kind === 'verify_fail' && event.at.getTime() > guessWindowStart);
  const interval = sendIntervalFor(sends.length);
  const last = sends[sends.length - 1]?.at;
  if(last && now.getTime() - last.getTime() < interval){
    const retryAfter = Math.max(1, Math.ceil((last.getTime() + interval - now.getTime()) / 1000));
    throw new AuthError('rate_limited', '重发间隔未到', {retryAfter});
  }
  // 猜错太多时连「发新码」一起停：否则换个新码就能继续猜，限流等于没有。
  if(failures.length >= FAIL_LIMIT){
    const oldest = failures[0].at.getTime();
    throw new AuthError('rate_limited', '验证码错误次数过多', {
      retryAfter: Math.max(1, Math.ceil((oldest + FAIL_WINDOW_MINUTES * 60 * 1000 - now.getTime()) / 1000))
    });
  }
  const {codeMinutes} = authConfig();
  const code = createEmailCaptcha();
  let result;
  try{
    result = await deliver({to: normalized, code, minutes: codeMinutes});
  }
  catch(error){
    // 服务商拒绝时不计入限额 —— 用户没收到信，不该被罚等下一次。
    throw new AuthError('mail_failed', `投递失败：${error.message}`);
  }

  const expiresAt = new Date(now.getTime() + codeMinutes * 60 * 1000);
  const id = challenge || createChallenge();
  // 同一 challenge 重发是「替换这一行」，不是再插一行；多设备各持一个 challenge、互不影响。
  await execute(
    `INSERT INTO login_email_captcha (challenge, email, code_hmac, attempts, consumed_at, expires_at, created_at, ip_hash)
     VALUES (?, ?, ?, 0, NULL, ?, ?, ?) AS new
     ON DUPLICATE KEY UPDATE email = new.email, code_hmac = new.code_hmac, attempts = 0,
       consumed_at = NULL, expires_at = new.expires_at, created_at = new.created_at, ip_hash = new.ip_hash`,
    [id, normalized, codeDigest(id, code), expiresAt, now, ip ? hmac(ip): '']
  );
  await recordEvent('send', subject, now);
  // 返回的是**下一次**的最小间隔，前端倒计时才和真正生效的规则一致。
  return {challenge: id, retryAfter: Math.round(sendIntervalFor(sends.length + 1) / 1000), provider: result.provider};
}

// ---------------- 验证码登录 ----------------

/**
 * 校验邮箱验证码（email captcha）并建立会话；邮箱首次通过验证时自动建号。
 *
 * @param {object} options 参数。
 * @param {string} options.challenge 挑战 id（来自 cookie）。
 * @param {string} options.emailCaptcha 用户输入的 6 位验证码。
 * @param {string} [options.userAgent] UA 原文，只存哈希。
 * @returns {Promise<{user: object, token: string, expiresAt: Date, isNew: boolean}>} 会话结果。
 */
export async function verifyEmailCaptcha({challenge, emailCaptcha, userAgent = ''}){
  assertAvailable();
  const config = authConfig();
  const input = String(emailCaptcha ?? '').replace(/\D/g, '');
  if(!challenge || input.length !== 6)
    throw new AuthError('email_captcha_invalid', '验证码不足 6 位或缺少挑战');
  // 获取验证码
  const now = new Date();
  const rows = await select('SELECT email, attempts, consumed_at, expires_at FROM login_email_captcha WHERE challenge = ?', [challenge]);
  const row = rows[0];
  // 不存在 / 已消费 / 已过期 / 猜太多次：对外一律同一句「验证码无效」，不泄露具体原因。
  if(!row || row.consumed_at || row.attempts >= config.maxAttempts || row.expires_at.getTime() <= now.getTime())
    throw new AuthError('email_captcha_invalid', '挑战不可用');
  const failures = await countEvents('verify_fail', hmac(row.email), FAIL_WINDOW_MINUTES * 60 * 1000, now);
  if(failures.count >= FAIL_LIMIT)
    throw new AuthError('rate_limited', '验证码错误次数过多', {retryAfter: failures.retryAfter});
  // 唯一的成功判据：这条 UPDATE 影响 1 行。并发提交同一枚码时只有一个请求能拿到 1。
  const consumed = await execute(
    'UPDATE login_email_captcha SET consumed_at = ? WHERE challenge = ? AND code_hmac = ? AND consumed_at IS NULL AND attempts < ? AND expires_at > ?',
    [now, challenge, codeDigest(challenge, input), config.maxAttempts, now]
  );
  if(consumed.affectedRows !== 1){
    await execute('UPDATE login_email_captcha SET attempts = attempts + 1 WHERE challenge = ? AND consumed_at IS NULL AND expires_at > ?', [challenge, now]);
    await recordEvent('verify_fail', hmac(row.email), now);
    throw new AuthError('email_captcha_invalid', '验证码错误');
  }
  // 首次验证自动建号，既有邮箱复用原编号。
  // isNew 不能靠 affectedRows 判断（ON DUPLICATE 命中既有行返回 2），所以先查后插，靠唯一索引兜并发。
  const {user, isNew} = await ensureUser(row.email, now);
  const {token, expiresAt} = await issueSession({user, now, userAgent});
  // 码是对的 ⇒ 是本人：把发码与猜错的旧账一起清掉，别让下一次操作还背着上次的等待。
  await clearRateEvents(row.email);
  return {user, token, expiresAt, isNew};
}

/**
 * 邮箱 + 密码登录。
 *
 * 「邮箱不存在 / 这个账号还没设过密码 / 密码错」对外一律 `credentials_invalid`：
 * 区分它们等于给攻击者一个账号枚举接口。没有密码的账号只能用验证码登录。
 *
 * @param {object} options 参数。
 * @param {string} options.email 邮箱。
 * @param {string} options.password 明文密码。
 * @param {string} [options.userAgent] UA 原文。
 * @returns {Promise<{user: object, token: string, expiresAt: Date}>} 会话结果。
 */
export async function loginWithPassword({email, password, userAgent = ''}){
  assertAvailable();
  const normalized = normalizeEmail(email);
  const input = String(password ?? '');
  const now = new Date();
  const failures = await countEvents('login_fail', hmac(normalized), FAIL_WINDOW_MINUTES * 60 * 1000, now);
  if(failures.count >= FAIL_LIMIT)
    throw new AuthError('rate_limited', '密码错误次数过多', {retryAfter: failures.retryAfter});
  const reject = async () => {
    await recordEvent('login_fail', hmac(normalized), now);
    throw new AuthError('credentials_invalid', '凭据无效');
  };
  if(!isEmail(normalized) || input.length < PASSWORD_MIN || input.length > PASSWORD_MAX){
    await burnPasswordTime(input);
    return reject();
  }
  const rows = await select('SELECT id, email, nickname, bio, password_hash FROM users WHERE email = ?', [normalized]);
  const row = rows[0];
  if(!row || !row.password_hash){
    await burnPasswordTime(input);
    return reject();
  }
  if(!await verifyPassword(input, row.password_hash))
    return reject();
  // 不动 users.updated_at：那是「资料更新」时间，登录不等于改资料；活动时间由 sessions.last_seen_at 记。
  const user = toUser({...row, has_password: true});
  const {token, expiresAt} = await issueSession({user, now, userAgent, passwordHash: row.password_hash});
  // 密码对了 ⇒ 是本人：清掉之前那些「猜错」的旧账。
  await clearRateEvents(normalized);
  return {user, token, expiresAt};
}

/**
 * 找号或建号，返回这次是否新建。
 * @param {string} email 规范化邮箱。
 * @param {Date} now 当前时间。
 * @returns {Promise<{user: object, isNew: boolean}>} 用户与是否新建。
 */
async function ensureUser(email, now){
  const existing = await select('SELECT id, email, nickname, bio, email_verified_at, (password_hash IS NOT NULL) AS has_password FROM users WHERE email = ?', [email]);
  if(existing[0]){
    // 已经核验过的（99% 的情况）只读一次就够；只有第一次验证码登录才补写核验时间。
    if(!existing[0].email_verified_at)
      await execute('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?', [now, now, existing[0].id]);
    const {email_verified_at, ...user} = existing[0];
    return {user, isNew: false};
  }
  try{
    const created = await execute(
      'INSERT INTO users (email, email_verified_at, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [email, now, now, now]
    );
    // 刚验证过的账号既没密码也没昵称 —— 这两项就是「必填但还没填」的。
    return {user: {id: created.insertId, email, nickname: '', bio: '', hasPassword: false}, isNew: true};
  }
  catch(error){
    // 两台设备同时用不同挑战验证同一邮箱：唯一索引兜住，回查即可。
    if(error.code !== 'ER_DUP_ENTRY')
      throw error;
    const raced = await select('SELECT id, email, nickname, bio, (password_hash IS NOT NULL) AS has_password FROM users WHERE email = ?', [email]);
    if(!raced[0])
      throw error;
    return {user: raced[0], isNew: false};
  }
}

/**
 * 签发会话。密码登录与验证码登录共用同一套规则（绝对 7 天 + 空闲 24 小时）。
 * @param {object} options 参数。
 * @param {object} options.user 用户。
 * @param {Date} options.now 当前时间。
 * @param {string} [options.userAgent] UA 原文。
 * @returns {Promise<{token: string, expiresAt: Date}>} 令牌与绝对到期时间。
 */
async function issueSession({user, now, userAgent = '', passwordHash}){
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + authConfig().sessionDays * 24 * 60 * 60 * 1000);
  await transaction(async c => {
    const [[current]] = await c.execute('SELECT password_hash FROM users WHERE id=? FOR UPDATE', [user.id]);
    if(!current || passwordHash !== undefined && current.password_hash !== passwordHash)
      throw new AuthError('credentials_invalid', '凭据在登录期间已改变');
    await c.execute(
      'INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ua_hash) VALUES (?, ?, ?, ?, ?, ?)',
      [hashToken(token), user.id, now, now, expiresAt, userAgent? sha256(userAgent): '']
    );
  });
  return {token, expiresAt};
}

// ---------------- 个人资料 ----------------

/**
 * 必填资料项。**要加新的强制字段，只改这个数组**：
 * 接口按它判断「这个账号能不能进下一步」，页面按它渲染缺失项。
 */
export const PROFILE_FIELDS = [
  {key: 'password', label: '密码', filled: user => Boolean(user.hasPassword)},
  // 昵称是 PRD 里的必填项；「一句话介绍」可选，所以不在这里。
  {key: 'nickname', label: '昵称', filled: user => Boolean(String(user.nickname || '').trim())}
];

/**
 * 这个账号还缺哪些必填项。
 * @param {object|null} user 用户对象（带 hasPassword）。
 * @returns {string[]} 缺失项的 key；已完整返回空数组。
 */
export function missingFields(user){
  if(!user)
    return PROFILE_FIELDS.map(field => field.key);
  return PROFILE_FIELDS.filter(field => !field.filled(user)).map(field => field.key);
}

/**
 * 写个人资料（昵称 / 一句话介绍）—— `POST /api/profile` 用这个。
 *
 * **这个入口不收密码**：首次设置走 initProfile()（`POST /api/profile/init`），
 * 以后修改走 changePassword()（`POST /api/profile/password`，要验旧密码）。
 * 传了 password 直接 400 —— 与其悄悄忽略，不如让调用方立刻知道走错了门。
 * @param {object} options 参数。
 * @param {number} options.userId 用户编号（来自会话）。
 * @param {string} [options.nickname] 昵称（必填项，传了就校验非空）。
 * @param {string} [options.bio] 一句话介绍（可选，可以为空）。
 * @param {object} [options.current] 会话里的用户对象（用来合并返回值，省一次回查）。
 * @returns {Promise<object>} 更新后的用户对象。
 */
export const updateProfile = options => writeProfile(options, {init: false});

/**
 * 首次补全 —— `POST /api/profile/init` 用这个：昵称 + 一次性密码 + 简介。
 *
 * 密码只补空：UPDATE 上带 `AND password_hash IS NULL`，账号已有密码时打不中，
 * 于是抛 password_change_required，逼客户端去账号安全走「验旧密码」的正路。
 * @param {object} options 参数，同 updateProfile，另加 password。
 * @param {string} [options.password] 首次设置的密码。
 * @returns {Promise<object>} 更新后的用户对象。
 */
export const initProfile = options => writeProfile(options, {init: true});

/**
 * 两个入口共用的写法：校验 → 拼**一条** UPDATE → 返回合并后的用户。
 *
 * 多字段合成一条语句是故意的：一次往返、原子生效，不会出现「昵称改了、密码没改」。
 * 两个入口共用它而不是各写一份，是为了让长度/字符/密码规则只有一处。
 * @param {object} options 待写字段。
 * @param {object} options.userId 用户编号（来自会话）。
 * @param {string} [options.password] 密码（只有 init 入口允许）。
 * @param {string} [options.nickname] 昵称。
 * @param {string} [options.bio] 一句话介绍。
 * @param {object} [options.current] 会话里的用户对象。
 * @param {object} options2 开关。
 * @param {boolean} options2.init 是否允许写密码。
 * @returns {Promise<object>} 更新后的用户对象。
 */
async function writeProfile({userId, password, nickname, bio, current = {}}, {init}){
  assertAvailable();
  if(!userId)
    throw new AuthError('unauthenticated', '未登录');
  if(password !== undefined && !init)
    throw new AuthError('invalid_profile', '密码只能首次设置；修改密码请走账号安全');
  const sets = [];
  const params = [];
  /** 本次真正改掉的字段；返回值直接由它和会话用户合并，不再回查一次数据库。 */
  const changed = {};
  /** 去空白 + 限长。按**码点**数（Array.from）而不是 UTF-16 单元：一个 emoji 算 1 个字符，和数据库 VARCHAR 的口径一致。 */
  const text = (value, max) => {
    const trimmed = String(value ?? '').trim();
    if(Array.from(trimmed).length > max)
      throw new AuthError('invalid_profile', `最多 ${max} 个字符`);
    return trimmed;
  };
  if(password !== undefined){
    const value = String(password);
    if(value.length < PASSWORD_MIN || value.length > PASSWORD_MAX)
      throw new AuthError('invalid_password', `密码需 ${PASSWORD_MIN}–${PASSWORD_MAX} 个字符`);
    sets.push('password_hash = ?');
    params.push(await hashPassword(value));
    changed.hasPassword = true;
  }
  if(nickname !== undefined){
    const value = text(nickname, NICKNAME_MAX);
    // 昵称是必填项：传了空值就是错，而不是悄悄存个空字符串。
    if(!value)
      throw new AuthError('invalid_profile', '昵称不能为空');
    if(FORBIDDEN_NICKNAME.test(value))
      throw new AuthError('invalid_profile', '昵称不能包含 / \\ 或不可见字符');
    sets.push('nickname = ?');
    params.push(value);
    changed.nickname = value;
  }
  if(bio !== undefined){
    const value = text(bio, BIO_MAX);
    sets.push('bio = ?');
    params.push(value);
    changed.bio = value;
  }
  if(!sets.length)
    throw new AuthError('invalid_profile', '没有要更新的字段');
  sets.push('updated_at = ?');
  params.push(new Date());
  params.push(userId);
  // 这个接口只负责**补**密码，绝不替换已有的：已有密码必须走改密接口，那里要验旧密码。
  const saved = await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?${password !== undefined? ' AND password_hash IS NULL': ''}`, params);
  if(password !== undefined && !saved.affectedRows)
    throw new AuthError('password_change_required', '已有密码必须通过安全验证修改');
  return {...current, id: userId, ...changed};
}

/**
 * 改密码：凭会话令牌认出是谁 → 验旧密码 → 写新哈希 → 撤掉这个账号的全部会话。
 *
 * 只收 token、不收 userId：调用方说不出「改谁的密码」，一切以这条会话为准，
 * 「userId 和 token 不是一对」这种串号从结构上就不存在。
 * 会话校验与写入在同一个事务里，所以「读到会话之后、写入之前被撤销」也会被拒。
 * @param {object} params 参数。
 * @param {string} params.token 当前会话令牌原文（函数内哈希后比对，光有 cookie 不算数）。
 * @param {string} params.currentPassword 旧密码。
 * @param {string} params.newPassword 新密码。
 * @param {string} params.confirmPassword 再输一遍新密码。
 * @returns {Promise<{ok: true}>} 成功（会话已被撤销，调用方必须把人送回登录页）。
 */
export async function changePassword({token, currentPassword, newPassword, confirmPassword}){
  assertAvailable();
  if(typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX)
    throw new AuthError('invalid_password', '新密码长度不合法');
  if(newPassword !== confirmPassword)
    throw new AuthError('password_mismatch', '两次新密码不一致');
  if(newPassword === currentPassword)
    throw new AuthError('password_unchanged', '新密码不能与当前密码相同');
  const result = await transaction(async c => {
    const [[session]] = await c.execute('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?', [hashToken(token), new Date()]);
    if(!session)
      return {error: 'unauthenticated'};
    return applyPassword(c, session.user_id, {currentPassword, newPassword});
  });
  if(result.error)
    throw new AuthError(result.error, '修改密码验证失败', result.error === 'rate_limited'? {retryAfter: 900}: {});
  return result;
}

/**
 * 在**已开的事务里**换掉指定账号的密码，并撤销它全部会话。
 *
 * 刻意不导出、也不自己开事务：会话校验必须是同一个事务的一部分，否则「校验通过 → 写入之前被撤销」那个窗口又回来了。
 * 将来要有第二个入口（管理端强制重置之类），在它自己的事务里调这个函数。
 * 猜错的计数必须留下（`password_change`，15 分钟 5 次），所以失败不走异常回滚，
 * 而是返回错误标记让事务正常提交，由调用方出了事务再抛。
 * @param {object} c 事务连接。
 * @param {number} userId 用户编号。
 * @param {object} input 新旧密码。
 * @param {string} input.currentPassword 旧密码。
 * @param {string} input.newPassword 新密码（长度与两遍一致已在外层校验）。
 * @returns {Promise<{ok: true}|{error: string}>} 成功，或可映射成错误码的失败标记。
 */
async function applyPassword(c, userId, {currentPassword, newPassword}){
  const subject = hmac(`password-change:${userId}`);
  const [[user]] = await c.execute('SELECT password_hash FROM users WHERE id=? FOR UPDATE', [userId]);
  if(!user)
    return {error: 'unauthenticated'};
  // 只用验证码登录过的账号没有密码可验：该去补全页设一个，而不是在这里「改」。
  if(!user.password_hash)
    return {error: 'password_not_set'};
  const [[attempts]] = await c.execute("SELECT COUNT(*) AS n FROM rate_events WHERE kind='password_change' AND subject=? AND at>?", [subject, new Date(Date.now() - 15 * 60 * 1000)]);
  if(attempts.n >= 5)
    return {error: 'rate_limited'};
  if(typeof currentPassword !== 'string' || currentPassword.length > 72 || !await verifyPassword(currentPassword, user.password_hash)){
    await c.execute("INSERT INTO rate_events(kind,subject,at) VALUES ('password_change',?,?)", [subject, new Date()]);
    return {error: 'current_password_invalid'};
  }
  const hash = await hashPassword(newPassword);
  await c.execute('UPDATE users SET password_hash=?,updated_at=? WHERE id=?', [hash, new Date(), userId]);
  await c.execute('DELETE FROM sessions WHERE user_id=?', [userId]);
  await c.execute("DELETE FROM rate_events WHERE kind='password_change' AND subject=?", [subject]);
  return {ok: true};
}

// ---------------- 公开主页 ----------------
/**
 * 公开主页要用的用户资料：**只取能公开的列**。
 *
 * 邮箱、密码哈希、验证时间一概不碰 —— 那个页面只接收这一个返回值，
 * 所以「模板里不小心写出邮箱」这类事故在数据层面就不可能发生。
 * @param {string|number} id 用户编号（URL 里的 uid）。
 * @returns {Promise<{id: number, nickname: string, bio: string, joinedAt: Date} | null>} 没这个人或编号非法时返回 null。
 */
export async function findPublicUser(id){
  const uid = Number(id);
  if(!dbReady() || !Number.isSafeInteger(uid) || uid <= 0)
    return null;
  const rows = await select('SELECT id, nickname, bio, created_at FROM users WHERE id = ?', [uid]);
  const row = rows[0];
  if(!row)
    return null;
  return {id: Number(row.id), nickname: row.nickname || '', bio: row.bio || '', joinedAt: row.created_at};
}

// ---------------- 会话 ----------------

/**
 * 读取会话对应用户；绝对到期与空闲到期都在这里判定。
 * @param {string} token 会话令牌（cookie 原文）。
 * @returns {Promise<{user: object, expiresAt: Date} | null>} 会话有效时返回用户，否则 null。
 */
export async function readSession(token){
  if(!token || !dbReady())
    return null;
  const rows = await select(
    `SELECT s.last_seen_at, s.expires_at, u.id, u.email, u.nickname, u.bio,
       (u.password_hash IS NOT NULL) AS has_password
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    [hashToken(token)]
  );
  const row = rows[0];
  if(!row)
    return null;
  const now = Date.now();
  if(row.expires_at.getTime() <= now)
    return null;
  if(now - row.last_seen_at.getTime() > authConfig().idleHours * 60 * 60 * 1000){
    // 空闲超时：顺手撤掉这条会话。撤不掉也只是留一条过期行，不该让请求变成 503。
    await revokeSession(token).catch(error => console.error('[auth] 清理过期会话失败：', error.message));
    return null;
  }
  if(now - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS){
    // 续活跃时间失败不影响这次请求：下次再来会再试一次。
    await execute('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', [new Date(now), hashToken(token)])
      .catch(error => console.error('[auth] 刷新会话活跃时间失败：', error.message));
  }
  return {user: toUser(row), expiresAt: row.expires_at};
}

/**
 * 撤销一个会话。已不存在也算成功，避免退出按钮因重放而报错。
 * @param {string} token 会话令牌原文。
 * @returns {Promise<void>} 无。
 */
export async function revokeSession(token){
  if(!token || !dbReady())
    return;
  await execute('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
}
