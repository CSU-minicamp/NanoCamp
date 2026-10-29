// 个人资料相关的两件事，共用一份脚本：
//   /profile/force/ —— 首次补全表单
//   /profile/?tab=profile —— 个人中心内嵌资料编辑与退出登录
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
    if (error === 'invalid_profile') return '昵称不能为空、最多 24 个字符且不能包含 / 这类符号。';
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
  const needsPassword = Boolean(passwordRequired&&!passwordRequired.hidden);
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
    // 上限来自模板渲染的 data-max（源头 common/limits.mjs），这里不再写死数字。
    const nicknameMax = Number(nicknameInput.dataset.max) || 24;
    if (Array.from(nickname).length > nicknameMax) {
      setStatus(`昵称最多 ${nicknameMax} 个字符。`, 'error');
      nicknameInput.focus();
      return;
    }
    // 禁用字符集与后端同一份：模板把 common/nickname.mjs 的字符类源码渲染进 data-nickname-forbidden。
    // 前端只负责给一句中文提示，判定权威仍在服务端。
    const forbidden = new RegExp(nicknameInput.dataset.nicknameForbidden || '$^', 'u');
    if (forbidden.test(nickname)) {
      setStatus('昵称不能包含 / \\ 或不可见字符。', 'error');
      nicknameInput.focus();
      return;
    }

    const password = passwordInput?.value || '';
    const passwordMin = passwordInput?.minLength || 8;
    const passwordMax = passwordInput?.maxLength || 72;
    if (needsPassword && password.length < passwordMin) {
      setStatus(`先设置一个至少 ${passwordMin} 位的密码。`, 'error');
      passwordInput.focus();
      return;
    }
    if (password && (password.length < passwordMin || password.length > passwordMax)) {
      setStatus(`密码需要 ${passwordMin}–${passwordMax} 位字符。`, 'error');
      passwordInput.focus();
      return;
    }

    const body = { nickname, bio: bioInput.value || '' };
    if (password) body.password = password;

    busy = true;
    form.setAttribute('aria-busy', 'true');
    setStatus('正在保存…');
    try {
      const response = await fetch('/api/profile/init', {
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
