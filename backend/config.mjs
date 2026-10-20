// 新增模块（邮件、数据库、认证接口）读配置的入口。
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/** 实例配置文件的绝对路径。整个 data/ 目录不进版本库，每台机器各写一份。 */
export const configPath = fileURLToPath(new URL('../data/config.json', import.meta.url));

/** 监听相关的默认值：绑本机所有网卡，便于部署后直接访问。 */
export const SERVER_DEFAULTS = Object.freeze({host: '0.0.0.0', port: 8080, name: 'Nanocamp'});

/**
 * 解析结果的缓存。
 *
 * 配置是**部署属性**，不是每次请求都要变的东西：进程内读一次就够。
 */
let cached = null;

/**
 * 读文件并解析，把错误原样带出来（区分「文件不存在」与「读不动/不是 JSON」）。
 * 结果（含错误）会被缓存，`reloadConfig()` 才会重新读盘。
 * @returns {{raw: object, error: Error|null}} 解析结果；ENOENT 视为正常情况，error 为 null。
 */
function readConfig(){
  if(cached)
    return cached;
  try{
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    cached = {raw: (raw && typeof raw === 'object'? raw: {}), error: null};
  }
  catch(error){
    cached = {raw: {}, error: error.code === 'ENOENT'? null: error};
  }
  return cached;
}

/**
 * 读取整份配置；文件不存在、读不动或不是合法 JSON 时返回空对象。
 * 缺失字段一律由各模块自己兜默认值，所以这里不抛错 —— 配置坏掉不应该让站点起不来。
 * @returns {object} 配置对象（可能为空）。
 */
export function loadConfig(){
  return readConfig().raw;
}

/**
 * 监听配置：host / port / name / url。
 *
 * 容错原则是「绝不因为配置问题起不来」：字段缺失或类型写错一律用默认值兜住，问题通过 warnings 交回调用方打印
 * （这里不自己打日志：实例名 tag 由 main.mjs 决定，config 不该关心日志格式）。
 *
 * url 是**域名覆盖**：只接受 http/https，并用 URL 解析器补上结尾斜杠
 * （https://x.club → https://x.club/），否则 canonical 会拼成 https://x.clubabout/。
 * @param {object} [raw] 配置对象；默认读 data/config.json。
 * @returns {{host: string, port: number, name: string, url: string, warnings: string[]}} 监听配置与解析告警。
 */
export function serverSettings(raw = readConfig().raw){
  const settings = {...SERVER_DEFAULTS};
  const warnings = [];
  if(typeof raw?.host === 'string' && raw.host.trim())
    settings.host = raw.host.trim();
  if(Number.isInteger(raw?.port) && raw.port > 0 && raw.port < 65536)
    settings.port = raw.port;
  else if(raw?.port !== undefined)
    warnings.push(`port 必须是 1-65535 的整数，已改用默认值 ${SERVER_DEFAULTS.port}：${JSON.stringify(raw.port)}`);
  if(typeof raw?.name === 'string' && raw.name.trim())
    settings.name = raw.name.trim();

  let url = '';
  if(typeof raw?.url === 'string' && raw.url.trim()){
    try{
      const parsed = new URL(raw.url.trim());
      if(parsed.protocol === 'http:' || parsed.protocol === 'https:') url = parsed.href;
    }
    catch{
      url = '';
    }
    if(!url)
      warnings.push(`data/config.json 里的 url 不是合法的 http/https 地址，已忽略：${JSON.stringify(raw.url)}`);
  }
  return {...settings, url, warnings};
}

/**
 * 邮件投递配置。
 *
 * provider 只有两个值：
 *   'console' —— 不真发信，把验证码打到 stdout，用于本机开发；
 *   'resend'  —— 走 Resend 的 HTTPS 接口，需要 apiKey 与已认证的发信域。
 * 默认是 console，意味着「没配就发不出去」，而不是悄悄退化成某个能发信的服务。
 * @returns {{provider: string, apiKey: string, from: string, replyTo: string, baseUrl: string}}
 */
/** mail 顶层允许的字段。 */
const MAIL_KEYS = ['provider', 'apiKey', 'from', 'replyTo', 'baseUrl'];
const MAIL_META_KEYS = ['streams', 'defaultStream'];
/** streams.<名字> 允许的字段。 */
const STREAM_KEYS = ['provider', 'apiKey', 'from', 'replyTo', 'baseUrl'];

/**
 * 解析某一类邮件（stream）的投递配置。纯函数，不读文件，便于单测。
 *
 * 设计要点：**发件人地址与 API Key 是两个独立维度**。
 *   - 一个 Key 可以向同一个已验证域下的任意 local part 发信（captcha@ / notice@ / event@…）；
 *   - 一个 stream 只需要写自己与顶层不同的字段，其余从顶层继承（典型情况：共用一把 Key、只换 from）。
 *   - 想让某个 stream 用另一把 Key（轮换、限权、独立审计）时，才在它自己那一层写 apiKey。
 *
 * 兼容老配置：完全没有 `streams` 时，顶层字段就是唯一的一套配置，行为与之前一致。
 * @param {object} raw 整份配置对象（data/config.json 的内容）。
 * @param {string} [stream] stream 名称；空串表示用 defaultStream 或顶层。
 * @returns {{provider: string, apiKey: string, from: string, replyTo: string, baseUrl: string, stream: string, warnings: string[]}}
 */
export function resolveMail(raw = {}, stream = ''){
  const mail = raw.mail || {};
  const streams = mail.streams && typeof mail.streams === 'object'? mail.streams: {};
  const warnings = [];
  const base = {
    provider: String(mail.provider || 'console').toLowerCase(),
    apiKey: String(mail.apiKey || ''),
    // 发件人：Resend 里的 Key 名称与这里的地址无关，local part 可任意取，只要域已验证。
    from: String(mail.from || 'NanoCamp <donotreply@mail.nanocamp.club>'),
    replyTo: String(mail.replyTo || ''),
    baseUrl: String(mail.baseUrl || 'https://nanocamp.club').replace(/\/+$/, '')
  };
  const name = String(stream || mail.defaultStream || '');
  const overlay = name && streams[name] && typeof streams[name] === 'object'? streams[name]: null;
  // 未知字段一律点名，不静默忽略：字段名写错时配置看着生效、发信却用错密钥，最难排查。
  for(const key of Object.keys(mail)){
    if(MAIL_KEYS.includes(key) || MAIL_META_KEYS.includes(key)) continue;
    warnings.push(`mail.${key} 不是有效字段，已被忽略`);
  }
  if(overlay){
    for(const key of Object.keys(overlay)){
      if(STREAM_KEYS.includes(key))
        continue;
      warnings.push(`mail.streams.${name}.${key} 不是有效字段，已被忽略`);
    }
  }
  // 按base补全streams里的字段
  const resolved = overlay? {
    provider: String(overlay.provider || base.provider).toLowerCase(),
    apiKey: String(overlay.apiKey || base.apiKey),      // 留空即继承顶层那把 Key
    from: String(overlay.from || base.from),
    replyTo: String(overlay.replyTo || base.replyTo),
    baseUrl: String(overlay.baseUrl || base.baseUrl).replace(/\/+$/, '')
  }: {...base, stream: name || 'default'};
  const config = {...resolved, stream: overlay? name: (name || 'default')};
  // 占位符检查：真的调用时才会 401，提前说一句能省掉一轮排查。
  if(config.apiKey && !/^re_[A-Za-z0-9_-]{20,}$/.test(config.apiKey))
    warnings.push(`apiKey（stream=${config.stream}）不像 Resend 的真实 Key：应为 re_ 开头且长度 20 以上，当前是「${config.apiKey.slice(0, 12)}…」`);
  if(config.provider === 'resend' && !config.apiKey)
    warnings.push(`provider=resend 但 stream=${config.stream} 没有 apiKey，发信一定失败`);
  return {...config, warnings};
}

/**
 * 读取邮件配置。
 *
 * 解析出来的告警（未知字段、占位符密钥、resend 却没有密钥）只在首次出现时打一次 stderr ——
 * 发信是热路径，不能让同一个告警把日志刷满，也不能让它悄悄消失。
 * @param {string} [stream] stream 名称，例如 'auth'；不传则用配置里的 defaultStream。
 * @returns {{provider: string, apiKey: string, from: string, replyTo: string, baseUrl: string, stream: string, warnings: string[]}}
 */
export function mailConfig(stream = ''){
  const config = resolveMail(loadConfig(), stream);
  for(const warning of config.warnings){
    if(warnedMail.has(warning)) continue;
    warnedMail.add(warning);
    console.warn(`[mail] ${warning}`);
  }
  return config;
}

/** 已经打过 stderr 的告警，避免每个请求刷一次。 */
const warnedMail = new Set();

/**
 * 认证相关参数。
 *
 * secret 缺失时整条认证链都不可用（接口返回 503），**不会**退化成随机密钥 ——
 * 否则每次重启都会让所有会话失效，而且验证码 HMAC 也就失去意义。
 * 生成方式：node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 *
 * trustProxy 决定是否采信 x-forwarded-for / x-forwarded-proto。生产走 nginx 反代时为 true，
 * 直连时保持 false，避免客户端伪造来源 IP 绕过限流。
 * @returns {{secret: string, trustProxy: boolean, codeMinutes: number, maxAttempts: number, resendSeconds: number, sendLimitPerHour: number, sessionDays: number, idleHours: number}}
 */
export function authConfig(){
  const auth = loadConfig().auth || {};
  return {
    secret: String(auth.secret || ''),
    trustProxy: Boolean(auth.trustProxy),
    codeMinutes: Number(auth.codeMinutes) || 10,
    maxAttempts: Number(auth.maxAttempts) || 5,
    resendSeconds: Number(auth.resendSeconds) || 60,
    sendLimitPerHour: Number(auth.sendLimitPerHour) || 5,
    sessionDays: Number(auth.sessionDays) || 7,
    idleHours: Number(auth.idleHours) || 24
  };
}

/**
 * MySQL 连接配置。
 *
 * **库名与实例 name 保持一致**（生产 `Nanocamp`、测试 `Nanocamp-test`），
 * 生产与测试各用各的库、各用各的账号，隔离靠授权而不是靠约定。
 * 没有 `database` 时视为「没配数据库」，db.mjs 会直接拒绝工作。
 * @returns {{host: string, port: number, user: string, password: string, database: string, connectionLimit: number}} 连接参数。
 */
export function dbConfig(){
  const db = loadConfig().db || {};
  return {
    host: String(db.host || '127.0.0.1'),
    port: Number(db.port) || 3306,
    user: String(db.user || ''),
    password: String(db.password || ''),
    database: String(db.database || ''),
    connectionLimit: Number(db.connectionLimit) || 10
  };
}

/**
 * 运维开关文件：**存在即暂停所有新增发信**（验证码照常可以校验，登录不受影响）。
 *
 * 为什么用文件而不是配置项：配置只在启动时读一次，改完要重启；而「暂停发信」是救火动作，
 * 需要在服务不停机的情况下立刻生效。`touch data/PAUSE_MAIL` 停，`rm data/PAUSE_MAIL` 恢复。
 * @returns {boolean} 是否处于暂停状态。
 */
export const pauseFile = fileURLToPath(new URL('../data/PAUSE_MAIL', import.meta.url));

/** 现在是否暂停发信。每次调用都看文件在不在（一次 stat，几微秒），不走缓存。 */
export const mailPaused = () => existsSync(pauseFile);
