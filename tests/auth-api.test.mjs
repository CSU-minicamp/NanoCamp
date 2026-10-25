import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

import {handleRequest} from '../backend/app.mjs';
import {dbReady, select, execute, closePool, isUnavailable} from '../backend/db.mjs';
import {
  normalizeEmail, isEmail, hashPassword, verifyPassword, sendIntervalFor,
  subjectOf, hashToken, createChallenge, readSession, authAvailable
} from '../backend/auth.mjs';
import {safeNext} from '../backend/api.mjs';
import {pauseFile} from '../backend/config.mjs';
import {writeFileSync, rmSync} from 'node:fs';
import {lastConsoleEmailCaptcha} from '../backend/mail.mjs';

// 打真 MySQL：先把 data/config.json 的 db 段配好、跑过 npm run db:migrate。
// 没有数据库时整组跳过（CI 里不会红），纯函数测试照常跑。
const ready = await (async () => {
  if(!dbReady())
    return false;
  try{
    await select('SELECT 1');
    return true;
  }
  catch{
    return false;
  }
})();
const skip = ready? false: '未配置数据库（data/config.json 的 db 段），跳过认证集成测试';

const HOST = 'localhost:8099';
const emails = [];
const newEmail = () => {
  const email = `t.${randomBytes(6).toString('hex')}@example.test`;
  emails.push(email);
  return email;
};

/** 发一次请求；默认带同源 Origin，cookie 与 csrf 由调用方给。 */
async function call(path, {method = 'POST', body = null, jar = null, csrf = '', origin = `http://${HOST}`} = {}){
  const headers = {host: HOST};
  if(origin)
    headers.origin = origin;
  if(jar?.size)
    headers.cookie = cookieHeader(jar);
  if(csrf)
    headers['x-nc-csrf'] = csrf;
  const response = await handleRequest({
    method,
    url: path,
    headers,
    body: body? JSON.stringify(body): null,
    ip: '127.0.0.1'
  });
  const text = response.body.toString('utf8');
  return {
    status: response.status,
    headers: response.headers,
    text,
    json: text.startsWith('{')? JSON.parse(text): null,
    setCookies: [response.headers['set-cookie'] || []].flat()
  };
}

const cookieHeader = jar => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

/** 把响应里的 Set-Cookie 合并进简单的 cookie 罐。 */
function absorb(jar, setCookies){
  for(const raw of setCookies){
    const pair = raw.split(';')[0];
    const index = pair.indexOf('=');
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if(value)
      jar.set(name, value);
    else
      jar.delete(name);
  }
  return jar;
}

/** 拿一个 CSRF 令牌（匿名也能拿）。 */
async function boot(){
  const jar = new Map();
  const response = await call('/api/session', {method: 'GET', jar});
  absorb(jar, response.setCookies);
  return {jar, csrf: response.json.csrf, session: response.json};
}

/** 走完「拿 csrf → 发码」，返回 cookie 罐、csrf 与验证码。 */
async function requestEmailCaptcha(email){
  const {jar, csrf} = await boot();
  const sent = await call('/api/auth/email-captcha', {body: {email}, jar, csrf});
  absorb(jar, sent.setCookies);
  return {jar, csrf, sent, code: lastConsoleEmailCaptcha(email)};
}

after(async () => {
  if(!ready)
    return;
  for(const email of emails){
    const users = await select('SELECT id FROM users WHERE email = ?', [email]);
    for(const user of users)
      await execute('DELETE FROM sessions WHERE user_id = ?', [user.id]);
    await execute('DELETE FROM login_email_captcha WHERE email = ?', [email]);
    await execute('DELETE FROM users WHERE email = ?', [email]);
    await execute('DELETE FROM rate_events WHERE subject = ?', [subjectOf(email)]);
  }
  await closePool();
});

test('认证就绪：配了数据库与 secret', {skip}, () => {
  assert.equal(authAvailable(), true);
});

test('会话接口报告可用状态并下发 CSRF 令牌', {skip}, async () => {
  const {jar, csrf, session} = await boot();
  assert.equal(session.disabled, false);
  assert.equal(session.canSendCode, true);
  assert.equal(session.user, null);
  assert.match(csrf, /^[0-9a-f]{32}$/);
  assert.ok(jar.get('nc_csrf'), 'CSRF 令牌要同时写进 cookie（double-submit）');
});

test('发验证码：真的发出去了，并写进 login_email_captcha', {skip}, async () => {
  const email = newEmail();
  const {jar, sent, code} = await requestEmailCaptcha(email);
  assert.equal(sent.status, 200);
  assert.equal(sent.json.canVerify, true);
  assert.equal(sent.json.provider, 'console');
  assert.ok(sent.json.retryAfter >= 1);
  assert.match(code, /^\d{6}$/);
  assert.ok(jar.get('nc_chal'), '挑战 id 要落到 cookie 里');
  const rows = await select('SELECT email, consumed_at, attempts FROM login_email_captcha WHERE challenge = ?', [jar.get('nc_chal')]);
  assert.equal(rows[0].email, email);
  assert.equal(rows[0].consumed_at, null);
});

test('非法邮箱不发信', {skip}, async () => {
  const {jar, csrf} = await boot();
  const response = await call('/api/auth/email-captcha', {body: {email: 'not-an-email'}, jar, csrf});
  assert.equal(response.status, 400);
  assert.equal(response.json.error, 'invalid_email');
});

test('POST 必须同源且带 CSRF 令牌', {skip}, async () => {
  const {jar, csrf} = await boot();
  const email = newEmail();
  assert.equal((await call('/api/auth/email-captcha', {body: {email}, jar, csrf: '', origin: `http://${HOST}`})).status, 403);
  assert.equal((await call('/api/auth/email-captcha', {body: {email}, jar, csrf, origin: 'http://evil.example'})).status, 403);
  assert.equal((await call('/api/auth/email-captcha', {body: {email}, jar: new Map(), csrf})).status, 403);
});

test('同一邮箱 60 秒内重发 429', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf} = await requestEmailCaptcha(email);
  const again = await call('/api/auth/email-captcha', {body: {email}, jar, csrf});
  assert.equal(again.status, 429);
  assert.equal(again.json.error, 'rate_limited');
  assert.ok(Number(again.headers['retry-after']) > 0);
});

test('完整流程：发码 → 验证 → 读会话 → 退出', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code} = await requestEmailCaptcha(email);

  const verified = await call('/api/auth/verify', {body: {emailCaptcha: code, next: '/projects/'}, jar, csrf});
  assert.equal(verified.status, 200);
  assert.equal(verified.json.isNew, true);
  assert.equal(verified.json.user.email, email);
  // 新账号还没设密码 ⇒ 先去补全页，补完回 /projects/
  assert.deepEqual(verified.json.missing, ['password', 'nickname'], '缺密码和昵称两项');
  assert.equal(verified.json.redirect, '/profile/force/?next=%2Fprojects%2F');
  absorb(jar, verified.setCookies);
  assert.equal(jar.has('nc_chal'), false);

  const me = await call('/api/session', {method: 'GET', jar});
  assert.equal(me.json.user.email, email);

  const out = await call('/api/auth/logout', {jar, csrf});
  assert.equal(out.status, 200);
  absorb(jar, out.setCookies);
  assert.equal((await call('/api/session', {method: 'GET', jar})).json.user, null);
});

test('同一枚验证码只能成功消费一次', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code} = await requestEmailCaptcha(email);
  const challenge = jar.get('nc_chal');
  assert.equal((await call('/api/auth/verify', {body: {emailCaptcha: code}, jar, csrf})).status, 200);

  jar.set('nc_chal', challenge);
  const second = await call('/api/auth/verify', {body: {emailCaptcha: code}, jar, csrf});
  assert.equal(second.status, 400);
  assert.equal(second.json.error, 'email_captcha_invalid');
});

test('并发验证同一枚码只成功一次、只建一个账号', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code} = await requestEmailCaptcha(email);
  const challenge = jar.get('nc_chal');
  const attempt = () => {
    const local = new Map(jar);
    local.set('nc_chal', challenge);
    return call('/api/auth/verify', {body: {emailCaptcha: code}, jar: local, csrf});
  };
  const results = await Promise.all([attempt(), attempt(), attempt()]);
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.json?.isNew === true).length, 1);
  const rows = await select('SELECT COUNT(*) AS total FROM users WHERE email = ?', [email]);
  assert.equal(Number(rows[0].total), 1);
});

test('过期的验证码不建立会话', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code} = await requestEmailCaptcha(email);
  const challenge = jar.get('nc_chal');
  await execute('UPDATE login_email_captcha SET expires_at = ? WHERE challenge = ?', [new Date(Date.now() - 60_000), challenge]);
  const response = await call('/api/auth/verify', {body: {emailCaptcha: code}, jar, csrf});
  assert.equal(response.status, 400);
  assert.equal(response.json.error, 'email_captcha_invalid');
});

test('回跳目标只认站内路径', {skip}, async () => {
  const cases = [['/minicamp/#recap', '/minicamp/#recap'], ['//evil.com/x', '/'], ['javascript:alert(1)', '/']];
  for(const [next, expected] of cases){
    const email = newEmail();
    const {jar, csrf, code} = await requestEmailCaptcha(email);
    const verified = await call('/api/auth/verify', {body: {emailCaptcha: code, next}, jar, csrf});
    assert.equal(verified.status, 200);
    // 资料没补全，任何目标都要先绕去 /profile/force/，把原目标带在 next 里
    assert.equal(verified.json.redirect, `/profile/force/?next=${encodeURIComponent(expected)}`, `next=${next}`);
  }
});

test('密码登录：正确密码建立会话，错误密码一律 401', {skip}, async () => {
  const email = newEmail();
  const {jar: otpJar, csrf: otpCsrf, code} = await requestEmailCaptcha(email);
  assert.equal((await call('/api/auth/verify', {body: {emailCaptcha: code}, jar: otpJar, csrf: otpCsrf})).status, 200);
  // 设密码/昵称的界面在 /profile/force/，这里直接写库构造「资料完整」的账号。
  await execute('UPDATE users SET password_hash = ?, nickname = ? WHERE email = ?', [await hashPassword('good-password-2026'), '阿岚', email]);

  const {jar, csrf} = await boot();
  const ok = await call('/api/auth/login', {body: {email, password: 'good-password-2026', next: '/minicamp/'}, jar, csrf});
  assert.equal(ok.status, 200);
  assert.equal(ok.json.redirect, '/minicamp/');
  absorb(jar, ok.setCookies);
  assert.equal((await call('/api/session', {method: 'GET', jar})).json.user.email, email);

  const wrong = await call('/api/auth/login', {body: {email, password: 'wrong-password-2026'}, jar, csrf});
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error, 'credentials_invalid');
  assert.equal(wrong.setCookies.some(raw => raw.startsWith('nc_sid=')), false);

  const unknown = await call('/api/auth/login', {body: {email: newEmail(), password: 'whatever-123'}, jar, csrf});
  assert.equal(unknown.status, 401, '未知邮箱必须与密码错误同一句');
});

test('只用验证码登录过的账号没有密码，密码登录 401', {skip}, async () => {
  const email = newEmail();
  const {jar: otpJar, csrf: otpCsrf, code} = await requestEmailCaptcha(email);
  assert.equal((await call('/api/auth/verify', {body: {emailCaptcha: code}, jar: otpJar, csrf: otpCsrf})).status, 200);
  // 昵称不影响这个用例要验证的东西（没有密码），补上只是免得被送去补全页
  await execute('UPDATE users SET nickname = ? WHERE email = ?', ['阿岚', email]);

  const {jar, csrf} = await boot();
  const response = await call('/api/auth/login', {body: {email, password: 'some-password-123'}, jar, csrf});
  assert.equal(response.status, 401);
  assert.equal(response.json.error, 'credentials_invalid');
});

test('密码连续猜错会被限流', {skip}, async () => {
  const email = newEmail();
  const {jar: otpJar, csrf: otpCsrf, code} = await requestEmailCaptcha(email);
  await call('/api/auth/verify', {body: {emailCaptcha: code}, jar: otpJar, csrf: otpCsrf});
  await execute('UPDATE users SET password_hash = ?, nickname = ? WHERE email = ?', [await hashPassword('good-password-2026'), '阿岚', email]);

  const {jar, csrf} = await boot();
  let last = null;
  for(let attempt = 0; attempt < 11; attempt += 1)
    last = await call('/api/auth/login', {body: {email, password: `wrong-${attempt}-password`}, jar, csrf});
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers['retry-after']) > 0);
});

test('登录成功会清空该邮箱的限流计数', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code} = await requestEmailCaptcha(email);
  // 发过一次码、错猜一次，此时正背着两条记录
  await call('/api/auth/verify', {body: {emailCaptcha: '000000'}, jar, csrf});
  assert.ok((await select('SELECT COUNT(*) AS total FROM rate_events WHERE subject = ?', [subjectOf(email)]))[0].total > 0);

  const ok = await call('/api/auth/verify', {body: {emailCaptcha: code}, jar, csrf});
  assert.equal(ok.status, 200);
  const left = await select('SELECT COUNT(*) AS total FROM rate_events WHERE subject = ?', [subjectOf(email)]);
  assert.equal(Number(left[0].total), 0, '成功登录后不该再留旧账');

  // 计数清零的直接后果：不用等 60 秒就能再发一次码
  const again = await call('/api/auth/email-captcha', {body: {email}, jar, csrf});
  assert.equal(again.status, 200, '登录成功后应立刻可以重新发码');
});

test('密码登录成功同样清空猜错计数', {skip}, async () => {
  const email = newEmail();
  const {jar: otpJar, csrf: otpCsrf, code} = await requestEmailCaptcha(email);
  await call('/api/auth/verify', {body: {emailCaptcha: code}, jar: otpJar, csrf: otpCsrf});
  await execute('UPDATE users SET password_hash = ?, nickname = ? WHERE email = ?', [await hashPassword('good-password-2026'), '阿岚', email]);

  const {jar, csrf} = await boot();
  for(let attempt = 0; attempt < 9; attempt += 1)
    await call('/api/auth/login', {body: {email, password: `wrong-${attempt}-password`}, jar, csrf});
  assert.equal((await call('/api/auth/login', {body: {email, password: 'good-password-2026'}, jar, csrf})).status, 200);

  // 清零后，再错一次仍是 401 而不是 429
  const after = await call('/api/auth/login', {body: {email, password: 'still-wrong-password'}, jar, csrf});
  assert.equal(after.status, 401);
  assert.equal(after.json.error, 'credentials_invalid');
});

test('补全资料：未登录 401，短密码 400，成功后 missing 清空', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code} = await requestEmailCaptcha(email);
  const verified = await call('/api/auth/verify', {body: {emailCaptcha: code}, jar, csrf});
  absorb(jar, verified.setCookies);

  // 没有会话但 CSRF 合法 ⇒ 401（缺 CSRF 会是 403，闸门在认证之前）
  const anon = await boot();
  const anonymous = await call('/api/profile', {body: {password: 'good-password-2026'}, jar: anon.jar, csrf: anon.csrf});
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.json.error, 'unauthenticated');

  const short = await call('/api/profile', {body: {password: 'short'}, jar, csrf});
  assert.equal(short.status, 400);
  assert.equal(short.json.error, 'invalid_password');

  const saved = await call('/api/profile', {body: {password: 'good-password-2026', nickname: '阿岚', bio: '在做一个小工具'}, jar, csrf});
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.missing, [], '密码设好之后不该再有必填项');
  assert.equal(saved.json.user.hasPassword, true);
  assert.equal(saved.json.user.email, email);
  assert.equal(saved.json.user.nickname, '阿岚');
  assert.equal(saved.json.user.bio, '在做一个小工具');

  // 会话里也不再报缺项
  const me = await call('/api/session', {method: 'GET', jar});
  assert.deepEqual(me.json.missing, []);

  // 设完密码，密码登录就能用了（并且不再被赶去补全页）
  const fresh = await boot();
  const login = await call('/api/auth/login', {body: {email, password: 'good-password-2026', next: '/minicamp/'}, jar: fresh.jar, csrf: fresh.csrf});
  assert.equal(login.status, 200);
  assert.equal(login.json.redirect, '/minicamp/', '资料完整时应直接去目标页');
});

test('补全资料：没有可更新字段时 400', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code} = await requestEmailCaptcha(email);
  const verified = await call('/api/auth/verify', {body: {emailCaptcha: code}, jar, csrf});
  absorb(jar, verified.setCookies);

  const empty = await call('/api/profile', {body: {}, jar, csrf});
  assert.equal(empty.status, 400);
  assert.equal(empty.json.error, 'invalid_profile');
});

test('/profile/ 未登录直接跳登录页，并带上回跳地址', async () => {
  const response = await call('/profile/', {method: 'GET'});
  assert.equal(response.status, 303, '未登录不该先给人看一张 401 页面');
  assert.equal(response.headers.location, '/login/?next=%2Fprofile%2F');
  assert.equal(response.headers['cache-control'], 'no-store', '带会话的跳转不能被缓存');
});

test('/profile 会补斜杠跳到 /profile/', async () => {
  const response = await call('/profile', {method: 'GET'});
  assert.equal(response.status, 301);
  assert.equal(response.headers.location, '/profile/');
});

test('/profile/ 登录后跳转至个人中心的内嵌资料', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code} = await requestEmailCaptcha(email);
  const verified = await call('/api/auth/verify', {body: {emailCaptcha: code}, jar, csrf});
  absorb(jar, verified.setCookies);

  // 还没设密码 → 先被挡去补全页
  const before = await call('/profile/', {method: 'GET', jar});
  assert.equal(before.status, 303);
  assert.equal(before.headers.location, '/profile/force/?next=%2Fprofile%2F');

  // 补完再看：只有邮箱
  assert.equal((await call('/api/profile', {body: {password: 'good-password-2026', nickname: '阿岚', bio: '在做一个小工具'}, jar, csrf})).status, 200);
  const after = await call('/profile/', {method: 'GET', jar});
  assert.equal(after.status, 303);
  assert.equal(after.headers.location, '/forum/me/?tab=profile');
  const integrated = await call(after.headers.location, {method: 'GET', jar});
  assert.equal(integrated.status, 200);
  const html = integrated.text;
  assert.ok(!html.includes(email),'公开资料编辑不混入登录邮箱');
  assert.match(html, /data-account-profile/);
  assert.match(html, /aria-label="个人中心"/);
  assert.match(html, /for="account-nickname"/);
  assert.ok(!html.includes('type="password"'));
  const security=await call('/forum/me/?tab=security',{method:'GET',jar});
  assert.equal(security.status,200);
  assert.ok(security.text.includes(email));
  assert.match(security.text,/autocomplete="current-password"/);
  assert.match(html, /阿岚/);
  assert.match(html, /在做一个小工具/);
});

test('补全页：缺字段时 200 并标出必填，补完再访问就 303 放行', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code} = await requestEmailCaptcha(email);
  const verified = await call('/api/auth/verify', {body: {emailCaptcha: code, next: '/profile/force/'}, jar, csrf});
  absorb(jar, verified.setCookies);

  const page = await call('/profile/force/?next=%2Fprofile%2F', {method: 'GET', jar});
  assert.equal(page.status, 200);
  assert.match(page.text, /data-profile-password-required>必填/, '密码应被标成必填');
  assert.match(page.text, /id="profile-nickname"[^>]*value="新伙伴"/, '昵称默认「新伙伴」');
  assert.match(page.text, /设置密码/);
  assert.equal(page.headers['cache-control'], 'no-store', '按人渲染的页面不能缓存');

  // 补完之后，同一个地址不该再给表单
  assert.equal((await call('/api/profile', {body: {password: 'good-password-2026', nickname: '阿岚'}, jar, csrf})).status, 200);
  const after = await call('/profile/force/?next=%2Fminicamp%2F', {method: 'GET', jar});
  assert.equal(after.status, 303);
  assert.equal(after.headers.location, '/minicamp/', '已完整时应直接去 next');
});

test('补全页：next 非法时回落到 /profile/', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code} = await requestEmailCaptcha(email);
  absorb(jar, (await call('/api/auth/verify', {body: {emailCaptcha: code}, jar, csrf})).setCookies);
  assert.equal((await call('/api/profile', {body: {password: 'good-password-2026', nickname: '阿岚'}, jar, csrf})).status, 200);
  const after = await call('/profile/force/?next=%2F%2Fevil.com', {method: 'GET', jar});
  assert.equal(after.status, 303);
  assert.equal(after.headers.location, '/profile/');
});

test('重发会作废旧码，新码才有效', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code: oldCode} = await requestEmailCaptcha(email);
  const challenge = jar.get('nc_chal');

  // 抹掉「60 秒间隔」这条记录，模拟「已经等够了再发一次」
  await execute('DELETE FROM rate_events WHERE subject = ? AND kind = ?', [subjectOf(email), 'send']);
  const again = await call('/api/auth/email-captcha', {body: {email}, jar, csrf});
  assert.equal(again.status, 200);
  absorb(jar, again.setCookies);
  assert.equal(jar.get('nc_chal'), challenge, '同一浏览器重发应复用同一个挑战');
  const newCode = lastConsoleEmailCaptcha(email);
  assert.notEqual(newCode, oldCode, '每次发码都应生成新随机码');

  const stale = await call('/api/auth/verify', {body: {emailCaptcha: oldCode}, jar, csrf});
  assert.equal(stale.status, 400, '旧码应已失效');
  const fresh = await call('/api/auth/verify', {body: {emailCaptcha: newCode}, jar, csrf});
  assert.equal(fresh.status, 200, '新码应当可用');
});

test('同一枚码错 5 次即作废，之后输对也没用', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code} = await requestEmailCaptcha(email);
  for(let attempt = 0; attempt < 5; attempt += 1){
    const wrong = await call('/api/auth/verify', {body: {emailCaptcha: '000000'}, jar, csrf});
    assert.equal(wrong.status, 400, `第 ${attempt + 1} 次猜错应为 400`);
  }
  const tooLate = await call('/api/auth/verify', {body: {emailCaptcha: code}, jar, csrf});
  assert.equal(tooLate.status, 400, '5 次之后正确的码也不该再用');
  assert.equal(tooLate.json.error, 'email_captcha_invalid');
});

test('猜错过多时，连发新码也拒绝（不然换个码就能继续猜）', {skip}, async () => {
  const email = newEmail();
  // 直接写 10 条猜错记录，模拟「已经被打到上限」
  const subject = subjectOf(email);
  const now = Date.now();
  for(let i = 0; i < 10; i += 1)
    await execute('INSERT INTO rate_events (kind, subject, at) VALUES (?, ?, ?)', ['verify_fail', subject, new Date(now - i * 1000)]);
  const {jar, csrf} = await boot();
  const response = await call('/api/auth/email-captcha', {body: {email}, jar, csrf});
  assert.equal(response.status, 429);
  assert.equal(response.json.error, 'rate_limited');
  assert.ok(Number(response.headers['retry-after']) > 0);
});

test('运维开关：暂停发信时拒绝发码，但已收到的码仍可用', {skip}, async () => {
  const email = newEmail();
  const {jar, csrf, code} = await requestEmailCaptcha(email);

  writeFileSync(pauseFile, '');
  try{
    const blocked = await call('/api/auth/email-captcha', {body: {email: newEmail()}, jar, csrf});
    assert.equal(blocked.status, 503);
    assert.equal(blocked.json.error, 'mail_paused');

    const me = await call('/api/session', {method: 'GET', jar});
    assert.equal(me.json.mailPaused, true, '会话里要能看出暂停状态');
    assert.equal(me.json.canSendCode, false, '暂停时只锁发码');

    // 暂停不影响校验：暂停前发出去的码仍然能登录
    const ok = await call('/api/auth/verify', {body: {emailCaptcha: code}, jar, csrf});
    assert.equal(ok.status, 200);
  }
  finally{
    rmSync(pauseFile, {force: true});
  }

  const resumed = await call('/api/auth/email-captcha', {body: {email: newEmail()}, jar, csrf});
  assert.equal(resumed.status, 200, '删掉开关文件后应立刻恢复');
  const session = await call('/api/session', {method: 'GET', jar});
  assert.equal(session.json.mailPaused, false);
});

// ---------------- 纯函数（不依赖数据库，任何环境都跑） ----------------

test('阶梯限额：60 秒 ×5 → 5 分钟 ×3 → 20 分钟', () => {
  assert.equal(sendIntervalFor(0), 60 * 1000);
  assert.equal(sendIntervalFor(4), 60 * 1000);
  assert.equal(sendIntervalFor(5), 5 * 60 * 1000);
  assert.equal(sendIntervalFor(7), 5 * 60 * 1000);
  assert.equal(sendIntervalFor(8), 20 * 60 * 1000);
  assert.equal(sendIntervalFor(99), 20 * 60 * 1000);
});

test('邮箱规范化与格式校验', () => {
  assert.equal(normalizeEmail('  Zhang@Example.COM '), 'zhang@example.com');
  assert.equal(isEmail('a@b.co'), true);
  assert.equal(isEmail('a@b.c'), false);
  assert.equal(isEmail('no-at-sign'), false);
  assert.equal(isEmail(''), false);
});

test('密码哈希可以往返校验，且每次哈希都不同', async () => {
  const hash = await hashPassword('good-password-2026');
  assert.match(hash, /^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
  assert.equal(await verifyPassword('good-password-2026', hash), true);
  assert.equal(await verifyPassword('wrong-password-2026', hash), false);
  assert.notEqual(await hashPassword('good-password-2026'), hash, '应使用随机盐');
  assert.equal(await verifyPassword('good-password-2026', 'not-a-hash'), false);
});

test('账号安全：改密校验、旧接口拒绝及所有会话撤销',{skip},async()=>{
  const email=newEmail(),oldPassword='Existing-password-2026',newPassword='New-password-2026';
  const first=await requestEmailCaptcha(email);
  absorb(first.jar,(await call('/api/auth/verify',{body:{emailCaptcha:first.code},jar:first.jar,csrf:first.csrf})).setCookies);
  assert.equal((await call('/api/profile',{body:{password:oldPassword,nickname:'安全测试'},jar:first.jar,csrf:first.csrf})).status,200);
  const second=await boot();
  absorb(second.jar,(await call('/api/auth/login',{body:{email,password:oldPassword},jar:second.jar,csrf:second.csrf})).setCookies);
  const existingSession=first.jar.get('nc_sid');
  const change=(body,csrf=first.csrf)=>call('/api/profile/password',{body,jar:first.jar,csrf});
  assert.equal((await change({currentPassword:oldPassword,newPassword,confirmPassword:newPassword},'')).status,403);
  const bypass=await call('/api/profile',{body:{password:newPassword,nickname:'不能连同昵称绕过修改'},jar:first.jar,csrf:first.csrf});
  assert.equal(bypass.status,403);assert.equal(bypass.json.error,'password_change_required');
  assert.equal((await readSession(existingSession)).user.nickname,'安全测试');
  assert.equal((await change({currentPassword:'wrong-password',newPassword,confirmPassword:newPassword})).json.error,'current_password_invalid');
  assert.equal((await change({currentPassword:oldPassword,newPassword,confirmPassword:'mismatch-password'})).json.error,'password_mismatch');
  assert.equal((await change({currentPassword:oldPassword,newPassword:oldPassword,confirmPassword:oldPassword})).json.error,'password_unchanged');
  const saved=await change({currentPassword:oldPassword,newPassword,confirmPassword:newPassword});
  assert.equal(saved.status,200);assert.equal(saved.json.reauthenticate,true);
  assert.ok(saved.setCookies.some(c=>c.startsWith('nc_sid=;')));
  assert.equal(await readSession(existingSession),null);
  assert.equal(await readSession(second.jar.get('nc_sid')),null);
  const fresh=await boot();
  assert.equal((await call('/api/auth/login',{body:{email,password:oldPassword},jar:fresh.jar,csrf:fresh.csrf})).status,401);
  assert.equal((await call('/api/auth/login',{body:{email,password:newPassword},jar:fresh.jar,csrf:fresh.csrf})).status,200);
});

test('账号安全：当前密码连续输错持久化限流',{skip},async()=>{
  const email=newEmail(),first=await requestEmailCaptcha(email);
  absorb(first.jar,(await call('/api/auth/verify',{body:{emailCaptcha:first.code},jar:first.jar,csrf:first.csrf})).setCookies);
  await call('/api/profile',{body:{password:'Existing-password-2026',nickname:'限流测试'},jar:first.jar,csrf:first.csrf});
  let id;
  try{
    id=(await readSession(first.jar.get('nc_sid'))).user.id;
    for(let i=0;i<5;i++)assert.equal((await call('/api/profile/password',{body:{currentPassword:'wrong-password',newPassword:'New-password-2026',confirmPassword:'New-password-2026'},jar:first.jar,csrf:first.csrf})).status,403);
    const limited=await call('/api/profile/password',{body:{currentPassword:'Existing-password-2026',newPassword:'New-password-2026',confirmPassword:'New-password-2026'},jar:first.jar,csrf:first.csrf});
    assert.equal(limited.status,429);assert.equal(limited.json.error,'rate_limited');
    assert.ok(await readSession(first.jar.get('nc_sid')));
  }finally{if(id)await execute("DELETE FROM rate_events WHERE kind='password_change' AND subject=?",[subjectOf(`password-change:${id}`)]);}
});

test('令牌与挑战的形态', () => {
  assert.match(hashToken('abc'), /^[0-9a-f]{64}$/);
  assert.match(createChallenge(), /^[A-Za-z0-9_-]{22}$/);
  assert.match(subjectOf('someone@example.test'), /^[0-9a-f]{64}$/);
});

test('回跳白名单：只收站内路径', () => {
  assert.equal(safeNext('/projects/'), '/projects/');
  assert.equal(safeNext('//evil.com/x'), '');
  assert.equal(safeNext('http://evil.com/'), '');
  assert.equal(safeNext('javascript:alert(1)'), '');
  assert.equal(safeNext('/login/'), '');
});

test('没有令牌时 readSession 直接返回 null', async () => {
  assert.equal(await readSession(''), null);
});

test('公开页面完全不受认证状态影响', async () => {
  for(const route of ['/', '/about/', '/login/', '/401/']){
    const response = await call(route, {method: 'GET'});
    assert.equal(response.status, 200, `${route} 仍应正常渲染`);
    assert.equal(response.headers['x-nanocamp-source'], 'dynamic');
  }
});

test('只有连接类错误才算「库不可用」，SQL 写错不算', () => {
  for(const code of ['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR'])
    assert.equal(isUnavailable({code}), true, `${code} 应判为不可用`);
  for(const code of ['ER_NO_SUCH_TABLE', 'ER_PARSE_ERROR', 'ER_DUP_ENTRY', undefined])
    assert.equal(isUnavailable({code}), false, `${code} 不应判为不可用`);
});
