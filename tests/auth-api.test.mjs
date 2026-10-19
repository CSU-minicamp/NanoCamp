import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { handleRequest } from '../backend/app.mjs';
import {
  normalizeEmail, isEmail, hashPassword, verifyPassword,
  subjectOf, hashToken, createChallenge, verifyCode, loginWithPassword,
  readSession, revokeSession, sendIntervalFor
} from '../backend/auth.mjs';
import { lastConsoleCode } from '../backend/mail.mjs';

// 本版本的契约：
//   发验证码 = 真实现（不依赖存储，能测）
//   登录/验证码校验/会话 = 没有存储，接口 503，函数抛 not_implemented

const HOST = 'localhost:8099';
const newEmail = () => `t.${randomBytes(6).toString('hex')}@example.test`;

const call = (url, { method = 'GET', headers = {} } = {}) => handleRequest({ method, url, headers });

/** POST JSON：默认带同源 Origin。 */
const post = (url, body, { origin = `http://${HOST}`, host = HOST } = {}) => handleRequest({
  method: 'POST',
  url,
  headers: { host, ...(origin ? { origin } : {}) },
  body: body === null ? null : JSON.stringify(body),
  ip: '127.0.0.1'
});

const payloadOf = response => JSON.parse(response.body.toString('utf8'));

test('登录不可用，但发码可用 —— 两件事分开报告', async () => {
  const response = await call('/api/session');
  assert.equal(response.status, 200);
  assert.deepEqual(payloadOf(response), { user: null, disabled: true, canSendCode: true });
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('发验证码真的发出去了（console 适配器记录 6 位码）', async () => {
  const email = newEmail();
  const response = await post('/api/auth/code', { email });
  assert.equal(response.status, 200);
  const payload = payloadOf(response);
  assert.equal(payload.ok, true);
  assert.equal(payload.provider, 'console');
  assert.equal(payload.canVerify, false, '本版本校验还没接上，要如实告诉前端');
  assert.ok(payload.retryAfter >= 1);
  assert.match(lastConsoleCode(email), /^\d{6}$/, '邮件通道应收到 6 位验证码');
});

test('邮箱规范化后发信，大小写不影响', async () => {
  const email = newEmail();
  const response = await post('/api/auth/code', { email: `  ${email.toUpperCase()} ` });
  assert.equal(response.status, 200);
  assert.match(lastConsoleCode(email), /^\d{6}$/, '应按小写邮箱记账');
});

test('非法邮箱不发信', async () => {
  const response = await post('/api/auth/code', { email: 'not-an-email' });
  assert.equal(response.status, 400);
  assert.equal(payloadOf(response).error, 'invalid_email');
});

test('POST 必须同源，否则 403', async () => {
  const email = newEmail();
  const noOrigin = await post('/api/auth/code', { email }, { origin: '' });
  assert.equal(noOrigin.status, 403);
  const crossOrigin = await post('/api/auth/code', { email }, { origin: 'http://evil.example' });
  assert.equal(crossOrigin.status, 403);
  assert.equal(lastConsoleCode(email), '', '被拒的请求不应发出邮件');
});

test('请求体非法时 400，且不发信', async () => {
  const response = await handleRequest({ method: 'POST', url: '/api/auth/code', headers: { host: HOST, origin: `http://${HOST}` }, body: '{oops', ip: '127.0.0.1' });
  assert.equal(response.status, 400);
  assert.equal(payloadOf(response).error, 'invalid_body');
});

test('同一邮箱 60 秒内重发返回 429 并带 Retry-After', async () => {
  const email = newEmail();
  assert.equal((await post('/api/auth/code', { email })).status, 200);
  const again = await post('/api/auth/code', { email });
  assert.equal(again.status, 429);
  assert.equal(payloadOf(again).error, 'rate_limited');
  assert.ok(Number(again.headers['retry-after']) > 0);
  const body = payloadOf(again);
  assert.ok(body.retryAfter > 0);
});

test('登录、验证码校验、退出都还没有开放', async () => {
  for (const path of ['/api/auth/verify', '/api/auth/login', '/api/auth/logout']) {
    const response = await post(path, {});
    assert.equal(response.status, 503, `${path} 应返回 503`);
    assert.equal(payloadOf(response).error, 'auth_unavailable');
  }
});

test('认证接口只收 POST，未知接口 404', async () => {
  assert.equal((await call('/api/auth/code')).status, 405);
  assert.equal((await call('/api/auth/login')).status, 405);
  assert.equal((await call('/api/unknown')).status, 404);
});

test('需要存储的函数仍是占位实现，调用即抛 not_implemented', () => {
  const stubs = { subjectOf, hashToken, createChallenge, verifyCode, loginWithPassword };
  for (const [name, stub] of Object.entries(stubs)) {
    assert.throws(() => stub({}), error => error.code === 'not_implemented', `${name} 应当抛 not_implemented`);
  }
});

test('readSession 返回 null、revokeSession 无操作', async () => {
  assert.equal(await readSession('any-token'), null);
  assert.equal(await revokeSession('any-token'), undefined);
});

test('邮箱规范化与格式校验', () => {
  assert.equal(normalizeEmail('  Zhang@Example.COM '), 'zhang@example.com');
  assert.equal(isEmail('a@b.co'), true);
  assert.equal(isEmail('a@b.c'), false);
  assert.equal(isEmail('no-at-sign'), false);
  assert.equal(isEmail(''), false);
});

test('密码哈希可以往返校验，且同一密码每次哈希都不同', async () => {
  const hash = await hashPassword('good-password-2026');
  assert.match(hash, /^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
  assert.equal(await verifyPassword('good-password-2026', hash), true);
  assert.equal(await verifyPassword('wrong-password-2026', hash), false);
  assert.notEqual(await hashPassword('good-password-2026'), hash, '应使用随机盐');
  assert.equal(await verifyPassword('good-password-2026', 'not-a-hash'), false);
});

test('发码限额是阶梯：60 秒 ×5 → 5 分钟 ×3 → 20 分钟', () => {
  assert.equal(sendIntervalFor(0), 60 * 1000, '第 1 次');
  assert.equal(sendIntervalFor(4), 60 * 1000, '第 5 次仍是 60 秒');
  assert.equal(sendIntervalFor(5), 5 * 60 * 1000, '第 6 次起 5 分钟');
  assert.equal(sendIntervalFor(7), 5 * 60 * 1000, '第 8 次仍是 5 分钟');
  assert.equal(sendIntervalFor(8), 20 * 60 * 1000, '第 9 次起 20 分钟');
  assert.equal(sendIntervalFor(99), 20 * 60 * 1000, '上限不再变');
});

test('公开页面完全不受认证状态影响', async () => {
  for (const route of ['/', '/about/', '/login/', '/401/']) {
    const response = await call(route);
    assert.equal(response.status, 200, `${route} 仍应正常渲染`);
    assert.equal(response.headers['x-nanocamp-source'], 'dynamic');
  }
});
