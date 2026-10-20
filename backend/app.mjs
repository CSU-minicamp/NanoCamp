// NanoCamp 后端：在**请求到达时**渲染 HTML
//
// 视图层不动：src/ 里的页面函数本来就返回完整 HTML 字符串，这里每次请求调用一次。
// 所以本文件只做三件事：解析地址、挑选渲染函数、组装响应。
//
// 路由分三类：dynamicRoutes（按路由缓存）、sessionRoutes（每人一份，不缓存）、textRoutes（现场派生的文件）。
// 本文件不读配置、不碰端口，也没有任何模块级副作用：监听地址与端口在 backend/main.mjs里读 data/config.json。
// 因此这里导出的 handleRequest 可以直接被单测调用。

import {createHash} from 'node:crypto';

import {types, readAsset, escapeHtml} from './base.mjs';
import {handleApi, parseCookies, safeNext} from './api.mjs';
import {readSession, missingFields} from './auth.mjs';
import {renderProfile, renderProfileForce} from '../src/profile.mjs';
import {routePaths, indexablePaths, renderPage, renderNotFound, renderUnauthorized} from '../src/pages.mjs';
import {renderIntroPage} from '../src/intro.mjs';
import {canonicalUrl} from '../src/metadata.mjs';
import {guides} from '../content/guides.mjs';

/**
 * 全站唯一的缓存策略：一律 no-cache。
 * 浏览器每次都会回源校验，内容没变就命中 ETag 的 304；因此既不会出现陈旧页面，也不需要按环境切换成另一套规则（少一个开关）。
 */
const cacheControl = 'no-cache';

// ======================= 路由表 =======================

/**
 * 请求期渲染的路由表：键是路由路径，值是「无参返回完整 HTML 字符串」的函数。
 *
 * 全部站点页面都由 src/pages.mjs 的 renderPage 渲染，所以这里直接按路由表展开，不重复列一遍路由，新增页面只要写进 src/pages.mjs 就自动生效。
 * 渲染方式与普通页面不同的（如 /intro/，它是首页 iframe 嵌入的海报）单独列在前面。
 */
const dynamicRoutes = new Map([
  ['/intro/', renderIntroPage],
  ...routePaths.map(route => [route, () => renderPage(route)]),
]);

/**
 * 需要读会话的页面：**不能进渲染缓存** —— 同一个 URL 对不同人返回不同内容，缓存下来的第一份会被发给下一个人。
 *
 * 值是「收到请求上下文 → 直接返回响应」的函数，而不是页面字符串：
 * 这类页面要自己读 cookie、自己决定 200 / 303 / 401，返回 HTML 字符串那套抽象不够用。
 */
const sessionRoutes = new Map([
  ['/profile/', {render: renderProfilePage}],
  ['/profile/force/', {render: renderProfileForcePage}]
]);

// ======================= HTTP 细节 =======================

/**
 * 站点级派生文件：键是请求路径，值给出 Content-Type 与一个「现场生成正文」的函数。
 * 这些内容完全由 site.url 与路由表推导，不涉及任何页面渲染，所以不放进 dynamicRoutes。
 * 它们只在请求期现场生成，不落磁盘。
 */
const textRoutes = new Map([
  ['/sitemap.xml', {
    type: types['.xml'],
    render: () => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexablePaths.map(route => `  <url><loc>${escapeHtml(canonicalUrl(route))}</loc></url>`).join('\n')}\n</urlset>\n`,
  }],
  ['/robots.txt', {
    type: types['.txt'],
    render: () => `User-agent: *\nAllow: /\nSitemap: ${canonicalUrl('/sitemap.xml')}\n`,
  }],
  // 自定义错误页文件本身：按惯例以 200 返回，页面自带 noindex。
  ['/404.html', {
    type: types['.html'],
    render: () => renderNotFound(),
  }],
  // 401 页同样落一份文件版（nginx 可以直接 `error_page 401 /401.html`）。
  ['/401.html', {
    type: types['.html'],
    render: () => renderUnauthorized(),
  }],
  // 指南的空白模板下载：正文本来就存在 content/guides.mjs 的 template 字段里，由请求期现场生成，不落磁盘。
  ...guides.map(guide => [`/downloads/${guide.slug}-template.txt`, {
    type: types['.txt'],
    render: () => `\uFEFF${guide.template}\n\nNanoCamp 共创指南\n`,
  }]),
]);

/**
 * 渲染结果缓存：键是路由，值是渲染好的 Buffer。
 *
 * 页面内容在进程生命周期内是固定的 —— 没有任何运行时写入路径，只有重新部署（git pull + 重启）才会变。
 * 所以同一个路由渲染一次就能一直复用，**不需要任何失效逻辑**：改内容必然会重启进程，缓存自然清空。
 * 按需填充，只有真的被请求过的页面才占内存；全站 35 个路由全渲染一遍也只有约 0.8 MB。
 */
const rendered = new Map();

/**
 * 取某个路由渲染好的 Buffer：第一次请求时渲染，之后直接复用。
 * @param {string} route 路由路径，同时作为缓存键。
 * @param {() => string} render 无参返回完整内容字符串的函数。
 * @returns {Buffer} 缓存中的内容。
 */
function renderOnce(route, render){
  if(!rendered.has(route))  // 用 has 而不是判空，避免把空字符串当成「没渲染过」
    rendered.set(route, Buffer.from(render(), 'utf8'));
  return rendered.get(route);
}

/**
 * 组装一个响应对象，并统一处理缓存与条件请求。
 *
 * 做法是给每个响应的字节内容算一次 sha1 当作强 ETag；如果请求头里的 if-none-match 与它相等，就直接回 304 且不带正文
 * （这是「一律 no-cache」不会造成重复传输的原因）
 *
 * @param {string|Buffer} body 响应正文。
 * @param {object} options 响应选项。
 * @param {string} options.type Content-Type。
 * @param {number} [options.status=200] HTTP 状态码。
 * @param {string} [options.source='dynamic'] 写入 x-nanocamp-source，标明内容来源。
 * @param {object} [requestHeaders={}] 原始请求头，用于读取 if-none-match。
 * @returns {{status: number, headers: object, body: Buffer}} 与具体 HTTP 服务器解耦的响应描述。
 */
function send(body, {type, status = 200, source = 'dynamic'}, requestHeaders = {}){
  const buffer = Buffer.isBuffer(body)? body: Buffer.from(body, 'utf8');
  const etag = `"${createHash('sha1').update(buffer).digest('base64url').slice(0, 22)}"`;
  const base = {
    'content-type': type,
    'cache-control': cacheControl,
    etag,
    'x-content-type-options': 'nosniff',
    'x-nanocamp-source': source,
  };
  if(requestHeaders['if-none-match'] === etag)
    return {status: 304, headers: base, body: Buffer.alloc(0)};
  return {status, headers: {...base, 'content-length': String(buffer.byteLength)}, body: buffer};
}

/**
 * 私人页面/401 的响应：**no-store**，不带 ETag。
 * @param {string|Buffer} body 正文。
 * @param {number} status 状态码。
 * @param {string} [type] Content-Type。
 * @returns {{status: number, headers: object, body: Buffer}} 响应描述。
 */
function sendPrivate(body, status, type = types['.html']){
  const buffer = Buffer.isBuffer(body)? body: Buffer.from(body, 'utf8');
  return {
    status,
    headers: {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-nanocamp-source': 'dynamic',
      'content-length': String(buffer.byteLength)
    },
    body: buffer
  };
}

/** 303：把 POST/GET 都引导到新地址，且不改变请求方法语义（补全资料后回跳用它）。 */
function redirectSeeOther(location){
  return {
    status: 303,
    headers: {location, 'content-type': types['.txt'], 'cache-control': 'no-store', 'x-nanocamp-source': 'redirect'},
    body: Buffer.from('See Other\n', 'utf8'),
  };
}

/**
 * /profile/：读出会话 → 决定是「去登录」「去补全」还是「渲染资料」。
 *
 * 每次请求现算（不进缓存），响应明确 no-store。
 * @param {object} context 请求上下文。
 * @param {object} context.headers 请求头（用它取会话 cookie）。
 * @returns {Promise<object>} 响应描述。
 */
async function renderProfilePage({headers}){
  let session = null;
  try{
    session = await readSession(parseCookies(headers.cookie || '').nc_sid || '');
  }
  catch(error){
    console.error('[profile] 读取会话失败：', error.message);
    return sendPrivate('账号系统暂时不可用，请稍后再试。\n', 503, types['.txt']);
  }
  // 没登录直接去登录页，并带上回来要去的地址。
  if(!session)
    return redirectSeeOther(`/login/?next=${encodeURIComponent('/profile/')}`);
  // 资料没补全则先去补，补完回这里。
  if(missingFields(session.user).length)
    return redirectSeeOther(`/profile/force/?next=${encodeURIComponent('/profile/')}`);
  return sendPrivate(renderProfile(session.user), 200);
}

/**
 * /profile/force/：补全必填项。
 *
 * 服务端就要把三种情况分开，而不是先给一张表单再让 JS 去跳：
 *   没登录        → 303 去登录页（带回跳地址）
 *   已经不缺字段  → 303 回 next 或 /profile/（别让人填一个已经填过的东西）
 *   缺一部分      → 200，只把 missing 里那几项标成必填
 *
 * @param {object} context 请求上下文。
 * @param {object} context.headers 请求头。
 * @returns {Promise<object>} 响应描述。
 */
async function renderProfileForcePage({headers, url = '/'}){
  let session = null;
  try{
    session = await readSession(parseCookies(headers.cookie || '').nc_sid || '');
  }
  catch(error){
    console.error('[profile] 读取会话失败：', error.message);
    return sendPrivate('账号系统暂时不可用，请稍后再试。\n', 503, types['.txt']);
  }
  // 把「补完要去哪」一路带着：登录 → 补全 → 原目标，中间任何一步都不丢。
  const target = safeNext(new URL(url, 'http://localhost').searchParams.get('next')) || '/profile/';
  if(!session)
    return redirectSeeOther(`/login/?next=${encodeURIComponent(`/profile/force/?next=${encodeURIComponent(target)}`)}`);
  const missing = missingFields(session.user);
  if(!missing.length)
    return redirectSeeOther(target);
  return sendPrivate(renderProfileForce(missing, session.user), 200);
}

/**
 * 生成 301 跳转响应，用于给目录式地址补上结尾斜杠。
 * @param {string} location 目标地址，例如 '/about/'。
 * @returns {{status: number, headers: object, body: Buffer}} 响应描述。
 */
function redirect(location){
  return {
    status: 301,
    headers: {location, 'content-type': types['.txt'], 'cache-control': cacheControl, 'x-nanocamp-source': 'redirect'},
    body: Buffer.from('Moved Permanently\n', 'utf8'),
  };
}

/**
 * 处理一次请求，是服务端的唯一入口。
 *
 * 依次尝试：站点级派生文件 → 页面 → 目录补斜杠 → public/ 静态资源 → 404。所有页面都在请求期渲染，404 就是地址确实不存在。
 *
 * @param {object} [request] 请求对象。可以是 http.IncomingMessage，也可以是任意具备 method / url / headers 的对象，便于单测直接构造。
 * @param {string} [request.method='GET'] HTTP 方法。页面只接受 GET / HEAD；/api/* 另收 POST。
 * @param {string} [request.url='/'] 请求地址，可含查询串（会被忽略）。
 * @param {object} [request.headers={}] 请求头。
 * @param {string|Buffer|null} [request.body=null] 原始请求体，仅 /api/* 的 POST 需要。
 * @param {string} [request.ip=''] 来源地址，由传输层给出（不读请求头，避免被自有头绕过限流）。
 * @returns {Promise<{status: number, headers: object, body: Buffer}>} 响应描述。405 方法不允许、400 地址无法解码、301 补斜杠、200 命中内容、404 兜底。
 */
export async function handleRequest({method = 'GET', url = '/', headers = {}, body = null, ip = ''} = {}){
  // 解析地址
  let pathname;
  try{
    // 切掉查询串与片段后显式拼到固定 base 上，让它只按路径解析；'..' 与 '%2e%2e' 仍由URL解析器负责归一化，'%2F' 依旧不会被还原成分隔符。
    const target = url.split(/[?#]/)[0] || '/';
    const absolute = /^\//.test(target)? 'http://localhost' + target: target;
    pathname = decodeURI(new URL(absolute, 'http://localhost').pathname);
  }
  catch{
    // 非法的百分号编码
    return send('请求地址无法解析。\n', {type: types['.txt'], status: 400}, headers);
  }
  // 认证接口先分流：它要收 POST，而且响应与具体浏览器有关
  if(pathname.startsWith('/api/'))
    return handleApi({method, pathname, headers, body, ip});
  // 其他页面一律只读
  if(method !== 'GET' && method !== 'HEAD'){
    return {
      status: 405,
      headers: {'content-type': types['.txt'], allow: 'GET, HEAD', 'x-nanocamp-source': 'dynamic'},
      body: Buffer.from('Method Not Allowed\n', 'utf8'),
    };
  }
  /** 验证route安全性 */
  function safeRoute(route){
    for(const seg of route.split('/')){  // 拆段
      if(seg.includes('\0'))  // 拒绝空字节
        return false;
      if(seg === '..' || seg === '.')  // 拒绝'..'段
        return false;  //（'..' 已在 URL 解析阶段处理过未编码的，这里只挡解码后冒出来的）
      if(seg.includes('\\'))  // 如果这些段后面要落文件系统，再拒绝包含 '\' 的段
        return false;
    }
    return true;
  }
  if(!safeRoute(pathname))
    return send('请求地址非法。\n', { type: types['.txt'], status: 400 }, headers);
  const route = pathname.endsWith('/index.html')? pathname.slice(0, -'index.html'.length): pathname;

  // 会话相关页面：自己读 cookie、自己决定状态码，所以既不走缓存也不进 dynamicRoutes。
  const sessionRoute = sessionRoutes.get(route);
  if(sessionRoute)
    return sessionRoute.render({method, url, headers, ip});
  // 站点级派生文件（sitemap / robots / 404）
  const text = textRoutes.get(route);
  if(text)
    return send(renderOnce(route, text.render), {type: text.type, status: 200, source: 'dynamic'}, headers);
  // 请求期渲染的页面
  const page = dynamicRoutes.get(route);
  if(page)
    return send(renderOnce(route, page), {type: types['.html'], status: 200, source: 'dynamic'}, headers);
  // 目录式地址补斜杠301跳转（/about → /about/）
  if(!route.endsWith('/') && (dynamicRoutes.has(route + '/') || sessionRoutes.has(route + '/')))
    return redirect(route + '/');
  // public/ 下的静态资源
  const asset = await readAsset(route);
  if(asset)
    return send(asset.body, {type: asset.type, status: 200, source: 'asset'}, headers);
  // 以上都不命中，就是地址确实不存在
  return send(renderOnce('/404.html', renderNotFound), {type: types['.html'], status: 404, source: 'notfound'}, headers);
}

/**
 * 路由规模快照，供启动日志与 scripts/check.mjs 使用。
 * @type {{pages: number, derived: string[]}} pages 是请求期渲染的页面数；derived 是不落磁盘、由请求期现场生成的路径。
 */
export const routeInfo = {
  pages: dynamicRoutes.size,
  derived: [...textRoutes.keys()],
};
