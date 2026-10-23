// 个人资料：**一个模板 + 三个页面壳**。
//
// 为什么不拆成好几套字段表：它们要填的是同一批字段、共用一套校验。
//
//   profileCard({missing})      —— 补全页的模板，**哪些字段必填由 missing 决定**（服务端算好传进来）；
//   renderProfileForce(missing) —— 补全页的完整文档（/profile/force/），首次登录的门槛。
//   renderProfile(user)         —— 常规资料页（/profile/），可改昵称与介绍，邮箱只读。
//   renderPassword(user)        —— 改密码页（/profile/password/），要旧密码 + 两遍新密码。
//
// 后两个共用同一套「左侧栏 + 右侧卡片」骨架（settingsCard），所以切页时左栏看起来没动过。
// 三个页面都是**按会话渲染**，走 backend/app.mjs 的 sessionRoutes（不进缓存）。
// 以后新增必填字段：backend/auth.mjs 的 PROFILE_FIELDS 加一项 + 这里加一个字段块，
// 部分有部分没有的情况天然支持 —— 页面只把 missing 里的那几项标成必填。
import {esc, documentPage} from './components.mjs';
import {eyeButton} from './auth.mjs';

/**
 * 资料表单（补全页专用）。
 *
 * 必填与否由 `missing` 决定（服务端来自 PROFILE_FIELDS）。这样「有的字段有、有的没有」
 * 不需要任何特判：缺什么就把什么标成必填，填过的就变成可选的「修改」。
 * @param {object} [options] 参数。
 * @param {string[]} [options.missing] 还缺哪些必填项（'password' 等）。
 * @returns {string} 表单 HTML。
 */
export function profileCard({missing = [], user = {}} = {}){
  const needPassword = missing.includes('password');
  const needNickname = missing.includes('nickname');
  return `<form class="auth-card" action="/profile/force/" method="post" data-profile-form novalidate>
      <div class="auth-card-head"><span class="mono">MEMBER PROFILE</span><span class="auth-card-mark" aria-hidden="true">NC / 02</span></div>
      <h1 class="auth-card-title" id="profile-title">${needPassword || needNickname? '完善你的资料': '个人资料'}</h1>
      <p class="auth-card-note" data-profile-note>${needPassword || needNickname? '第一次登录要把必填项填完，之后可以随时回来修改。': '改完保存即可，密码留空表示不改。'}</p>

      <div class="form-field">
        <span class="field-label">邮箱</span>
        <p class="auth-readonly" id="profile-email" data-profile-email>—</p>
      </div>

      <div class="form-field" data-profile-nickname>
        <div class="auth-label-row">
          <label for="profile-nickname">昵称</label>
          <span class="auth-required" data-profile-nickname-required${needNickname? '': ' hidden'}>必填</span>
          <span class="auth-optional"${needNickname? ' hidden': ''}>可选</span>
        </div>
        <input id="profile-nickname" maxlength="24" placeholder="怎么称呼你" autocomplete="nickname" value="${esc(user.nickname || '新伙伴')}">
      </div>

      <div class="form-field" data-profile-password>
        <div class="auth-label-row">
          <label for="profile-password" data-profile-password-label>${needPassword? '设置密码': '修改密码'}</label>
          <span class="auth-required" data-profile-password-required${needPassword? '': ' hidden'}>必填</span>
          <span class="auth-optional"${needPassword? ' hidden': ''}>可选</span>
        </div>
        <div class="auth-input">
          <input id="profile-password" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder="${needPassword? '至少 8 位字符': '留空表示不修改'}" aria-describedby="profile-password-hint">
          ${eyeButton('profile-password')}
        </div>
        <span class="field-note" id="profile-password-hint">至少 8 位。设置后邮箱 + 密码、邮箱验证码两种方式都能登录。</span>
      </div>

      <div class="form-field" data-profile-bio>
        <div class="auth-label-row">
          <label for="profile-bio">一句话介绍</label>
          <span class="auth-optional">可选</span>
        </div>
        <input id="profile-bio" maxlength="160" placeholder="你在做什么" autocomplete="off">
      </div>

      <button class="button button-primary auth-submit" type="submit"><span class="button-label">保存并继续</span><span class="button-plus" aria-hidden="true">+</span></button>
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

// ---------------- 设置页（左侧栏 + 右侧卡片） ----------------

/** 左栏的两项。顺序即展示顺序；`key` 同时用来标 aria-current。 */
const PROFILE_TABS = [
  {key: 'general', index: '01', href: '/profile/', label: '常规'},
  {key: 'password', index: '02', href: '/profile/password/', label: '密码'}
];

/**
 * 左侧栏。两个设置页共用同一份结构与同一组链接 —— 切页时它不该有任何视觉变化，
 * 所以这里不传入任何「当前页之外」的信息，只标 aria-current。
 * @param {string} active 当前页的 key。
 * @returns {string} 侧栏 HTML。
 */
function profileAside(active){
  return `<nav class="profile-nav" aria-label="资料设置">
      <span class="profile-nav-label mono" aria-hidden="true">SETTINGS</span>
      ${PROFILE_TABS.map(tab => `<a class="profile-tab" href="${tab.href}"${active === tab.key? ' aria-current="page"': ''}><span class="profile-tab-index mono">${tab.index}</span><span class="profile-tab-label">${tab.label}</span></a>`).join('')}
    </nav>`;
}

/**
 * 设置页骨架：左栏 + 右侧表单卡。两个页面只差字段与提交按钮，其余（标题区、状态行、退出）完全一样。
 * @param {object} options 参数。
 * @param {string} options.active 当前页 key（general / password）。
 * @param {string} options.mark 卡片右上角的编号。
 * @param {string} options.title 主标题。
 * @param {string} options.note 标题下那句说明。
 * @param {string} options.fields 字段块。
 * @param {string} options.submit 主按钮文案。
 * @param {string} options.formAttributes form 上的附加属性（data-* 与 action）。
 * @returns {string} 页面正文。
 */
function settingsCard({active, mark, title, note, fields, submit, formAttributes}){
  return `<section class="profile-page container" aria-labelledby="profile-title">
  <div class="profile-layout">
    ${profileAside(active)}
    <div class="profile-content">
      <form class="auth-card" ${formAttributes} novalidate>
        <div class="auth-card-head"><span class="mono">MEMBER SETTINGS</span><span class="auth-card-mark" aria-hidden="true">${mark}</span></div>
        <h1 class="auth-card-title" id="profile-title">${title}</h1>
        <p class="auth-card-note">${note}</p>
        ${fields}
        <button class="button button-primary auth-submit" type="submit"><span class="button-label">${submit}</span><span class="button-plus" aria-hidden="true">+</span></button>
        <p class="auth-status" role="status" aria-live="polite" data-auth-status></p>
        <noscript><p class="auth-status" data-tone="error">保存资料需要浏览器启用 JavaScript。</p></noscript>
        <p class="auth-alt"><button type="button" class="auth-link" data-profile-logout>退出登录</button></p>
      </form>
    </div>
  </div>
</section>`;
}

/**
 * 常规资料页（`/profile/`）：昵称与一句话介绍可改，**邮箱只显示不可改**，也不在这里改密码。
 *
 * 字段值直接由服务端渲染（这一页本来就按会话渲染），不用等 /api/session 回来再填，
 * 所以打开就是当前值，不会先闪一下空白。
 * @param {object} user 已登录用户。
 * @returns {string} 页面正文。
 */
export function profileView(user){
  const fields = `<div class="form-field">
          <span class="field-label">邮箱</span>
          <p class="auth-readonly" id="profile-email" data-profile-email>${esc(user.email)}</p>
          <span class="field-note">邮箱是登录账号，目前不能在这里修改。</span>
        </div>

        <div class="form-field">
          <div class="auth-label-row">
            <label for="profile-nickname">昵称</label>
            <span class="auth-required" data-profile-nickname-required>必填</span>
          </div>
          <input id="profile-nickname" name="nickname" maxlength="24" autocomplete="nickname" placeholder="怎么称呼你" value="${esc(user.nickname || '')}">
        </div>

        <div class="form-field">
          <div class="auth-label-row">
            <label for="profile-bio">一句话介绍</label>
            <span class="auth-optional">可选</span>
          </div>
          <input id="profile-bio" name="bio" maxlength="160" autocomplete="off" placeholder="你在做什么" value="${esc(user.bio || '')}">
        </div>`;
  return settingsCard({
    active: 'general',
    mark: 'NC / 03',
    title: '常规资料',
    note: '昵称与介绍会显示在你的公开主页上；邮箱只用于登录，不对外展示。',
    fields,
    submit: '保存修改',
    formAttributes: 'action="/profile/" method="post" data-profile-form data-profile-mode="edit"'
  });
}

/**
 * 改密码页（`/profile/password/`）：要旧密码 + 两遍新密码。
 *
 * 改完**必须退出登录**：服务端会把该账号的所有会话一起撤掉（见 backend/auth.mjs 的 changePassword），
 * 客户端只负责跳回登录页。
 * @param {object} user 已登录用户。
 * @returns {string} 页面正文。
 */
export function passwordView(user){
  const fields = `<div class="form-field">
          <label for="password-current">当前密码</label>
          <div class="auth-input">
            <input id="password-current" type="password" autocomplete="current-password" placeholder="输入现在的密码" aria-describedby="password-current-hint">
            ${eyeButton('password-current')}
          </div>
          <span class="field-note" id="password-current-hint">先确认是你本人。</span>
        </div>

        <div class="form-field">
          <label for="password-new">新密码</label>
          <div class="auth-input">
            <input id="password-new" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder="至少 8 位字符" aria-describedby="password-new-hint">
            ${eyeButton('password-new')}
          </div>
          <span class="field-note" id="password-new-hint">8–72 位。改完会退出登录，用新密码重新登录。</span>
        </div>

        <div class="form-field">
          <label for="password-confirm">再输一次新密码</label>
          <div class="auth-input">
            <input id="password-confirm" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder="再输一遍">
            ${eyeButton('password-confirm')}
          </div>
        </div>`;
  return settingsCard({
    active: 'password',
    mark: 'NC / 04',
    title: '修改密码',
    note: `当前账号：${esc(user.email)}。改完会退出登录，其他设备上的登录也会失效。`,
    fields,
    submit: '保存新密码',
    formAttributes: 'action="/profile/password/" method="post" data-password-form'
  });
}

/**
 * 常规资料页的完整文档。
 * @param {object} user 已登录用户。
 * @returns {string} 完整 HTML。
 */
export function renderProfile(user){
  return documentPage({
    title: '常规资料 · NanoCamp',
    description: '修改 NanoCamp 账号的昵称与一句话介绍；邮箱只用于登录，不对外展示。',
    active: 'profile',
    noindex: true,
    body: profileView(user)
  });
}

/**
 * 改密码页的完整文档。
 * @param {object} user 已登录用户。
 * @returns {string} 完整 HTML。
 */
export function renderPassword(user){
  return documentPage({
    title: '修改密码 · NanoCamp',
    description: '修改 NanoCamp 账号的登录密码：需要输入当前密码，改完会自动退出登录。',
    active: 'profile',
    noindex: true,
    body: passwordView(user)
  });
}
