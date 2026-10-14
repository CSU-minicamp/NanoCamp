import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { handleRequest, pendingRoutes, routeInfo } from '../backend/app.mjs';

const get = url => handleRequest({ method: 'GET', url, headers: {} });

test('首页由请求期渲染生成', async () => {
  const response = await get('/');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(response.headers['x-nanocamp-source'], 'dynamic');
  assert.match(response.body.toString('utf8'), /<title>NanoCamp · 让有趣的人相遇<\/title>/);
});

test('7 个栏目与 4 篇指南都在请求期渲染', async () => {
  const routes = [
    '/about/', '/activities/', '/community/', '/faq/', '/minicamp/', '/partners/', '/resources/',
    '/resources/from-idea-to-demo/', '/resources/find-your-team/', '/resources/demo-story/', '/resources/host-a-sharing/',
  ];
  for (const route of routes) {
    const response = await get(route);
    assert.equal(response.status, 200, `${route} 应返回 200`);
    assert.equal(response.headers['x-nanocamp-source'], 'dynamic', `${route} 应来自请求期渲染`);
    assert.match(response.body.toString('utf8'), /<title>[^<]+<\/title>/, `${route} 应有标题`);
  }
});

// 指南的空白模板以前由 scripts/build.mjs 写进 dist/downloads/，现在改成请求时现算。
// 内容必须与旧产物逐字节一致，否则已发出去的下载链接内容会变。
test('指南的模板下载由 content/guides.mjs 现场生成', async () => {
  const { guides } = await import('../content/guides.mjs');
  for (const guide of guides) {
    const response = await get(`/downloads/${guide.slug}-template.txt`);
    assert.equal(response.status, 200, `${guide.slug} 的模板应可下载`);
    assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(response.body.toString('utf8'), `\uFEFF${guide.template}\n\nNanoCamp 共创指南\n`);
  }
  assert.equal((await get('/downloads/not-a-guide-template.txt')).status, 404);
});

test('首页首屏海报 /intro/ 同样在请求期渲染', async () => {
  const response = await get('/intro/');
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-nanocamp-source'], 'dynamic');
  assert.match(response.body.toString('utf8'), /class="brand-hero poster-b"/);
});

test('sitemap 与 robots 在请求期生成，域名跟随 site.url', async () => {
  const sitemap = await get('/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.equal(sitemap.headers['x-nanocamp-source'], 'dynamic');
  const xml = sitemap.body.toString('utf8');
  assert.match(xml, /<loc>https:\/\/[^<]+\/about\/<\/loc>/);
  assert.equal(xml.includes('/search/'), false, 'sitemap 不应列入 noindex 的搜索页');

  const robots = await get('/robots.txt');
  assert.equal(robots.status, 200);
  assert.equal(robots.headers['x-nanocamp-source'], 'dynamic');
  assert.match(robots.body.toString('utf8'), /^Sitemap: https:\/\/\S+\/sitemap\.xml$/m);
});

// 不接 dist/ 兜底：没迁移的页面必须是 404，这样访问一遍就能直观看到进度。
test('未迁移的页面返回 404，并用响应头标记 unmigrated', async () => {
  assert.ok(pendingRoutes.length > 0, '当前应仍有未迁移路由，这个用例才有意义');
  for (const route of pendingRoutes) {
    assert.equal(routeInfo.migrated.includes(route), false);
    const response = await get(route);
    assert.equal(response.status, 404, `${route} 未迁移时应当 404`);
    assert.equal(response.headers['x-nanocamp-source'], 'unmigrated', `${route} 应标记为未迁移`);
    assert.match(response.body.toString('utf8'), /页面未找到/);
  }
});

test('真正不存在的地址也是 404，但来源标记为 notfound', async () => {
  const response = await get('/definitely-not-a-page/');
  assert.equal(response.status, 404);
  assert.equal(response.headers['x-nanocamp-source'], 'notfound');
});

test('目录式地址补斜杠', async () => {
  const redirect = await get('/intro');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, '/intro/');
  assert.equal(redirect.headers['x-nanocamp-source'], 'redirect');
});

test('静态资源直接读 public/', async () => {
  const response = await get('/styles.css');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal(response.headers['x-nanocamp-source'], 'asset');
  assert.equal(response.body.toString('utf8'), readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8'));
});

test('public/ 之外的文件读不到', async () => {
  for (const url of ['/../package.json', '/..%2fpackage.json', '/images/../../package.json']) {
    const response = await get(url);
    assert.notEqual(response.status, 200, `${url} 不应被当作静态资源返回`);
  }
});

// 曾经踩过的坑：'//package.json' 被 new URL(url, base) 当成协议相对地址
//（host 变 package.json、pathname 变 '/'），于是 //任意路径 都返回首页。
// 现在按「路径」解析：找不到就是 404；重复斜杠会被 path.resolve 折叠，
// 所以 //styles.css 仍然命中同一个文件（200 asset），这是正确行为。
test('双斜杠开头按路径处理，不再落回首页', async () => {
  for (const url of ['//', '//package.json', '///x', '//../package.json', '//..%2fpackage.json', '//README.md']) {
    const response = await get(url);
    assert.equal(response.status, 404, `${url} 应为 404`);
    assert.equal(response.headers['x-nanocamp-source'], 'notfound', `${url} 不应被当成动态页面渲染`);
  }
  // 重复斜杠 / '.' 折叠后指向真实资源，属正常路径语义
  for (const url of ['//styles.css', '//./styles.css', '/////styles.css', '/a/../styles.css']) {
    const response = await get(url);
    assert.equal(response.status, 200, `${url} 应命中资源`);
    assert.equal(response.headers['x-nanocamp-source'], 'asset', `${url} 应来自 public/`);
  }
  // 首页本身仍然正常
  assert.equal((await get('/')).headers['x-nanocamp-source'], 'dynamic');
});

test('条件请求与非 GET 方法', async () => {
  const first = await get('/');
  const cached = await handleRequest({ method: 'GET', url: '/', headers: { 'if-none-match': first.headers.etag } });
  assert.equal(cached.status, 304);
  assert.equal(cached.body.byteLength, 0);

  const post = await handleRequest({ method: 'POST', url: '/', headers: {} });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});
