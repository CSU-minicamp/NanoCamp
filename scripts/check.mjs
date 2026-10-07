import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routePaths } from '../src/pages.mjs';
import { site } from '../content/site.mjs';

const output = fileURLToPath(new URL('../dist/', import.meta.url));
const origin = new URL(site.url).origin;
const pages = new Map();
const titles = new Set();
const descriptions = new Set();
const assets = new Set();
let anchors = 0;
const require = (condition, message) => { if (!condition) throw new Error(message); };
const decode = value => value.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, entity => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&apos;':"'"}[entity]));
function localFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const file = path.resolve(output, '.' + decoded + (decoded.endsWith('/') ? 'index.html' : ''));
  require(file.startsWith(path.resolve(output) + path.sep), 'Resource escapes build directory: ' + pathname);
  return file;
}
const tags = (html, name) => [...html.matchAll(new RegExp('<'+name+'\\b[^>]*>', 'gi'))].map(match=>match[0]);
const attr = (tag, name) => decode(tag.match(new RegExp('(?:^|\\s)'+name+'="([^"]*)"', 'i'))?.[1] || '');
const meta = (html, name) => tags(html,'meta').find(tag=>attr(tag,'name')===name || attr(tag,'property')===name);
for (const route of [...routePaths,'/404.html']) {
  const html = await readFile(localFile(route), 'utf8');
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
  const file = localFile(url.pathname);
  if (!assets.has(file)) { await access(file); assets.add(file); }
  if (url.hash) {
    const target = pages.get(url.pathname);
    require(target, route + ': fragment target is not a known page: ' + href);
    require(target.ids.has(decodeURIComponent(url.hash.slice(1))), route + ': missing target for ' + href);
    anchors++;
  }
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
const sitemap = await readFile(path.join(output,'sitemap.xml'),'utf8');
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>decode(match[1]));
const expected = routePaths.filter(route=>route!=='/search/').map(route=>new URL(route,site.url).href);
require(locations.length===expected.length && new Set(locations).size===expected.length && expected.every(url=>locations.includes(url)), 'Sitemap does not match indexable pages');
const robots = await readFile(path.join(output,'robots.txt'),'utf8');
require(robots.includes('Sitemap: '+new URL('/sitemap.xml',site.url).href), 'Robots sitemap URL is incorrect');
const png = await readFile(path.join(output,'images/nanocamp-social.png'));
require(png.toString('hex',0,8)==='89504e470d0a1a0a' && png.readUInt32BE(16)===1200 && png.readUInt32BE(20)===630, 'Share image must be a valid 1200 × 630 PNG');
console.log(`PASS: ${routePaths.length} pages + 404, ${assets.size} local files, ${anchors} anchor links, ${index.length} search records, canonical/social metadata, JSON, sitemap and share image.`);