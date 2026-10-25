// 认证接口层：只做 HTTP 的事 —— 读 cookie、验 CSRF、解析 JSON、映射状态码。
// 业务判断全在 auth.mjs，这里不写 SQL、也不判断验证码对错。
//
// 三个信号别合成一个：
//   disabled      账号系统（登录/会话）是否可用
//   canSendCode   发码是否可用（同样需要数据库 —— 挑战要落库才能校验）
//   user          当前会话的用户，或 null
import {randomBytes} from 'node:crypto';

import {
  AuthError, authAvailable, requestEmailCaptcha, verifyEmailCaptcha, loginWithPassword,
  readSession, revokeSession, challengeCookieMaxAge, sessionCookieMaxAge,
  missingFields, updateProfile, changePassword
} from './auth.mjs';
import {isUnavailable, dbHealthy} from './db.mjs';
import {mailPaused, dbConfig, authConfig} from './config.mjs';
import {site} from '../content/site.mjs';

const SESSION_COOKIE = 'nc_sid';
const CHALLENGE_COOKIE = 'nc_chal';
const CSRF_COOKIE = 'nc_csrf';

/** 请求体上限：登录只需要一两个字段，超过 16 KB 一律拒绝。 */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * 解析 cookie 头。
 * @param {string} [header] 原始 Cookie 头。
 * @returns {Record<string,string>} 名称到值的映射。
 */
export function parseCookies(header = ''){
  const cookies = {};
  for(const part of String(header).split(';')){
    const index = part.indexOf('=');
    if(index < 0)
      continue;
    const name = part.slice(0, index).trim();
    if(name)
      cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

/**
 * 序列化一条 Set-Cookie。
 *
 * Secure 只在非本机地址上加(生产域名必然是https，而本机用 http://127.0.0.1 调试时带上Secure浏览器会直接丢掉整条cookie)
 * @param {string} name cookie 名。
 * @param {string} value cookie 值。
 * @param {object} options 选项。
 * @param {number} [options.maxAge=0] 存活秒数，0 表示立即过期。
 * @param {boolean} [options.httpOnly=true] 是否禁止脚本读取。
 * @param {string} options.host 请求 Host。
 * @returns {string} Set-Cookie 值。
 */
function setCookie(name, value, {maxAge = 0, httpOnly = true, host = ''}){
  const parts = [`${name}=${value}`, 'Path=/', `Max-Age=${maxAge}`, 'SameSite=Lax'];
  if(httpOnly)
    parts.push('HttpOnly');
  if(!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host))
    parts.push('Secure');
  return parts.join('; ');
}

/**
 * 校验回跳目标：本函数只接受站内路径。
 *
 * 客户端 public/auth.js 里有一份同规则的实现，但**服务端必须再判一次**（客户端可被绕过）。
 * 反斜杠、协议相对地址（//host）、其它域名、控制字符全部拒绝。
 * @param {unknown} value 客户端提交的目标。
 * @returns {string} 合法的站内路径，非法时返回空串。
 */
export function safeNext(value){
  const text = String(value ?? '').trim();
  if(!text || text.length > 2000)
    return '';
  if(/[\\\u0000-\u001f\u007f]/.test(text))
    return '';
  if(!text.startsWith('/') || text.startsWith('//'))
    return '';
  let url;
  try{
    url = new URL(text, site.url);
  }
  catch{
    return '';
  }
  if(url.origin !== new URL(site.url).origin)
    return '';
  // 登录页自身不是有意义的落点，回跳过去只会形成循环。
  if(url.pathname === '/login/')
    return '';
  return url.pathname + url.search + url.hash;
}

/**
 * 登录成功后该去哪儿。
 *
 * 资料没补全（目前是没设密码）就先去 /profile/force/ 补，补完再回到用户本来想去的地方 ——
 * 这就是「不填完不能继续」的落点：跳转由服务端给，前端只负责照做。
 * @param {object} user 用户对象。
 * @param {unknown} next 客户端提交的回跳目标。
 * @returns {string} 目标地址。
 */
function landing(user, next){
  const target = safeNext(next) || '/';
  const missing = missingFields(user);
  return missing.length? `/profile/force/?next=${encodeURIComponent(target)}`: target;
}

/**
 * 同源校验：POST 必须带 Origin，且主机与请求的 Host 一致。
 * 只比主机不比协议 —— 同一台机器上 http/https 都可能出现，比协议只会误伤本机调试。
 * @param {object} headers 请求头。
 * @returns {boolean} 是否同源。
 */
export function sameOrigin(headers){
  const source = headers.origin || headers.referer;
  if(!source)
    return false;
  try{
    return new URL(source).host === headers.host;
  }
  catch{
    return false;
  }
}

/**
 * 解析 JSON 请求体。
 * @param {string|Buffer|null} body 原始请求体。
 * @returns {object|null} 解析结果；非法或超限返回 null。
 */
function readJson(body){
  const text = Buffer.isBuffer(body)? body.toString('utf8'): String(body ?? '');
  if(!text || text.length > MAX_BODY_BYTES)
    return null;
  try{
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object'? parsed: null;
  }
  catch{
    return null;
  }
}

/**
 * 组装 JSON 响应。私人接口一律 no-store，任何共享缓存都不该留。
 * @param {number} status HTTP 状态码。
 * @param {unknown} payload 响应体。
 * @param {object} [headers] 附加响应头。
 * @returns {{status: number, headers: object, body: Buffer}} 响应描述。
 */
function responseJson(status, payload, headers = {}){
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-nanocamp-source': 'api',
      ...headers
    },
    body: Buffer.from(JSON.stringify(payload), 'utf8')
  };
}

/** 错误码 → HTTP 状态码。 */
/** 认证不可用只提示一次，避免每个请求刷一行日志。 */
let warnedUnavailable = false;

const errorStatus = {mail_paused: 503, invalid_email: 400, email_captcha_invalid: 400, invalid_password: 400, invalid_profile: 400, credentials_invalid: 401, unauthenticated: 401, rate_limited: 429, mail_failed: 502, unavailable: 503};
Object.assign(errorStatus,{password_change_required:403,current_password_invalid:403,password_mismatch:400,password_unchanged:400});

/**
 * 处理 /api/* 请求。
 * @param {object} request 请求描述。
 * @param {string} request.method HTTP 方法。
 * @param {string} request.pathname 已解码的路径。
 * @param {object} request.headers 请求头。
 * @param {string|Buffer|null} [request.body] 原始请求体。
 * @param {string} [request.ip] 来源 IP（由传输层给出，不读自定义头）。
 * @returns {Promise<{status: number, headers: object, body: Buffer}>} 响应描述。
 */
export async function handleApi({method, pathname, headers, body = null, ip = ''}){
  const cookies = parseCookies(headers.cookie);
  const host = headers.host || '';
  const available = authAvailable();
  // 会话状态查询 + CSRF 令牌发放
  if(pathname === '/api/session'){
    if(method !== 'GET')
      return responseJson(405, {error: 'method_not_allowed'}, {allow: 'GET'});
    if(!available){
      // 只说一次：缺哪一项写清楚，别让人对着一句「系统未开放」猜。
      if(!warnedUnavailable){
        warnedUnavailable = true;
        const missing = [
          dbConfig().database? '': 'db.database',
          authConfig().secret? '': 'auth.secret'
        ].filter(Boolean);
        console.error(`[api] 认证不可用：data/config.json 缺 ${missing.join(' 和 ')}，登录/资料接口都会返回 503。`);
      }
      return responseJson(200, {user: null, disabled: true, canSendCode: false});
    }
    // 配了库不等于库活着：这里再问一次（60 秒缓存），库挂了就明确告诉前端「暂时不可用」，而不是让人以为「功能没开放」。
    if(!await dbHealthy())
      return responseJson(503, {error: 'unavailable'});
    let session = null;
    try{
      session = await readSession(cookies[SESSION_COOKIE]);
    }
    catch(error){
      // 读库失败不能伪装成「未登录」：前端要能把这两种情况区分开。
      console.error('[api] 读取会话失败：', error.message);
      return responseJson(503, {error: 'unavailable'});
    }
    // CSRF double-submit 的令牌：匿名访客也要发一个，发码/登录都用得上。
    const csrf = cookies[CSRF_COOKIE] || randomBytes(16).toString('hex');
    // missing：这个账号还缺哪些必填资料（目前只有密码）。前端据此把人拦在补全页。
    // mailPaused：运维把发信暂停了（data/PAUSE_MAIL 存在）。前端据此只锁「发码」，登录照常用。
    const paused = mailPaused();
    const response = responseJson(200, {user: session?.user ?? null, csrf, disabled: false, canSendCode: !paused, mailPaused: paused, missing: session? missingFields(session.user): []});
    if(!cookies[CSRF_COOKIE])
      response.headers['set-cookie'] = [setCookie(CSRF_COOKIE, csrf, {httpOnly: false, maxAge: sessionCookieMaxAge(), host})];
    return response;
  }
  // 其余带cookie请求
  if(!['/api/auth/email-captcha', '/api/auth/verify', '/api/auth/login', '/api/auth/logout', '/api/profile', '/api/profile/password'].includes(pathname))
    return responseJson(404, {error: 'not_found'});
  if(method !== 'POST')
    return responseJson(405, {error: 'method_not_allowed'}, {allow: 'POST'});
  // 两道闸：同源 Origin + double-submit 令牌。这一版有真会话了，两个都要。
  if(!sameOrigin(headers) || !cookies[CSRF_COOKIE] || headers['x-nc-csrf'] !== cookies[CSRF_COOKIE])
    return responseJson(403, {error: 'forbidden'});
  if(!available)
    return responseJson(503, {error: 'unavailable'});
  // 退出没有请求体，不能走下面统一的 JSON 解析，否则会被判 invalid_body。
  if(pathname === '/api/auth/logout'){
    try{
      await revokeSession(cookies[SESSION_COOKIE]);
    }
    catch(error){
      // 会话没撤掉就不能假装成功：cookie 一清，用户以为自己退出了，其实那条会话还能用。
      if(isUnavailable(error)){
        console.error('[api] 数据库不可用（退出登录）：', error.message);
        return responseJson(503, {error: 'unavailable'});
      }
      throw error;
    }
    return responseJson(200, {ok: true}, {
      'set-cookie': [
        setCookie(SESSION_COOKIE, '', {maxAge: 0, host}),
        setCookie(CSRF_COOKIE, '', {maxAge: 0, httpOnly: false, host})
      ]
    });
  }
  // 读请求体，其余要求有请求体
  const payload = readJson(body);
  if(!payload)
    return responseJson(400, {error: 'invalid_body'});
  try{
    if(pathname === '/api/auth/email-captcha'){
      const result = await requestEmailCaptcha({email: payload.email, ip, challenge: cookies[CHALLENGE_COOKIE] || ''});
      return responseJson(200, {ok: true, provider: result.provider, retryAfter: result.retryAfter, canVerify: true}, {
        'set-cookie': [setCookie(CHALLENGE_COOKIE, result.challenge, {maxAge: challengeCookieMaxAge(), host})]
      });
    }
    if(pathname === '/api/auth/login'){
      const result = await loginWithPassword({email: payload.email, password: payload.password, userAgent: headers['user-agent'] || ''});
      return responseJson(200, {ok: true, user: result.user, missing: missingFields(result.user), redirect: landing(result.user, payload.next)}, {
        'set-cookie': [setCookie(SESSION_COOKIE, result.token, {maxAge: sessionCookieMaxAge(), host})]
      });
    }
    // 公开资料与首次密码初始化；已有密码的修改走独立的再次验证接口。
    if(pathname === '/api/profile/password'){
      const session=await readSession(cookies[SESSION_COOKIE]);
      if(!session)return responseJson(401,{error:'unauthenticated'});
      await changePassword({userId:session.user.id,token:cookies[SESSION_COOKIE],currentPassword:payload.currentPassword,newPassword:payload.newPassword,confirmPassword:payload.confirmPassword});
      return responseJson(200,{ok:true,reauthenticate:true},{'set-cookie':[
        setCookie(SESSION_COOKIE,'',{maxAge:0,host}),
        setCookie(CSRF_COOKIE,'',{maxAge:0,httpOnly:false,host})
      ]});
    }
    if(pathname === '/api/profile'){
      let session = null;
      try{
        session = await readSession(cookies[SESSION_COOKIE]);
      }
      catch(error){
        console.error('[api] 读取会话失败：', error.message);
        return responseJson(503, {error: 'unavailable'});
      }
      if(!session)
        return responseJson(401, {error: 'unauthenticated'});
      const user = await updateProfile({
        userId: session.user.id,
        current: session.user,
        password: payload.password,
        nickname: payload.nickname,
        bio: payload.bio
      });
      return responseJson(200, {ok: true, user, missing: missingFields(user)});
    }
    if(pathname === '/api/auth/verify'){
      const result = await verifyEmailCaptcha({challenge: cookies[CHALLENGE_COOKIE] || '', emailCaptcha: payload.emailCaptcha, userAgent: headers['user-agent'] || ''});
      return responseJson(200, {ok: true, user: result.user, isNew: result.isNew, missing: missingFields(result.user), redirect: landing(result.user, payload.next)}, {
        'set-cookie': [
          setCookie(SESSION_COOKIE, result.token, {maxAge: sessionCookieMaxAge(), host}),
          // 码已消费，挑战 cookie 立刻失效，免得同一枚码在另一个标签页里再被尝试。
          setCookie(CHALLENGE_COOKIE, '', {maxAge: 0, host})
        ]
      });
    }
    return responseJson(404, {error: 'not_found'});
  }
  catch(error){
    if(error instanceof AuthError){
      const extra = error.retryAfter? {'retry-after': String(error.retryAfter)}: {};
      return responseJson(errorStatus[error.code] || 400, {error: error.code, retryAfter: error.retryAfter || undefined}, extra);
    }
    // 数据库连不上不是「我们的 bug」，对调用方是「稍后再试」：503 而不是 500。
    if(isUnavailable(error)){
      console.error('[api] 数据库不可用：', error.message);
      return responseJson(503, {error: 'unavailable'});
    }
    throw error;
  }
}
