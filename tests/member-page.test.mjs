import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

import {handleRequest} from '../backend/app.mjs';
import {routePaths} from '../src/pages.mjs';
import {select, execute, closePool} from '../backend/db.mjs';
import {hashToken, authAvailable} from '../backend/auth.mjs';

// 导航栏右上角的账号入口 + /user/<uid>/ 公开主页。
// 打真 MySQL 的那几条（本人 / 访客的区别）没有库就整组跳过，纯渲染断言照常跑。

const ready = await (async () => {
  if (!authAvailable()) return false;
  try {
    await select('SELECT 1');
    return true;
  } catch {
    return false;
  }
})();
const skip = ready ? false : '未配置数据库（data/config.json 的 db 段），跳过公开主页集成测试';

// 一个带会话的测试账号；只在需要时建，after 里按 id 删掉（会话随外键级联消失）。
let fixture = null;
async function memberFixture() {
  if (fixture) return fixture;
  const email = `member.${randomBytes(6).toString('hex')}@example.test`;
  const now = new Date();
  const created = await execute(
    'INSERT INTO users (email, nickname, bio, email_verified_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [email, '林知远', '在做一个小工具', now, new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000), now]
  );
  const id = Number(created.insertId);
  const token = randomBytes(32).toString('base64url');
  await execute(
    'INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ua_hash) VALUES (?, ?, ?, ?, ?, ?)',
    [hashToken(token), id, now, now, new Date(now.getTime() + 24 * 60 * 60 * 1000), '']
  );
  fixture = {id, email, cookie: 'nc_sid=' + token};
  return fixture;
}

after(async () => {
  if (fixture) await execute('DELETE FROM users WHERE id = ?', [fixture.id]).catch(() => {});
  await closePool();
});

const get = async (url, headers = {}) => handleRequest({method: 'GET', url, headers});

test('右上角账号入口：全站一个圆，未登录是主题色底 + 白字「登录」', async () => {
  for (const route of routePaths) {
    const html = (await get(route)).body.toString('utf8');
    assert.equal((html.match(/data-account-entry/g) || []).length, 1, route + ' 应该有且只有一个账号入口');
    assert.match(
      html,
      /<a class="header-account" href="\/login\/" data-account-entry data-state="guest" aria-label="登录 NanoCamp">/,
      route + ' 的账号入口应是未登录形态'
    );
    assert.match(html, /<span class="account-label" aria-hidden="true">登录<\/span>/, route + ' 的圆里应写着「登录」');
    // 头像（人像）也在同一个圆里，只是未登录时由 CSS 藏起来 —— 登录后直接换过来，不用重新渲染。
    assert.match(html, /<svg class="avatar-glyph"/, route + ' 的圆里要带默认头像');
  }
});

test('登录态由 account.js 在客户端补上，服务端永远输出未登录形态', async () => {
  const html = (await get('/about/')).body.toString('utf8');
  assert.match(html, /<script defer src="\/account\.js"><\/script>/);
  assert.ok(html.indexOf('/base.js') < html.indexOf('/account.js'), 'account.js 应在 base.js 之后加载');
  assert.equal(/data-state="member"/.test(html), false, '页面是共享缓存的，不能把会员态写进 HTML');
});

test('/user/<uid>/：编号非法或人不存在都是 404', async () => {
  assert.equal((await get('/user/abc/')).status, 404);
  assert.equal((await get('/user/99999999/')).status, 404);
  assert.equal((await get('/user/0/')).status, 404);
});

test('/user/<uid> 少一个斜杠时先补上', async () => {
  const response = await get('/user/12');
  assert.equal(response.status, 301);
  assert.equal(response.headers.location, '/user/12/');
});

test('未登录看公开主页：只有公开资料，没有编辑入口', {skip}, async () => {
  const {id, email} = await memberFixture();
  const response = await get('/user/' + id + '/');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store', '公开主页含「是否本人」的差异，不能被缓存');
  const html = response.body.toString('utf8');
  assert.match(html, /data-page="user"/);
  assert.match(html, /<h1 class="member-name" id="member-name">林知远<\/h1>/);
  assert.match(html, /在做一个小工具/);
  assert.match(html, /href="\/auth\.css"/);
  assert.equal(html.includes('编辑资料'), false, '访客不该看到编辑入口');
  assert.equal(html.includes(email), false, '公开页不能出现邮箱');
});

test('本人看自己的公开主页：多一个「编辑资料」入口，指向 /profile/', {skip}, async () => {
  const {id, cookie} = await memberFixture();
  const html = (await get('/user/' + id + '/', {cookie})).body.toString('utf8');
  assert.match(html, /<a class="button button-primary member-edit" href="\/profile\/">/);
  assert.match(html, /编辑资料/);
});

test('已登录访问 /login/ 直接去 /profile/；未登录仍看到登录表单', {skip}, async () => {
  const {cookie} = await memberFixture();
  const member = await get('/login/', {cookie});
  assert.equal(member.status, 303);
  assert.equal(member.headers.location, '/profile/');
  assert.equal(member.headers['cache-control'], 'no-store');

  const guest = await get('/login/');
  assert.equal(guest.status, 200);
  assert.match(guest.body.toString('utf8'), /data-auth-form/);
});
