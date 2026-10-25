import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleRequest } from '../backend/app.mjs';

const get = url => handleRequest({ method: 'GET', url, headers: {} });
const pageHtml = async url => (await get(url)).body.toString('utf8');

// 渲染层断言：页面结构、三条路径的默认状态、字段类型。
// 真正的交互在浏览器里跑（这里不启动 DOM），接口行为由 tests/auth-api.test.mjs 覆盖。

test('/login/ 首页就能输密码：默认是邮箱 + 密码面板', async () => {
  const page = await pageHtml('/login/');
  assert.match(page, /<input id="login-password"[^>]*type="password"/, '登录页必须能输密码');
  assert.match(page, /data-auth-step="password"/);
  assert.equal(/data-auth-step="password" hidden/.test(page), false, '密码面板应默认显示');
  assert.equal((page.match(/<h1[ >]/g) || []).length, 1, '只应有一个主标题');
});

test('验证码是第二条路径，两个面板默认隐藏', async () => {
  const page = await pageHtml('/login/');
  assert.match(page, /data-auth-step="request" hidden/);
  assert.match(page, /data-auth-step="verify" hidden/);
  assert.match(page, /data-auth-to="request"[^>]*>改用邮箱验证码登录/);
  assert.match(page, /data-auth-to="password"[^>]*>改用密码登录/);
});

test('验证码是单个输入框，可粘贴', async () => {
  const page = await pageHtml('/login/');
  assert.match(page, /id="login-captcha"[^>]*inputmode="numeric"[^>]*autocomplete="one-time-code"[^>]*maxlength="6"/);
  assert.match(page, /data-auth-reveal/, '密码框应带显示/隐藏按钮');
});

test('登录页是 noindex 状态页，且不再指向已删除的 /signup/', async () => {
  const page = await pageHtml('/login/');
  assert.match(page, /<meta name="robots" content="noindex, follow">/);
  assert.match(page, /<link rel="canonical" href="[^"]*\/login\/">/);
  assert.equal(page.includes('/signup/'), false, '不应残留注册页链接');
  // 注册并入登录这件事只讲一次（见下一条），这里只确认那句话在页面上。
  assert.match(page, /第一次邮箱登录/);
});

test('「第一次邮箱登录就是注册」只有一句，排在「改用邮箱验证码登录」下面，字号小于标题', async () => {
  const page = await pageHtml('/login/');
  const altIndex = page.indexOf('改用邮箱验证码登录');
  const claimIndex = page.indexOf('class="auth-claim"');
  assert.ok(altIndex > -1 && claimIndex > altIndex, '这句提示应在「改用邮箱验证码登录」之后');
  // 下划线就是首页首屏那条曲线：蓝字 + 绿色手绘感描边，缺了它观感就散了。
  assert.match(page, /<strong class="auth-claim-art">就是注册<svg[^>]*><path d="M6 13Q160-2 352 10M27 18Q170 7 330 17"\/><\/svg><\/strong>/);
  // 讲注册的句子只出现一次：上面的说明不再重复「会自动创建账号」。
  assert.equal((page.match(/就是注册/g) || []).length, 1);
  assert.equal(/会自动创建账号|自动创建/.test(page), false, '同一件事不该两处都写');
  assert.match(page, /href="\/auth\.css"/, '这句的版式在 auth.css 里');
});

test('auth.css 与 auth.js 只在登录页加载', async () => {
  const login = await pageHtml('/login/');
  assert.match(login, /<link rel="stylesheet" href="\/auth\.css">/);
  assert.match(login, /<script defer src="\/auth\.js"><\/script>/);
  const about = await pageHtml('/about/');
  assert.equal(about.includes('/auth.css'), false, '其它页面不应加载登录页样式');
  assert.equal(about.includes('/auth.js'), false, '其它页面不应加载登录页脚本');
});

test('被删掉的 /signup/ 直接 404', async () => {
  const response = await get('/signup/');
  assert.equal(response.status, 404);
  assert.equal(response.headers['x-nanocamp-source'], 'notfound');
});

test('/profile/force/ 未登录时直接跳登录页', async () => {
  const response = await get('/profile/force/');
  assert.equal(response.status, 303, '没登录不该先给一张表单');
  const location = response.headers.location;
  assert.match(location, /^\/login\/\?next=/);
  assert.match(decodeURIComponent(location), /^\/login\/\?next=\/profile\/force\/\?next=/);
});

test('/profile/force/ 与 /profile/、/profile/password/ 都不在静态路由表里（它们按会话渲染）', async () => {
  const {routePaths} = await import('../src/pages.mjs');
  for (const route of ['/profile/force/', '/profile/', '/profile/password/'])
    assert.equal(routePaths.includes(route), false, route + ' 不该出现在静态路由表里');
});
