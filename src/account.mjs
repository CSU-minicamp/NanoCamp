import {esc,accountAvatar} from './components.mjs';
import {AVATAR_MAX_BYTES,BIO_MAX,NICKNAME_MAX} from '../common/limits.mjs';

export function accountProfile(user){return `<section class="f-main-list f-settings">
<header class="f-settings-heading"><div><h1>个人资料</h1><p>你在社区中的公开名片。</p></div><a class="f-text" href="/forum/users/${user.id}/">查看公开主页 ↗</a></header>
<div class="f-settings-content"><div class="f-profile-summary"><span class="f-account-avatar" aria-hidden="true">${accountAvatar(user.id)}</span><div><strong data-profile-display-name>${esc(user.nickname||'新伙伴')}</strong><p data-profile-display-bio>${esc(user.bio||'')}</p><div class="f-avatar-controls"><button type="button" class="f-text" data-select-avatar>修改头像</button><button type="button" class="f-text" data-reset-avatar hidden>恢复默认头像</button></div><p class="f-avatar-hint" id="avatar-file-hint">JPG、PNG 或 WebP，最大 2MB</p><input type="file" accept="image/jpeg,image/png,image/webp" data-avatar-input data-max-bytes="${AVATAR_MAX_BYTES}" aria-label="选择头像图片" aria-describedby="avatar-file-hint" hidden><div class="f-avatar-pending" data-avatar-actions hidden><button type="button" class="f-primary" data-save-avatar>保存头像</button><button type="button" class="f-secondary" data-cancel-avatar>取消</button></div><p class="f-avatar-status" data-avatar-status role="status" aria-live="polite"></p></div></div>
<form data-account-profile class="f-settings-form">
<div class="f-setting-field"><label for="account-nickname">昵称</label><input id="account-nickname" name="nickname" required autocomplete="nickname" value="${esc(user.nickname)}"><p>将显示在你的帖子、回复和个人主页中。<span data-nickname-count data-max="${NICKNAME_MAX}">${Array.from(user.nickname || '').length}/${NICKNAME_MAX}</span></p></div>
<div class="f-setting-field"><label for="account-bio">个人简介</label><textarea id="account-bio" name="bio" rows="4">${esc(user.bio)}</textarea><div class="f-field-meta"><span>介绍一下你的兴趣，或正在做的事。</span><span data-bio-count data-max="${BIO_MAX}">${Array.from(user.bio || '').length}/${BIO_MAX}</span></div></div>
<div class="f-settings-actions"><button class="f-primary" type="submit" disabled>保存修改</button><button class="f-secondary" type="reset" disabled>取消</button><p data-account-status role="status" aria-live="polite"></p></div>
</form></div></section>`;}

export function accountSecurity(user){return `<section class="f-main-list f-settings">
<header class="f-settings-heading"><div><h1>账号安全</h1><p>管理登录方式和账号访问权限。</p></div></header>
<div class="f-settings-content">
<section class="f-security-section"><h2>登录邮箱</h2><p class="f-login-email">${esc(user.email)}</p><p class="f-setting-note">用于登录和接收验证码，不会展示在公开主页。</p></section>
<section class="f-security-section"><details class="f-password-details"><summary><span><h2>登录密码</h2><span class="f-setting-note">${user.hasPassword?'已设置密码':'尚未设置密码'}</span></span><span class="f-text">修改密码 <span aria-hidden="true">⌄</span></span></summary>
${user.hasPassword?`<form data-account-password class="f-settings-form"><p class="f-password-notice">修改后将退出所有已登录设备，请使用新密码重新登录。</p>
<div class="f-setting-field"><label for="current-password">当前密码</label><input id="current-password" name="currentPassword" type="password" required maxlength="72" autocomplete="current-password"></div>
<div class="f-setting-field"><label for="new-password">新密码</label><input id="new-password" name="newPassword" type="password" required minlength="8" maxlength="72" autocomplete="new-password"><p>8–72 个字符，避免使用与其他网站相同的密码。</p></div>
<div class="f-setting-field"><label for="confirm-password">确认新密码</label><input id="confirm-password" name="confirmPassword" type="password" required minlength="8" maxlength="72" autocomplete="new-password"></div>
<div class="f-settings-actions"><button class="f-primary" type="submit">确认修改</button><button class="f-secondary" type="reset" data-cancel-password>取消</button><p data-account-status role="status" aria-live="polite"></p></div></form>`:`<a class="f-text" href="/profile/force/?next=%2Fprofile%2F%3Ftab%3Dsecurity">设置登录密码 →</a>`}
</details></section>
<section class="f-security-section f-security-logout"><div><h2>退出登录</h2><p class="f-setting-note">仅退出当前浏览器中的账号。</p></div><button class="f-secondary" data-account-logout>退出当前账号</button></section><p class="f-account-page-status" data-page-status role="status" aria-live="polite"></p>
</div></section>`;}
