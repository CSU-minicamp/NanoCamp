// 账号设置页的前端逻辑，一份脚本管三个界面（页面上没有的那块自动跳过）：
//
//   /profile/           常规资料（昵称 / 一句话介绍）→ POST /api/profile，存完留在本页
//   /profile/password/  改密码 → POST /api/profile/password；成功后服务端已把该账号的全部会话撤掉，
//                       这里只负责跳回登录页（所以「改完自动退出」是服务端保证的，不靠前端）
//   /profile/force/     首次登录的补全页 → 同一个 /api/profile，存完按 next 继续
//
// 三块都有「退出登录」；改密码的旧密码校验、长度、两遍一致性由服务端再判一次，前端只是先拦一道。
(() => {
  const generalForm = document.querySelector('[data-profile-form]');
  const passwordForm = document.querySelector('[data-password-form]');
  const logout = document.querySelector('[data-profile-logout]');
  if (!generalForm && !passwordForm && !logout) return;

  const status = document.querySelector('[data-auth-status]');
  let csrf = '';
  let busy = false;

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

  const setStatus = (message, tone = '') => {
    if (!status) return;
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };

  const explain = (httpStatus, error) => {
    if (httpStatus === 503 || error === 'unavailable') return '账号系统暂时不可用，稍后再试。';
    if (error === 'unauthenticated') return '登录状态已失效，请重新登录。';
    if (error === 'invalid_password') return '新密码需要 8–72 位字符。';
    if (error === 'invalid_profile') return '昵称不能为空，也不要超出长度限制。';
    if (error === 'current_password_invalid') return '当前密码不对，再试一次。';
    if (error === 'password_not_set') return '这个账号还没有密码，先去补全资料里设置一个。';
    if (error === 'rate_limited') return '试的次数太多了，过几分钟再试。';
    if (error === 'forbidden') return '页面已经过期，刷新后重试。';
    return '网络不太顺畅，稍后再试一次。';
  };

  const toLogin = () => location.replace(`/login/?next=${encodeURIComponent(location.pathname + location.search)}`);

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

  /** POST JSON，带 double-submit 令牌。 */
  async function post(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nc-csrf': csrf },
      body: JSON.stringify(body),
      credentials: 'same-origin'
    });
    const payload = await response.json().catch(() => null);
    return { response, payload };
  }

  // 「显示 / 隐藏密码」：每个眼睛按钮按 aria-controls 找自己那个输入框
  // （改密码页有三个，所以不能像以前那样只绑一个）。
  function bindReveals(root) {
    for (const button of root.querySelectorAll('[data-auth-reveal]')) {
      const input = document.getElementById(button.getAttribute('aria-controls') || '');
      if (!input) continue;
      button.addEventListener('click', () => {
        const visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        button.setAttribute('aria-pressed', String(!visible));
        button.setAttribute('aria-label', visible ? '显示密码' : '隐藏密码');
        input.focus({ preventScroll: true });
      });
    }
  }

  // 退出登录：三个页面共用。
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

  // ---------------- 常规资料 / 补全资料 ----------------
  if (generalForm) {
    const edit = generalForm.getAttribute('data-profile-mode') === 'edit';
    const next = safeTarget(new URLSearchParams(location.search).get('next'));
    const nicknameInput = generalForm.querySelector('#profile-nickname');
    const bioInput = generalForm.querySelector('#profile-bio');
    const passwordInput = generalForm.querySelector('#profile-password');
    const emailSlot = generalForm.querySelector('[data-profile-email]');
    const nicknameRequired = generalForm.querySelector('[data-profile-nickname-required]');
    const passwordRequired = generalForm.querySelector('[data-profile-password-required]');
    // 必填与否由服务端渲染好了（见 src/profile.mjs），客户端只读结果，不再自己判断。
    const needsNickname = nicknameRequired ? !nicknameRequired.hidden : false;
    const needsPassword = passwordRequired ? !passwordRequired.hidden : false;

    bindReveals(generalForm);

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
      // 常规资料页的字段由服务端按会话渲染好了，这里别再覆盖用户已经开始输的内容。
      if (edit) return;
      if (emailSlot) emailSlot.textContent = session.user.email;
      nicknameInput.value = session.user.nickname || '新伙伴';
      bioInput.value = session.user.bio || '';
      (needsPassword ? passwordInput : nicknameInput).focus({ preventScroll: true });
    })();

    generalForm.addEventListener('submit', async event => {
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

      const password = passwordInput ? passwordInput.value || '' : '';
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
      generalForm.setAttribute('aria-busy', 'true');
      setStatus('正在保存…');
      try {
        const { response, payload } = await post('/api/profile', body);
        if (response.status === 200 && payload?.ok) {
          // 补全页存完要继续走（回 next）；常规资料页留在原地，让人接着改。
          if (edit) {
            setStatus('已保存。');
            return;
          }
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
        generalForm.removeAttribute('aria-busy');
      }
    });
  }

  // ---------------- 改密码 ----------------
  if (passwordForm) {
    const currentInput = passwordForm.querySelector('#password-current');
    const nextInput = passwordForm.querySelector('#password-new');
    const confirmInput = passwordForm.querySelector('#password-confirm');

    bindReveals(passwordForm);

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
      // 还没设置过密码的人来这里没意义：服务端也会这么跳，这里只是少走一趟。
      if (Array.isArray(session.missing) && session.missing.includes('password')) {
        location.replace('/profile/force/?next=%2Fprofile%2Fpassword%2F');
        return;
      }
      currentInput.focus({ preventScroll: true });
    })();

    passwordForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;

      const current = currentInput.value || '';
      const next = nextInput.value || '';
      const again = confirmInput.value || '';

      if (!current) {
        setStatus('先输入当前密码。', 'error');
        currentInput.focus();
        return;
      }
      if (next.length < 8 || next.length > 72) {
        setStatus('新密码需要 8–72 位字符。', 'error');
        nextInput.focus();
        return;
      }
      if (next !== again) {
        setStatus('两次输入的新密码不一样。', 'error');
        confirmInput.focus();
        return;
      }
      if (next === current) {
        setStatus('新密码和当前密码相同，换一个。', 'error');
        nextInput.focus();
        return;
      }

      busy = true;
      passwordForm.setAttribute('aria-busy', 'true');
      setStatus('正在保存…');
      try {
        const { response, payload } = await post('/api/profile/password', { currentPassword: current, password: next });
        if (response.status === 200 && payload?.ok) {
          // 服务端已经把该账号的所有会话（包括这一个）撤掉了，这里只是把人送回登录页。
          setStatus('密码已更新，正在退出登录…');
          location.replace(payload.redirect || '/login/');
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
        passwordForm.removeAttribute('aria-busy');
      }
    });
  }

  // 只有「退出登录」没有表单的页面：先把令牌拿到。
  if (!generalForm && !passwordForm) loadCsrf();
})();
