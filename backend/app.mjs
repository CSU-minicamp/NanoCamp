// NanoCamp 后端：在**请求到达时**渲染 HTML，取代「构建期生成 dist/ 静态文件」。
//
// 视图层不动：src/ 里的页面函数本来就返回完整 HTML 字符串，以前被构建脚本调用一次，
// 现在改成每次请求调用一次。所以本文件只做三件事：解析地址、挑选渲染函数、组装响应。
//
// 本文件不读配置、不碰端口，也没有任何模块级副作用：监听地址与端口在 backend/main.mjs里读 data/config.json。
// 因此这里导出的 handleRequest 可以直接被单测调用。

import {createHash} from 'node:crypto';

import {types, readAsset} from './base.mjs';
import {routePaths, renderPage, renderNotFound} from '../src/pages.mjs';
import {renderIntroPage} from '../src/intro.mjs';
import {canonicalUrl} from '../src/metadata.mjs';
import {guides} from '../content/guides.mjs';

/**
 * 全站唯一的缓存策略：一律 no-cache。
 * 浏览器每次都会回源校验，内容没变就命中 ETag 的 304；因此既不会出现陈旧页面，也不需要按环境切换成另一套规则（少一个开关）。
 */
const cacheControl = 'no-cache';

// ======================= 动态路由表（迁移进度） =======================

/**
 * 已迁移的普通页面：首页、7 个栏目、4 篇共创指南，以及作品区的列表页与全部详情页。
 * 它们都由 src/pages.mjs 的 renderPage 统一渲染，所以这里只列路由，不重复写渲染函数。
 */
const pageRoutes = [
  '/',
  '/about/',
  '/activities/',
  '/community/',
  '/faq/',
  '/minicamp/',
  '/partners/',
  '/resources/',
  '/resources/from-idea-to-demo/',
  '/resources/find-your-team/',
  '/resources/demo-story/',
  '/resources/host-a-sharing/',
  // 作品详情页的数量随内容增长，所以按前缀从路由表里取，不在这里手写；新增作品自动生效。
  ...routePaths.filter(route => route.startsWith('/projects/')),
];

/**
 * 已迁移到请求期渲染的路由：键是路由路径，值是「零参数、返回完整 HTML 字符串」的函数。
 *
 * 每迁移一个页面就在这里加一行即可 —— 动态路由优先级高于其他分支，加完不需要改动别处。未列在这里的路由会走到 404 分支（见 pendingRoutes）。
 */
const dynamicRoutes = new Map([
  ['/intro/', renderIntroPage],  // 首页首屏海报：首页用 iframe 嵌入它，渲染方式与普通页面不同，所以单独列出。
  ...pageRoutes.map(route => [route, () => renderPage(route)]),
]);

/** 还没迁移、因此会返回 404 的站点路由，响应头会标记为 unmigrated，以便和「地址确实不存在」区分开；启动日志也会列出这份清单。*/
export const pendingRoutes = routePaths.filter(route => !dynamicRoutes.has(route));

/** pendingRoutes 的 Set 形式，供 handleRequest 做 O(1) 判定。 */
const pending = new Set(pendingRoutes);

// ======================= HTTP 细节 =======================

/**
 * 转义 XML 文本节点与属性里的特殊字符（sitemap 用）。
 * @param {unknown} value 待转义的值，会先转成字符串。
 * @returns {string} 转义后的字符串。
 */
const xml = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[char]));

/**
 * 站点级派生文件：键是请求路径，值给出 Content-Type 与一个「现场生成正文」的函数。
 * 这些内容完全由 site.url 与路由表推导，不涉及任何页面渲染，所以不放进 dynamicRoutes。
 * 旧流程把它们在构建期写进 dist/，现在改成请求时现算。
 */
const textRoutes = new Map([
  ['/sitemap.xml', {
    type: types['.xml'],
    render: () => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routePaths.filter(route => route !== '/search/').map(route => `  <url><loc>${xml(canonicalUrl(route))}</loc></url>`).join('\n')}\n</urlset>\n`,
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
  // 指南的空白模板下载：正文本来就存在 content/guides.mjs 的 template 字段里，
  // 以前由 scripts/build.mjs 写进 dist/downloads/，现在改成请求时现算，不再落磁盘。
  ...guides.map(guide => [`/downloads/${guide.slug}-template.txt`, {
    type: types['.txt'],
    render: () => `\uFEFF${guide.template}\n\nNanoCamp 共创指南\n`,
  }]),
]);

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
 * 依次尝试：动态页面 → 站点级派生文件 → 目录补斜杠 → public/ 静态资源 → 404。
 * 不查 dist/：未迁移的页面与不存在的地址都回 404，只用响应头 x-nanocamp-source（unmigrated / notfound）区分「还没做」与「真的没有」。
 *
 * @param {object} [request] 请求对象。可以是 http.IncomingMessage，也可以是任意具备 method / url / headers 的对象，便于单测直接构造。
 * @param {string} [request.method='GET'] HTTP 方法，只支持 GET 与 HEAD。
 * @param {string} [request.url='/'] 请求地址，可含查询串（会被忽略）。
 * @param {object} [request.headers={}] 请求头。
 * @returns {Promise<{status: number, headers: object, body: Buffer}>} 响应描述。405 方法不允许、400 地址无法解码、301 补斜杠、200 命中内容、404 兜底。
 */
export async function handleRequest({method = 'GET', url = '/', headers = {}} = {}){
  // 筛选有效请求
  if(method !== 'GET' && method !== 'HEAD'){
    return {
      status: 405,
      headers: {'content-type': types['.txt'], allow: 'GET, HEAD', 'x-nanocamp-source': 'dynamic'},
      body: Buffer.from('Method Not Allowed\n', 'utf8'),
    };
  }
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

  // 站点级派生文件（sitemap / robots / 404）
  const text = textRoutes.get(route);
  if(text)
    return send(text.render(), {type: text.type, status: 200, source: 'dynamic'}, headers);
  // 请求期渲染的页面（首页、栏目、共创指南、作品列表与详情）
  const page = dynamicRoutes.get(route);
  if(page)
    return send(page(), {type: types['.html'], status: 200, source: 'dynamic'}, headers);
  // 目录式地址补斜杠301跳转（/about → /about/）
  if(route !== '/' && !route.endsWith('/') && dynamicRoutes.has(route + '/'))
    return redirect(route + '/');
  // public/ 下的静态资源
  const asset = await readAsset(route);
  if(asset)
    return send(asset.body, {type: asset.type, status: 200, source: 'asset'}, headers);
  // 未迁移的页面与不存在的地址都返回站点 404，两者用响应头区分，便于一眼看出「是还没做」还是「真的没有」。
  const unmigrated = pending.has(route) || pending.has(route + '/');
  return send(renderNotFound(), {type: types['.html'], status: 404, source: unmigrated? 'unmigrated': 'notfound'}, headers);
}

/**
 * 迁移进度快照，供启动日志与排查使用。
 * @type {{migrated: string[], pending: string[], text: string[]}}
 *   migrated 是已改为请求期渲染的页面路由；pending 是仍会返回 404 的路由；text 是不落磁盘的派生文件。
 */
export const routeInfo = {
  migrated: [...dynamicRoutes.keys()],
  pending: pendingRoutes,
  text: [...textRoutes.keys()],
};
