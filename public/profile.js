// 个人资料相关的两件事，共用一份脚本：
//   /profile/force/ —— 补全/编辑表单（页面上有 [data-profile-form]）
//   /profile/       —— 只读查看 + 退出登录（没有表单，只有 [data-profile-logout]）
//
// 表单部分在没有表单的页面直接跳过；退出登录两个页面都能用。
(() => {
  const form = document.querySelector('[data-profile-form]');
  const logout = document.querySelector('[data-profile-logout]');
  if (!form && !logout) return;

  // 只接受站内路径（与 public/auth.js 同规则，客户端这层只是防误跳）。
  function safeTarget(raw) {
    const value = String(raw || '').trim();
    if (!value || value.length > 2000) return '';
    if (/[\\\u0000-\u001f\u007f]/.test(value)) return '';
    if (!value.startsWith('/') || value.startsWith('//')) return '';
    try {
      const url = new URL(value, location.origin);
      return url.origin === location.origin ? url.pathname + url.search + url.hash : '';
    } catch {
      return '';
    }
  }

  const status = document.querySelector('[data-auth-status]');
  let csrf = '';
  let busy = false;

  const setStatus = (message, tone = '') => {
    if (!status) return;
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };

  const explain = (httpStatus, error) => {
    if (httpStatus === 503 || error === 'unavailable') return '账号系统暂时不可用，稍后再试。';
    if (error === 'unauthenticated') return '登录状态已失效，请重新登录。';
    if (error === 'invalid_password') return '密码需要 8–72 位字符。';
    if (error === 'invalid_profile') return '有字段超出了长度限制，检查一下再保存。';
    if (error === 'forbidden') return '页面已经过期，刷新后重试。';
    return '网络不太顺畅，稍后再试一次。';
  };

  const loadCsrf = async () => {
    try {
      const response = await fetch('/api/session', { credentials: 'same-origin' });
      const session = await response.json().catch(() => ({}));
      csrf = session.csrf || '';
      return session;
    } catch {
      return null;
    }
  };

  // 退出登录：两个页面共用。
  logout?.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    logout.disabled = true;
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nc-csrf': csrf },
        credentials: 'same-origin'
      });
      if (!response.ok) {
        // 服务端没撤掉会话就别装作退出成功：提示一下，让人可以重试。
        setStatus(explain(response.status, 'unavailable'), 'error');
        busy = false;
        logout.disabled = false;
        return;
      }
    } catch {
      setStatus(explain(0), 'error');
      busy = false;
      logout.disabled = false;
      return;
    }
    location.replace('/login/');
  });

  // 只读资料页：没有表单，拿一次 CSRF 就够了（退出登录要用）。
  if (!form) {
    loadCsrf();
    return;
  }

  const next = safeTarget(new URLSearchParams(location.search).get('next'));
  const emailSlot = form.querySelector('[data-profile-email]');
  const passwordRequired = form.querySelector('[data-profile-password-required]');
  const passwordInput = form.querySelector('#profile-password');
  const nicknameInput = form.querySelector('#profile-nickname');
  const nicknameRequired = form.querySelector('[data-profile-nickname-required]');
  const bioInput = form.querySelector('#profile-bio');
  const reveal = form.querySelector('[data-auth-reveal]');

  // 必填与否由服务端渲染好了（见 src/profile.mjs），客户端只读结果，不再自己判断。
  const needsPassword = !passwordRequired.hidden;
  const needsNickname = !nicknameRequired.hidden;

  // 没登录就直接送去登录页，登录完回到这里。
  const toLogin = () => location.replace(`/login/?next=${encodeURIComponent(location.pathname + location.search)}`);

  (async () => {
    const session = await loadCsrf();
    if (!session) {
      setStatus('无法连接服务器，刷新页面重试。', 'error');
      return;
    }
    if (!session.user) {
      toLogin();
      return;
    }
    emailSlot.textContent = session.user.email;
    nicknameInput.value = session.user.nickname || '新伙伴';
    bioInput.value = session.user.bio || '';
    (needsPassword ? passwordInput : nicknameInput).focus({ preventScroll: true });
  })();

  reveal?.addEventListener('click', () => {
    const visible = passwordInput.type === 'text';
    passwordInput.type = visible ? 'password' : 'text';
    reveal.setAttribute('aria-pressed', String(!visible));
    reveal.setAttribute('aria-label', visible ? '显示密码' : '隐藏密码');
    passwordInput.focus({ preventScroll: true });
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;

    const nickname = (nicknameInput.value || '').trim();
    if (needsNickname && !nickname) {
      setStatus('先填一个昵称。', 'error');
      nicknameInput.focus();
      return;
    }
    if (nickname.length > 24) {
      setStatus('昵称最多 24 个字符。', 'error');
      nicknameInput.focus();
      return;
    }

    const password = passwordInput.value || '';
    if (needsPassword && password.length < 8) {
      setStatus('先设置一个至少 8 位的密码。', 'error');
      passwordInput.focus();
      return;
    }
    if (password && (password.length < 8 || password.length > 72)) {
      setStatus('密码需要 8–72 位字符。', 'error');
      passwordInput.focus();
      return;
    }

    const body = { nickname, bio: bioInput.value || '' };
    if (password) body.password = password;

    busy = true;
    form.setAttribute('aria-busy', 'true');
    setStatus('正在保存…');
    try {
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nc-csrf': csrf },
        body: JSON.stringify(body),
        credentials: 'same-origin'
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 200 && payload?.ok) {
        setStatus('已保存，正在继续…');
        location.assign(next || '/');
        return;
      }
      if (payload?.error === 'unauthenticated') {
        toLogin();
        return;
      }
      setStatus(explain(response.status, payload?.error), 'error');
    } catch {
      setStatus(explain(0), 'error');
    } finally {
      busy = false;
      form.removeAttribute('aria-busy');
    }
  });
})();
