// 站点完整性自检：标题/描述唯一、锚点可解析、链接可达、元信息、JSON、sitemap、分享图。
//
// 站点全部在请求期渲染，所以这里也全部走服务器：
//   - 已迁移到请求期渲染的路由 → 取服务器实际会返回的 HTML（与线上完全一致）
//   - 还没迁移的路由           → 直接用渲染函数产出 HTML（迁移后会走上面那条，内容相同）
// 页面与派生文件都不落磁盘，因此这个脚本不依赖任何构建产物。
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleRequest, routeInfo } from '../backend/app.mjs';
import { routePaths, renderPage } from '../src/pages.mjs';
import { renderIntroPage } from '../src/intro.mjs';
import { site } from '../content/site.mjs';

const assetRoot = fileURLToPath(new URL('../public/', import.meta.url));
const origin = new URL(site.url).origin;
const pages = new Map();
const titles = new Set();
const descriptions = new Set();
const assets = new Set();
let anchors = 0;
const require = (condition, message) => { if (!condition) throw new Error(message); };
const decode = value => value.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, entity => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&apos;':"'"}[entity]));

// 不落磁盘的派生文件（sitemap / robots / 404 / 下载模板），它们只存在于请求期。
const derived = new Set(routeInfo.derived);
// /intro/ 是首页 iframe 嵌入的海报页：自带 noindex、没有加入区，也不在 routePaths 里，
// 所以不参与下面的内容校验；但它必须被承认为合法的链接目标。
const specialRoutes = new Set(['/intro/']);

/** 取某个路由最终呈现给用户的 HTML。 */
async function pageHtml(route) {
  const response = await handleRequest({method: 'GET', url: route, headers: {}});
  if (response.status === 200) return response.body.toString('utf8');
  return route === '/intro/'
    ? renderIntroPage()
    : renderPage(route);
}

/** public/ 下的静态资源；越界一律报错。 */
function assetFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const file = path.resolve(assetRoot, '.' + decoded);
  require(file.startsWith(path.resolve(assetRoot) + path.sep), 'Resource escapes public directory: ' + pathname);
  return file;
}

const tags = (html, name) => [...html.matchAll(new RegExp('<'+name+'\\b[^>]*>', 'gi'))].map(match=>match[0]);
const attr = (tag, name) => decode(tag.match(new RegExp('(?:^|\\s)'+name+'="([^"]*)"', 'i'))?.[1] || '');
const meta = (html, name) => tags(html,'meta').find(tag=>attr(tag,'name')===name || attr(tag,'property')===name);

for (const route of [...routePaths,'/404.html']) {
  const html = await pageHtml(route);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match=>decode(match[1]));
  require(new Set(ids).size === ids.length, route + ': duplicate element IDs');
  require((html.match(/<h1[ >]/g) || []).length === 1, route + ': expected one primary heading');
  require(ids.includes('join-dialog'), route + ': join dialog missing');
  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] || '');
  const description = attr(meta(html,'description') || '','content');
  require(title && !titles.has(title), route + ': missing or duplicate title');
  require(description && !descriptions.has(description), route + ': missing or duplicate description');
  titles.add(title); descriptions.add(description);
  if (route !== '/404.html') {
    const canonicals = tags(html,'link').filter(tag=>attr(tag,'rel')==='canonical');
    require(canonicals.length===1 && attr(canonicals[0],'href')===new URL(route,site.url).href, route + ': incorrect canonical URL');
    require(attr(meta(html,'og:url') || '','content')===new URL(route,site.url).href, route + ': incorrect Open Graph URL');
  }
  require(attr(meta(html,'og:image') || '','content')===new URL('/images/nanocamp-social.png',site.url).href, route + ': missing share image');
  require(attr(meta(html,'twitter:card') || '','content')==='summary_large_image', route + ': incorrect social card');
  if (['/search/','/404.html'].includes(route)) require(attr(meta(html,'robots') || '','content').includes('noindex'), route + ': should not be indexed');
  for (const match of html.matchAll(/<script\s+type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/g)) {
    require(!match[1].includes('<'), route + ': unsafe inline JSON');
    JSON.parse(match[1]);
  }
  pages.set(route,{html,ids:new Set(ids)});
}

async function checkLink(href, route) {
  if (!href || /^(?:mailto:|tel:|data:)/i.test(href)) return;
  const url = new URL(href,new URL(route,origin));
  if (url.origin!==origin) return;
  // 页面与请求期派生文件都不落在磁盘上，正文已经单独校验过，这里只看锚点。
  // 目录式地址（例如 /intro 少一个斜杠）由服务器 301 补斜杠，也算可达。
  const direct = pages.get(url.pathname);
  const viaRedirect = url.pathname.endsWith('/')
    ? null
    : pages.get(url.pathname + '/');
  if (direct || viaRedirect) {
    const page = direct;
    if (page && url.hash) {
      require(page.ids.has(decodeURIComponent(url.hash.slice(1))), route + ': missing target for ' + href);
      anchors++;
    }
    return;
  }
  if (derived.has(url.pathname) || (!url.pathname.endsWith('/') && derived.has(url.pathname + '/'))) return;
  if (specialRoutes.has(url.pathname)) return;
  // 其余都应当是 public/ 下的资源。
  const file = assetFile(url.pathname);
  if (!assets.has(file)) { await access(file); assets.add(file); }
}

for (const [route,{html}] of pages) {
  for (const tag of tags(html,'(?:a|link|script|img|iframe)')) {
    const href = attr(tag,'href') || attr(tag,'src');
    if (href) await checkLink(href,route);
  }
}

const searchHTML = pages.get('/search/').html;
const index = JSON.parse(searchHTML.match(/<script type="application\/json" data-search-index>([\s\S]*?)<\/script>/)[1]);
require(index.length>0 && new Set(index.map(record=>record.id)).size===index.length, 'Search records need unique IDs');
for (const record of index) await checkLink(record.href,'/search/');

for (const file of assets) if (file.endsWith('.js')) {
  const js = await readFile(file,'utf8');
  for (const match of js.matchAll(/\bimport\b[^;]*\bfrom\s+['"](\.\.?\/[^'"]+)['"]/g)) await access(path.resolve(path.dirname(file),match[1]));
}

const sitemap = (await handleRequest({method:'GET',url:'/sitemap.xml',headers:{}})).body.toString('utf8');
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>decode(match[1]));
const expected = routePaths.filter(route=>route!=='/search/').map(route=>new URL(route,site.url).href);
require(locations.length===expected.length && new Set(locations).size===expected.length && expected.every(url=>locations.includes(url)), 'Sitemap does not match indexable pages');

const robots = (await handleRequest({method:'GET',url:'/robots.txt',headers:{}})).body.toString('utf8');
require(robots.includes('Sitemap: '+new URL('/sitemap.xml',site.url).href), 'Robots sitemap URL is incorrect');

const png = await readFile(path.join(assetRoot,'images/nanocamp-social.png'));
require(png.toString('hex',0,8)==='89504e470d0a1a0a' && png.readUInt32BE(16)===1200 && png.readUInt32BE(20)===630, 'Share image must be a valid 1200 × 630 PNG');

// 全部站点页面都必须能从服务器直接取到，且响应与渲染函数一致。
// 这条同时兜住「页面写进了 src/pages.mjs 但路由没生效」这类问题 —— 现在路由是按路由表展开的，
// 理论上不会漏，但一旦有人改动路由逻辑，这里会立刻报出来。
for (const route of routePaths) {
  const response = await handleRequest({method:'GET',url:route,headers:{}});
  require(response.status === 200, route + ': 没有返回 200');
  require(response.headers['x-nanocamp-source'] === 'dynamic', route + ': 不是请求期渲染的响应');
  require(response.body.toString('utf8') === await pageHtml(route), route + ': 响应与渲染结果不一致');
}

console.log(`PASS: ${routePaths.length} pages + 404, ${assets.size} local files, ${anchors} anchor links, ${index.length} search records, canonical/social metadata, JSON, sitemap and share image.`);
console.log(`      全部 ${routeInfo.pages} 个路由在请求期渲染，另有 ${derived.size} 个不落磁盘的派生文件。`);
