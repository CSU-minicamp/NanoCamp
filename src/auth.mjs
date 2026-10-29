// 登录页（注册并入登录：邮箱首次验证通过即自动建号，不再有独立的注册页）。
// 顶栏导航、页脚、加入弹窗都来自 components.mjs 的 documentPage，这里只写正文卡片。
//
// 卡片里有三条路径，由 public/auth.js 切换（data-auth-step）：
//   password —— 邮箱 + 密码登录（默认，这是「登录」最该有的形态）
//   request  —— 改用验证码：发一封 6 位码
//   verify   —— 填验证码登录；邮箱首次验证通过时自动建号
// 邮箱输入框放在三个面板之外共用，切换时不用重新填。
//
// 跳转参数（?next=…）不在渲染期处理 —— 后端按路由缓存渲染结果、不解析查询串，
// 所以回跳目标一律由 public/auth.js 在客户端读取并校验。详见那里的 safeTarget()。
import {EMAIL_MAX} from '../common/limits.mjs';

const eyeOpen = '<svg class="auth-eye-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.6 12S6.2 5.6 12 5.6 21.4 12 21.4 12 17.8 18.4 12 18.4 2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="3.1"/></svg>';
const eyeClosed = '<svg class="auth-eye-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.2 4.4 20.8 19.6"/><path d="M10.5 6.2A9.3 9.3 0 0 1 12 6.1c5.8 0 9.4 5.9 9.4 5.9a16.4 16.4 0 0 1-3.3 3.8M6.4 8.1A16.6 16.6 0 0 0 2.6 12S6.2 17.9 12 17.9a9.6 9.6 0 0 0 3.5-.6"/><path d="M9.7 10.2a3.2 3.2 0 0 0 4.4 4.4"/></svg>';

// 「显示 / 隐藏密码」：图标按钮，睁眼=明文，闭眼=密文；图标切换交给 CSS，脚本只翻 aria-pressed。
export const eyeButton = id => `<button type="button" class="auth-reveal" data-auth-reveal aria-controls="${id}" aria-pressed="false" aria-label="显示密码">${eyeOpen}${eyeClosed}</button>`;

export function loginPage() {
  return `<section class="auth-page container" aria-labelledby="login-title">
  <div class="auth-panel">
    <form class="auth-card" action="/login/" method="post" data-auth-form novalidate>
      <div class="auth-card-head"><span class="mono">MEMBER LOGIN</span><span class="auth-card-mark" aria-hidden="true">NC / 01</span></div>
      <h1 class="auth-card-title" id="login-title">登录 NanoCamp</h1>
      <p class="auth-card-note">用邮箱和密码登录，忘记密码可以改用验证码。</p>

      <div class="form-field">
        <label for="login-email">邮箱</label>
        <input id="login-email" name="email" type="email" inputmode="email" autocomplete="username" maxlength="${EMAIL_MAX}" placeholder="you@example.com">
      </div>

      <div data-auth-step="password">
        <div class="form-field">
          <label for="login-password">密码</label>
          <div class="auth-input">
            <input id="login-password" name="password" type="password" autocomplete="current-password" minlength="8" maxlength="72" placeholder="输入密码" aria-describedby="login-password-hint">
            ${eyeButton('login-password')}
          </div>
          <span class="field-note" id="login-password-hint">还没有密码？用验证码登录一次就能开始。</span>
        </div>
        <button class="button button-primary auth-submit" type="submit"><span class="button-label">登录</span><span class="button-plus" aria-hidden="true">+</span></button>
        <p class="auth-alt"><button type="button" class="auth-link" data-auth-to="request">改用邮箱验证码登录</button></p>
        <p class="auth-claim" data-login-claim><span>第一次邮箱登录，</span><strong class="auth-claim-art">就是注册<svg viewBox="0 0 360 20" preserveAspectRatio="none" aria-hidden="true"><path d="M6 13Q160-2 352 10M27 18Q170 7 330 17"/></svg></strong></p>
      </div>

      <div data-auth-step="request" hidden>
        <p class="auth-note">我们会把 6 位验证码发到上面的邮箱，10 分钟内有效。</p>
        <button class="button button-primary auth-submit" type="submit"><span class="button-label">获取验证码</span><span class="button-plus" aria-hidden="true">+</span></button>
        <p class="auth-alt"><button type="button" class="auth-link" data-auth-to="password">改用密码登录</button></p>
      </div>

      <div data-auth-step="verify" hidden>
        <p class="auth-sent">验证码已发送到 <b data-auth-email></b><button type="button" class="auth-link" data-auth-change>改邮箱</button></p>
        <div class="form-field">
          <label for="login-captcha">验证码</label>
          <input id="login-captcha" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="6 位数字" class="auth-code" aria-describedby="login-captcha-hint">
          <span class="field-note" id="login-captcha-hint">10 分钟内有效，只能用一次；重新发送后旧验证码立即失效。</span>
        </div>
        <button class="button button-primary auth-submit" type="submit"><span class="button-label">验证并登录</span><span class="button-plus" aria-hidden="true">+</span></button>
        <p class="auth-resend">没收到？<button type="button" class="auth-link" data-auth-resend>重新发送</button></p>
      </div>

      <p class="auth-status" role="status" aria-live="polite" data-auth-status></p>
      <noscript><p class="auth-status" data-tone="error">登录需要浏览器启用 JavaScript。也可以先到<a class="text-link" href="/community/">社区参与指南</a>看看怎样加入。</p></noscript>
    </form>
  </div>
</section>`;
}
