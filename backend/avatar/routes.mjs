// 头像的 HTTP 边界：路由、状态码、缓存头。业务（表结构 / 存储 / 图片管线）全在 ./index.mjs。
//
// 三个入口：
//   GET  /api/users/<id>/avatar        公开读**缩略图**（256×256 webp）：没设过头像 302 到默认图，设了就带 ETag 吐字节
//   GET  /api/users/<id>/avatar/full   公开读**原图**（原样存的那份，灯箱用），共用一个 ETag
//   GET  /api/profile/avatar           读自己的元信息（前端据此决定画不画「上传」按钮）
//   PUT / DELETE /api/profile/avatar   换 / 清自己的头像（同源 + CSRF + 资料完整）
//
// 公开读图不带会话，所以它的缓存策略与私人接口不同 —— 图片本身可以 no-cache + 304，JSON 一律 no-store。
import {readSession, missingFields, authAvailable} from '../auth.mjs';
import {parseCookies, sameOrigin} from '../base.mjs';
import {dbReady, isUnavailable} from '../db.mjs';

import {AvatarError, DEFAULT_AVATAR_URL, avatarMetadata, avatarResult, readAvatar, removeAvatar, replaceAvatar} from './index.mjs';

/**
 * 拼一个 JSON 响应。头像接口的响应都不该被缓存（除了图片本身，那个单独设头）。
 * @param {number} status 状态码。
 * @param {object} data 响应体。
 * @returns {object} 响应描述。
 */
const json = (status, data) => ({
  status,
  headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'},
  body: Buffer.from(JSON.stringify(data))
});

/**
 * 头像接口。
 * @param {object} request 请求描述。
 * @param {string} request.method HTTP 方法。
 * @param {string} request.pathname 已解码的路径。
 * @param {object} request.headers 请求头。
 * @param {string|Buffer|null} [request.body] 原始请求体（PUT 时是图片字节）。
 * @returns {Promise<object>} 响应描述。
 */
export async function handleAvatarApi({method, pathname, headers, body}){
  try{
    if(!dbReady())
      return json(503, {error: 'avatar_unavailable'});
    // --- 公开读图：不带会话也能看，所以缓存策略与私人接口不同 ---
    // /avatar 是缩略图（列表用），/avatar/full 是原图（灯箱用）；两者共用一个 etag。
    const publicMatch = pathname.match(/^\/api\/users\/([1-9]\d{0,14})\/avatar(\/full)?$/);
    if(publicMatch){
      if(!['GET', 'HEAD'].includes(method))
        return {...json(405, {error: 'method_not_allowed'}), headers: {...json(405, {}).headers, allow: 'GET, HEAD'}};
      const full = Boolean(publicMatch[2]);
      // 先只读users中的头像引用，null 跳转至默认头像，etag 命中就直接304。
      const meta = await avatarMetadata(publicMatch[1]);
      if(!meta)
        return {status: 302, headers: {location: DEFAULT_AVATAR_URL, 'cache-control': 'no-store'}, body: Buffer.alloc(0)};
      const etag = `"${meta.etag}"`;
      // 头像内容只在换图时变，etag 就是内容哈希，所以可以用 no-cache + 304 省流量。
      // 304 上不带 content-type 是对的：缓存里的那份已经带着，RFC 9110 只要求校验相关的头。
      const validators = {etag, 'cache-control': 'public, no-cache', 'x-content-type-options': 'nosniff'};
      if(headers['if-none-match']?.split(',').map(value => value.trim()).includes(etag))
        return {status: 304, headers: validators, body: Buffer.alloc(0)};
      const image = await readAvatar(publicMatch[1], meta, full);
      if(!image)
        return {status: 302, headers: {location: DEFAULT_AVATAR_URL, 'cache-control': 'no-store'}, body: Buffer.alloc(0)};
      // 万一这次读碰到「引用刚被换掉」，readAvatar 会重读引用；这时必须用**新的** etag，不能沿用上面那个。
      const responseHeaders = {...validators, etag: `"${image.meta.etag}"`, 'content-type': image.contentType, 'content-disposition': 'inline'};
      return {status: 200, headers: {...responseHeaders, 'content-length': String(image.bytes.length)}, body: method === 'HEAD'? Buffer.alloc(0): image.bytes};
    }
    if(pathname !== '/api/profile/avatar')
      return json(404, {error: 'not_found'});
    // --- 自己的头像：要登录 ---
    if(!authAvailable())
      return json(503, {error: 'avatar_unavailable'});
    if(!['GET', 'PUT', 'DELETE'].includes(method))
      return {...json(405, {error: 'method_not_allowed'}), headers: {...json(405, {}).headers, allow: 'GET, PUT, DELETE'}};
    const cookies = parseCookies(headers.cookie);
    const session = await readSession(cookies.nc_sid);
    if(!session)
      return json(401, {error: 'unauthenticated'});
    if(method === 'GET')
      return json(200, avatarResult(session.user.id, await avatarMetadata(session.user.id)));
    // 写操作两道闸：同源 + double-submit 令牌；再加一条「资料必须先补全」（没昵称的人不该先换头像）。
    if(!sameOrigin(headers) || !cookies.nc_csrf || headers['x-nc-csrf'] !== cookies.nc_csrf)
      return json(403, {error: 'csrf_invalid'});
    if(missingFields(session.user).length)
      return json(403, {error: 'profile_incomplete'});
    return json(200, method === 'PUT'? await replaceAvatar(session.user.id, body, headers['content-type']): await removeAvatar(session.user.id));
  }
  catch(error){
    if(error instanceof AvatarError)
      return json(error.status, {error: error.code});
    console.error('[avatar:api]', method, pathname, error.code || '', error.message);
    // 表还没建（ER_NO_SUCH_TABLE）也算「暂时不可用」：部署顺序可能先起服务后跑迁移。
    return json(isUnavailable(error) || error.code === 'ER_NO_SUCH_TABLE'? 503: 500, {error: 'avatar_unavailable'});
  }
}
