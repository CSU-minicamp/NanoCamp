import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleRequest, pendingRoutes } from '../backend/app.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const get = url => handleRequest({ method: 'GET', url, headers: {} });
// dist/ 里提交的 HTML 在 Windows 检出时是 CRLF，源码里的字符串是 LF；
// 比对前统一成 LF，避免把行尾差异误判成渲染差异。
const lf = value => value.replace(/\r\n/g, '\n');
const migrated = new Set(['/', '/intro/']);

test('首页由请求期渲染生成，且与旧静态产物逐字节一致', async t => {
  const response = await get('/');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(response.headers['x-nanocamp-source'], 'dynamic');
  assert.match(response.body.toString('utf8'), /<title>NanoCamp · 让有趣的人相遇<\/title>/);
  const file = path.join(root, 'dist', 'index.html');
  if (!existsSync(file)) return t.skip('dist 已移除，跳过与静态产物的比对');
  assert.equal(lf(response.body.toString('utf8')), lf(await readFile(file, 'utf8')));
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
    assert.equal(migrated.has(route), false);
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

test('静态资源直接读 public/，不经过 dist', async () => {
  const response = await get('/styles.css');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal(response.headers['x-nanocamp-source'], 'asset');
  assert.equal(response.body.toString('utf8'), await readFile(path.join(root, 'public', 'styles.css'), 'utf8'));
});

test('public/ 之外的文件读不到', async () => {
  for (const url of ['/../package.json', '/..%2fpackage.json', '/images/../../package.json']) {
    const response = await get(url);
    assert.notEqual(response.status, 200, `${url} 不应被当作静态资源返回`);
  }
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
