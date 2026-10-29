// 个人资料：**一个模板 + 一个页面壳**。
//
// 本模块保留首次注册补全；日常公开资料与账号安全由 account.mjs 分别呈现。
// POST /api/profile 只允许首次设置密码，已有密码必须走独立验证接口。
//
// 所以：
//   profileCard({missing}) —— 模板，只管渲染表单；**哪些字段必填由 missing 决定**（服务端算好传进来）。
//   renderProfileForce(missing) —— 补全页的完整文档（/profile/force/ 用它）。
//   renderProfile(user)        —— 查看页的完整文档（/profile/ 用它）。
//
// 两个页面都是**按会话渲染**，走 backend/app.mjs 的 sessionRoutes（不进缓存）。
// 以后新增必填字段：backend/auth.mjs 的 PROFILE_FIELDS 加一项 + 这里加一个字段块，
// 部分有部分没有的情况天然支持 —— 页面只把 missing 里的那几项标成必填。
import {esc, documentPage} from './components.mjs';
import {eyeButton} from './auth.mjs';
import {BIO_MAX,NICKNAME_MAX,PASSWORD_MAX,PASSWORD_MIN} from '../common/limits.mjs';
import {NICKNAME_FORBIDDEN_SOURCE} from '../common/nickname.mjs';

/**
 * 资料表单。
 *
 * 必填与否由 `missing` 决定（服务端来自 PROFILE_FIELDS）。这样「有的字段有、有的没有」
 * 不需要任何特判：缺什么就把什么标成必填，填过的就变成可选的「修改」。
 * @param {object} [options] 参数。
 * @param {string[]} [options.missing] 还缺哪些必填项（'password' 等）。
 * @returns {string} 表单 HTML。
 */
export function profileCard({missing = [], user = {}, inline = false} = {}){
  const needPassword = missing.includes('password');
  const needNickname = missing.includes('nickname');
  return `<form class="${inline?'f-account-form':'auth-card'}" action="${inline?'/profile/':'/profile/force/'}" method="post" data-profile-form ${inline?'data-profile-inline':''} novalidate>
      ${inline?'':'<div class="auth-card-head"><span class="mono">MEMBER PROFILE</span><span class="auth-card-mark" aria-hidden="true">NC / 02</span></div>'}
      <h1 class="auth-card-title" id="profile-title">${inline?'我的资料':needPassword || needNickname? '完善你的资料': '个人资料'}</h1>
      <p class="auth-card-note" data-profile-note>${needPassword || needNickname? '第一次登录要把必填项填完，之后可以随时回来修改。': '改完保存即可，密码留空表示不改。'}</p>

      <div class="form-field">
        <label for="profile-email">邮箱</label>
        <p class="auth-readonly" id="profile-email" data-profile-email>${esc(user.email||'—')}</p>
      </div>

      <div class="form-field" data-profile-nickname>
        <div class="auth-label-row">
          <label for="profile-nickname">昵称</label>
          <span class="auth-required" data-profile-nickname-required${needNickname? '': ' hidden'}>必填</span>
          <span class="auth-optional"${needNickname? ' hidden': ''}>可选</span>
        </div>
        <input id="profile-nickname" data-nickname-forbidden="${NICKNAME_FORBIDDEN_SOURCE}" placeholder="怎么称呼你" autocomplete="nickname" data-max="${NICKNAME_MAX}" value="${esc(user.nickname || '新伙伴')}">
      </div>

      ${needPassword?`<div class="form-field" data-profile-password>
        <div class="auth-label-row">
          <label for="profile-password" data-profile-password-label>${needPassword? '设置密码': '修改密码'}</label>
          <span class="auth-required" data-profile-password-required${needPassword? '': ' hidden'}>必填</span>
          <span class="auth-optional"${needPassword? ' hidden': ''}>可选</span>
        </div>
        <div class="auth-input">
          <input id="profile-password" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" maxlength="${PASSWORD_MAX}" placeholder="${needPassword? `至少 ${PASSWORD_MIN} 位字符`: '留空表示不修改'}" aria-describedby="profile-password-hint">
          ${eyeButton('profile-password')}
        </div>
        <span class="field-note" id="profile-password-hint">至少 8 位。设置后邮箱 + 密码、邮箱验证码两种方式都能登录。</span>
      </div>`:''}

      <div class="form-field" data-profile-bio>
        <div class="auth-label-row">
          <label for="profile-bio">一句话介绍</label>
          <span class="auth-optional">可选</span>
        </div>
        <input id="profile-bio" placeholder="你在做什么" autocomplete="off" data-max="${BIO_MAX}" value="${esc(user.bio||'')}">
      </div>

      <button class="${inline?'f-primary':'button button-primary'} auth-submit" type="submit"><span class="button-label">${inline?'保存资料':'保存并继续'}</span>${inline?'':'<span class="button-plus" aria-hidden="true">+</span>'}</button>
      <p class="auth-status" role="status" aria-live="polite" data-auth-status></p>
      <noscript><p class="auth-status" data-tone="error">保存资料需要浏览器启用 JavaScript。</p></noscript>
      <p class="auth-alt"><button type="button" class="auth-link" data-profile-logout>退出登录</button></p>
    </form>`;
}

/**
 * 补全页（`/profile/force/`）的完整文档。
 * @param {string[]} missing 还缺哪些必填项。
 * @param {object} [user] 当前用户（昵称用来预填，默认「新伙伴」）。
 * @returns {string} 完整 HTML。
 */
export function renderProfileForce(missing, user = {}){
  return documentPage({
    title: '完善资料 · NanoCamp',
    description: '补全 NanoCamp 账号的必填资料，设置密码后即可用邮箱和密码登录。',
    active: 'profile',
    noindex: true,
    body: `<section class="auth-page container" aria-labelledby="profile-title">
  <div class="auth-panel">
    ${profileCard({missing, user})}
  </div>
</section>`
  });
}

/**
 * 资料查看页（`/profile/`）：只显示本人的信息。
 *
 * 这一页按会话渲染，**不能进渲染缓存** —— 同一个 URL 对不同人返回不同内容。
 * 所以它不在路由表里，由 backend/app.mjs 单独处理（见那里的 handleProfile）。
 * @param {object} user 已登录用户。
 * @returns {string} 页面正文。
 */
export function profileView(user){
  const row = (label, value) => `<div class="profile-row"><dt>${label}</dt><dd>${value}</dd></div>`;
  return `<section class="auth-page container" aria-labelledby="profile-title">
  <div class="auth-panel">
    <div class="auth-card">
      <div class="auth-card-head"><span class="mono">MEMBER PROFILE</span><span class="auth-card-mark" aria-hidden="true">NC / 03</span></div>
      <h1 class="auth-card-title" id="profile-title">我的资料</h1>
      <p class="auth-card-note">这一页只显示你自己的信息，别人看不到。</p>
      <p><a class="text-link" href="/forum/?view=topics">我的论坛参与 →</a></p>
      <dl class="profile-list">
        <div class="profile-row"><dt>邮箱</dt><dd>${esc(user.email)}</dd></div>
        <div class="profile-row"><dt>昵称</dt><dd>${user.nickname? esc(user.nickname): '<span class="profile-empty">未填写</span>'}</dd></div>
        <div class="profile-row"><dt>一句话介绍</dt><dd>${user.bio? esc(user.bio): '<span class="profile-empty">未填写</span>'}</dd></div>
      </dl>
      <a class="button button-primary auth-submit" href="/profile/force/?next=%2Fprofile%2F"><span class="button-label">${user.hasPassword? '修改密码': '设置密码'}</span><span class="button-plus" aria-hidden="true">+</span></a>
      <p class="auth-alt"><button type="button" class="auth-link" data-profile-logout>退出登录</button></p>
      <p class="auth-status" role="status" aria-live="polite" data-auth-status></p>
    </div>
  </div>
</section>`;
}

/**
 * 资料页的完整文档。
 * @param {object} user 已登录用户。
 * @returns {string} 完整 HTML。
 */
export function renderProfile(user){
  return documentPage({
    title: '我的资料 · NanoCamp',
    description: '查看当前账号的邮箱、昵称与资料完整度。',
    active: 'profile',
    noindex: true,
    body: profileView(user)
  });
}
