// 认证接口层。
//
// 本版本的状态：**发验证码可用，登录不可用**。
//   GET  /api/session        → 200 {user: null, disabled: true, canSendCode: true}
//   POST /api/auth/code      → 真发一封验证码邮件（不依赖存储）
//   POST /api/auth/verify    → 503（校验要把挑战存起来，等数据库）
//   POST /api/auth/login     → 503（同上）
//   POST /api/auth/logout    → 503（没有会话可撤）
//
// 因为这一版没有任何会话凭证，CSRF 令牌那套暂时不存在；但 POST 仍然要求同源 Origin，
// 免得别人在你的页面上偷偷触发发信。
import {AuthError, requestCode} from './auth.mjs';

/** 请求体上限：发码只需要一个邮箱字段，超过 16 KB 一律拒绝。 */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * 同源校验：POST 必须带 Origin，且主机与请求的 Host 一致。
 * 只比主机不比协议，因为同一台机器上 http/https 都可能出现，比协议只会误伤本机调试。
 * @param {object} headers 请求头。
 * @returns {boolean} 是否同源。
 */
function sameOrigin(headers){
  const source = headers.origin || headers.referer;
  if(!source) return false;
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
  const text = Buffer.isBuffer(body) ? body.toString('utf8'): String(body ?? '');
  if(!text || text.length > MAX_BODY_BYTES) return null;
  try{
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed: null;
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
const errorStatus = {invalid_email: 400, rate_limited: 429, mail_failed: 502, not_implemented: 503};

/**
 * 需要存储才能完成的接口：本版本只回 503。
 *
 * ⚠️ 接上 verify / login 时，这里必须补回服务端回跳校验（只接受站内路径）：
 * 客户端 public/auth.js 的 safeTarget() 只能拦住正常浏览器，服务端必须再判一次。
 */
const pendingEndpoints = new Set(['/api/auth/verify', '/api/auth/login', '/api/auth/logout']);

/**
 * 处理 /api/* 请求。
 * @param {object} request 请求描述。
 * @param {string} request.method HTTP 方法。
 * @param {string} request.pathname 已解码的路径。
 * @param {object} request.headers 请求头。
 * @param {string|Buffer|null} [request.body] 原始请求体。
 * @returns {Promise<{status: number, headers: object, body: Buffer}>} 响应描述。
 */
export async function handleApi({method, pathname, headers, body = null}){
  if(pathname === '/api/session'){
    if(method !== 'GET')
      return responseJson(405, {error: 'method_not_allowed'}, {allow: 'GET'});
    // disabled 是「登录不可用」，canSendCode 是「发码可用」—— 两件事分开说，前端才能既明确提示、又不把发码按钮一起锁死。
    return responseJson(200, {user: null, disabled: true, canSendCode: true});
  }
  if(pathname === '/api/auth/code'){
    if(method !== 'POST')
      return responseJson(405, {error: 'method_not_allowed'}, {allow: 'POST'});
    if(!sameOrigin(headers))
      return responseJson(403, {error: 'forbidden'});
    const payload = readJson(body);
    if(!payload)
      return responseJson(400, {error: 'invalid_body'});
    try{
      const result = await requestCode({email: payload.email});
      return responseJson(200, {ok: true, provider: result.provider, retryAfter: result.retryAfter, canVerify: result.canVerify});
    }
    catch(error){
      if(!(error instanceof AuthError))
        throw error;
      const extra = error.retryAfter? {'retry-after': String(error.retryAfter)}: {};
      return responseJson(errorStatus[error.code] || 400, {error: error.code, retryAfter: error.retryAfter || undefined}, extra);
    }
  }
  if(pendingEndpoints.has(pathname)){
    if(method !== 'POST')
      return responseJson(405, {error: 'method_not_allowed'}, {allow: 'POST'});
    return responseJson(503, {error: 'auth_unavailable'});
  }
  return responseJson(404, {error: 'not_found'});
}
