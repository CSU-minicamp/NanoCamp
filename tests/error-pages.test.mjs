import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleRequest } from '../backend/app.mjs';
import { routePaths, indexablePaths, noindexPaths } from '../src/pages.mjs';

const get = url => handleRequest({ method: 'GET', url, headers: {} });
const pageHtml = async url => (await get(url)).body.toString('utf8');

test('401 页可按目录地址访问，且由请求期渲染', async () => {
  const response = await get('/401/');
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-nanocamp-source'], 'dynamic');
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  const page = response.body.toString('utf8');
  assert.match(page, /<title>需要登录 · NanoCamp<\/title>/);
  assert.equal((page.match(/<h1[ >]/g) || []).length, 1, '401 页应当只有一个主标题');
  // 这一页只做引导：不摆表单、不放任何用户数据
  assert.equal(/<form[ >]/i.test(page), false, '401 页不应包含表单');
  assert.equal(/<input[ >]/i.test(page), false, '401 页不应包含输入框');
});

test('401 页是 noindex 状态页，并指向登录入口', async () => {
  const page = await pageHtml('/401/');
  assert.match(page, /<meta name="robots" content="noindex, follow">/);
  assert.match(page, /<link rel="canonical" href="[^"]*\/401\/">/);
  // 主按钮必须直接把用户送到登录页，而不是让他自己找入口
  assert.match(page, /class="button button-secondary missing-primary" href="\/login\/"/);
});

test('401.html 文件版同样可用，供反向代理 error_page 直接返回', async () => {
  const response = await get('/401.html');
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-nanocamp-source'], 'dynamic');
  const page = response.body.toString('utf8');
  assert.match(page, /<meta name="robots" content="noindex, follow">/);
  assert.match(page, /这里需要登录/);
});

test('401 的目录式地址补斜杠', async () => {
  const response = await get('/401');
  assert.equal(response.status, 301);
  assert.equal(response.headers.location, '/401/');
});

test('401 页仍是只读的：非 GET/HEAD 返回 405', async () => {
  const response = await handleRequest({ method: 'POST', url: '/401/', headers: {} });
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'GET, HEAD');
});

test('noindex 与可索引路径互补，不重不漏', () => {
  assert.equal(new Set([...noindexPaths, ...indexablePaths]).size, routePaths.length);
  assert.equal(indexablePaths.length + noindexPaths.length, routePaths.length);
  for (const route of noindexPaths) assert.equal(routePaths.includes(route), true, `${route} 应在路由表里`);
  // 状态页与认证页都不该被搜索引擎收录
  for (const route of ['/search/', '/login/', '/401/']) assert.equal(noindexPaths.includes(route), true, `${route} 应标记 noindex`);
});

test('sitemap 只列可索引页面，状态页一律不出现', async () => {
  const xml = (await get('/sitemap.xml')).body.toString('utf8');
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.equal(locations.length, indexablePaths.length);
  for (const route of noindexPaths) assert.equal(xml.includes(route), false, `sitemap 不应包含 ${route}`);
  assert.ok(xml.includes('/about/'), '正常内容页仍应在 sitemap 里');
});

test('站内搜索索引不收录 noindex 页面', async () => {
  const page = await pageHtml('/search/');
  const json = page.match(/<script type="application\/json" data-search-index>([\s\S]*?)<\/script>/)[1];
  const records = JSON.parse(json);
  const paths = records.filter(record => record.id.startsWith('page:')).map(record => record.id.slice('page:'.length));
  for (const route of noindexPaths) assert.equal(paths.includes(route), false, `搜索索引不应收录 ${route}`);
  assert.ok(paths.includes('/about/'), '正常内容页仍应可被搜索到');
});
