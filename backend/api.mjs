// API 层的唯一入口：/api/* 先在这里按 URL 空间分派（头像 → 论坛 → 剩下的认证接口），再各管各的。
// 本文件只做 HTTP 的事 —— 读 cookie、验 CSRF、解析 JSON、映射状态码；业务判断全在 auth / avatar / forum 里。
//
// 分派顺序有意义：头像与论坛的前缀更具体，先匹配；剩下的一律当作认证接口（未知路径由它回 404）。
// 三个信号别合成一个：
//   disabled      账号系统（登录/会话）是否可用
//   canSendCode   发码是否可用（同样需要数据库 —— 挑战要落库才能校验）
//   user          当前会话的用户，或 null
import {randomBytes} from 'node:crypto';

import {handleAvatarApi} from './avatar/routes.mjs';
import {
  AuthError, authAvailable, requestEmailCaptcha, verifyEmailCaptcha, loginWithPassword,
  readSession, revokeSession, challengeCookieMaxAge, sessionCookieMaxAge,
  missingFields, updateProfile, initProfile, changePassword
} from './auth.mjs';
import {parseCookies,sameOrigin} from './base.mjs';
import {mailPaused, dbConfig, authConfig} from './config.mjs';
import {isUnavailable, dbHealthy} from './db.mjs';
import {handleForumApi} from './forum/routes.mjs';
import {site} from '../content/site.mjs';

const SESSION_COOKIE = 'nc_sid';
const CHALLENGE_COOKIE = 'nc_chal';
const CSRF_COOKIE = 'nc_csrf';
/**
 * 「已登录」的前端标记：值是用户编号，**不是凭证**。
 *
 * 唯一用途是让导航栏那个圆在第一帧就知道该画「登录」还是头像 ——
 * 页面是按路由共享缓存的，服务端渲染不出登录态，而等 /api/session 回来再画会闪一下。
 * 所以它故意是可读 cookie（凭证仍然只在 HttpOnly 的 nc_sid 里）。
 * ⚠️ 它只影响「画什么」，权限判定一律走服务端会话：伪造它最多只能骗自己看到一个人像。
 */
const UI_COOKIE = 'nc_ui';

/** 请求体上限：登录只需要一两个字段，超过 16 KB 一律拒绝。 */
const MAX_BODY_BYTES = 16 * 1024;

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
 * 下发 / 清除「已登录」的前端标记（见 UI_COOKIE）。
 * @param {string|number} value 用户编号；空串表示清除。
 * @param {string} host 请求 Host（决定要不要带 Secure）。
 * @param {number} maxAge 存活秒数，0 表示立即过期。
 * @returns {string} Set-Cookie 值。
 */
const uiCookie = (value, host, maxAge) => setCookie(UI_COOKIE, String(value ?? ''), {httpOnly: false, maxAge, host});

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

/** 认证不可用只提示一次，避免每个请求刷一行日志。 */
let warnedUnavailable = false;

/** 错误码 → HTTP 状态码。没登记的按 400 处理（都是「调用方参数不对」）。 */
const errorStatus = {
  mail_paused: 503,
  invalid_email: 400,
  email_captcha_invalid: 400,
  invalid_password: 400,
  invalid_profile: 400,
  credentials_invalid: 401,
  unauthenticated: 401,
  rate_limited: 429,
  mail_failed: 502,
  unavailable: 503,
  password_change_required: 403,
  current_password_invalid: 403,
  password_mismatch: 400,
  password_unchanged: 400,
  password_not_set: 400
};

/**
 * 处理剩下的认证接口：`/api/session`、`/api/auth/*`、`/api/profile*`。
 *
 * 头像与论坛的路径在 `handleApiRequest` 里就被分走了，这里不再判断前缀，只认具体的路径名。
 * @param {object} request 请求描述。
 * @param {string} request.method HTTP 方法。
 * @param {string} request.pathname 已解码的路径。
 * @param {object} request.headers 请求头。
 * @param {string|Buffer|null} [request.body] 原始请求体。
 * @param {string} [request.ip] 来源 IP（由传输层给出，不读自定义头）。
 * @returns {Promise<{status: number, headers: object, body: Buffer}>} 响应描述。
 */
async function handleAuthApi({method, pathname, headers, body = null, ip = ''}){
  const cookies = parseCookies(headers.cookie);
  const host = headers.host || '';
  const available = authAvailable();
  /**
   * 读当前会话，供「必须登录」的写接口复用。
   * 读库失败不能伪装成未登录（前端要能把「掉登录」和「服务挂了」区分开），所以返回 failure 让调用方直接发出去。
   * @returns {Promise<{session?: object|null, failure?: object}>} 二选一。
   */
  async function currentSession(){
    try{
      return {session: await readSession(cookies[SESSION_COOKIE])};
    }
    catch(error){
      console.error('[api] 读取会话失败：', error.message);
      return {failure: responseJson(503, {error: 'unavailable'})};
    }
  }
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
    const setCookies = [];
    if(!cookies[CSRF_COOKIE])
      setCookies.push(setCookie(CSRF_COOKIE, csrf, {httpOnly: false, maxAge: sessionCookieMaxAge(), host}));
    // 标记和真实会话对不上（在别处退出、会话空闲超时）：顺手清掉，下一页立刻回到「登录」形态。
    if(!session?.user && cookies[UI_COOKIE])
      setCookies.push(uiCookie('', host, 0));
    // 反过来：会话有效但标记缺失或不是当前用户（上线前就存在的会话、换了账号）——按当前会话补一份，
    // 这样这些人的下一页起也是首帧正确，不需要重新登录。
    if(session?.user && cookies[UI_COOKIE] !== String(session.user.id))
      setCookies.push(uiCookie(session.user.id, host, sessionCookieMaxAge()));
    if(setCookies.length)
      response.headers['set-cookie'] = setCookies;
    return response;
  }
  // 其余带cookie请求
  if(!['/api/auth/email-captcha', '/api/auth/verify', '/api/auth/login', '/api/auth/logout', '/api/profile', '/api/profile/init', '/api/profile/password'].includes(pathname))
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
        setCookie(CSRF_COOKIE, '', {maxAge: 0, httpOnly: false, host}),
        uiCookie('', host, 0)
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
        'set-cookie': [
          setCookie(SESSION_COOKIE, result.token, {maxAge: sessionCookieMaxAge(), host}),
          uiCookie(result.user.id, host, sessionCookieMaxAge())
        ]
      });
    }
    // 个人资料两个入口，各自对应一个函数：
    //   /api/profile       日常编辑（昵称 / 简介），**不收密码**
    //   /api/profile/init  首次补全（昵称 + 一次性密码 + 简介）
    if(pathname === '/api/profile' || pathname === '/api/profile/init'){
      const {session, failure} = await currentSession();
      if(failure)
        return failure;
      if(!session)
        return responseJson(401, {error: 'unauthenticated'});
      const write = pathname === '/api/profile/init'? initProfile: updateProfile;
      const user = await write({
        userId: session.user.id,
        current: session.user,
        password: payload.password,
        nickname: payload.nickname,
        bio: payload.bio
      });
      return responseJson(200, {ok: true, user, missing: missingFields(user)});
    }
    // 修改密码：旧密码 + 两遍新密码。改完这个账号的全部会话都作废（三块cookie一并清掉）。
    // 首次设置密码不在这里 —— 那是 /api/profile 的活（它只补空密码，不覆盖已有密码）。
    if(pathname === '/api/profile/password'){
      const {session, failure} = await currentSession();
      if(failure)
        return failure;
      if(!session)
        return responseJson(401, {error: 'unauthenticated'});
      await changePassword({
        token: cookies[SESSION_COOKIE],
        currentPassword: payload.currentPassword,
        newPassword: payload.newPassword,
        confirmPassword: payload.confirmPassword
      });
      // 这个账号的全部会话都撤了，客户端只能回登录页；next 指向安全设置那栏，重新登录后能回到原地。
      return responseJson(200, {ok: true, redirect: '/login/?next=' + encodeURIComponent('/profile/?tab=security')}, {
        'set-cookie': [
          setCookie(SESSION_COOKIE, '', {maxAge: 0, host}),
          setCookie(CSRF_COOKIE, '', {maxAge: 0, httpOnly: false, host}),
          uiCookie('', host, 0)
        ]
      });
    }
    if(pathname === '/api/auth/verify'){
      const result = await verifyEmailCaptcha({challenge: cookies[CHALLENGE_COOKIE] || '', emailCaptcha: payload.emailCaptcha, userAgent: headers['user-agent'] || ''});
      return responseJson(200, {ok: true, user: result.user, isNew: result.isNew, missing: missingFields(result.user), redirect: landing(result.user, payload.next)}, {
        'set-cookie': [
          setCookie(SESSION_COOKIE, result.token, {maxAge: sessionCookieMaxAge(), host}),
          // 码已消费，挑战 cookie 立刻失效，免得同一枚码在另一个标签页里再被尝试。
          setCookie(CHALLENGE_COOKIE, '', {maxAge: 0, host}),
          uiCookie(result.user.id, host, sessionCookieMaxAge())
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

/**
 * `/api/*` 的唯一入口：按 URL 空间分派给具体实现。
 *
 * 顺序有意义 —— 头像占三条路径（自己的 `/api/profile/avatar`、别人的 `/api/users/<id>/avatar`
 * 与 `/api/users/<id>/avatar/full`），论坛是 `/api/forum/` 前缀；剩下的一律交给认证接口，
 * 由它自己把未知路径回成 404。页面层（app.mjs）只要认「以 /api/ 开头」这一件事，不用知道 API 内部怎么分。
 * @param {object} request 请求描述。
 * @param {string} request.method HTTP 方法。
 * @param {string} request.url 原始 URL（论坛接口要读查询串）。
 * @param {string} request.pathname 已解码的路径。
 * @param {object} request.headers 请求头。
 * @param {string|Buffer|null} [request.body] 原始请求体。
 * @param {string} [request.ip] 来源 IP（由传输层给出，不读自定义头）。
 * @returns {Promise<{status: number, headers: object, body: Buffer}>} 响应描述。
 */
export async function handleApiRequest({method, url, pathname, headers, body = null, ip = ''}){
  if(pathname==='/api/profile/avatar'||/^\/api\/users\/[^/]+\/avatar(\/full)?$/.test(pathname))
    return handleAvatarApi({method, pathname, headers, body});
  if(pathname.startsWith('/api/forum/'))
    return handleForumApi({method, url, headers, body, ip});
  return handleAuthApi({method, pathname, headers, body, ip});
}
