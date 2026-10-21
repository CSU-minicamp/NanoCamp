// 登录页前端逻辑：三条路径共用一个表单。
//
//   password 邮箱 + 密码 → POST /api/auth/login（本版本 503，按钮禁用）
//   request  发验证码    → POST /api/auth/email-captcha（**本版本真能发信**）
//   verify   填验证码    → POST /api/auth/verify
//
// 进页面先问一次 /api/session，它会明确告诉我们两件事：
//   disabled    账号系统（登录/会话）是否可用
//   canSendCode 发码是否可用
// 所以「登录没开放」不会顺带把发码按钮也锁死 —— 这一版就是要能测发信。
(() => {
  // 只接受站内路径。这一步是安全边界：next 来自地址栏，任何人都能构造。
  // 规则是「以单个 / 开头 + 解析后 origin 必须还是本站」——
  // //evil.com、/\evil.com、http(s)://别的域名、javascript: 全部被挡掉；
  // 反斜杠与不可见字符先整条拒绝，避免浏览器把它们当分隔符解析出跨站跳转。
  function safeTarget(raw) {
    const value = String(raw || '').trim();
    if (!value || value.length > 2000) return '';
    if (/[\\\u0000-\u001f\u007f]/.test(value)) return '';
    if (!value.startsWith('/') || value.startsWith('//')) return '';
    let url;
    try {
      url = new URL(value, location.origin);
    } catch {
      return '';
    }
    if (url.origin !== location.origin) return '';
    return url.pathname + url.search + url.hash;
  }

  const form = document.querySelector('[data-auth-form]');
  if (!form) return;

  const target = safeTarget(new URLSearchParams(location.search).get('next'));
  const panels = {
    password: form.querySelector('[data-auth-step="password"]'),
    request: form.querySelector('[data-auth-step="request"]'),
    verify: form.querySelector('[data-auth-step="verify"]')
  };
  const emailInput = form.querySelector('#login-email');
  const passwordInput = form.querySelector('#login-password');
  const reveal = form.querySelector('[data-auth-reveal]');
  const codeInput = form.querySelector('#login-captcha');
  const emailEcho = form.querySelector('[data-auth-email]');
  const resend = form.querySelector('[data-auth-resend]');
  const change = form.querySelector('[data-auth-change]');
  const sendLabel = form.querySelector('[data-auth-step="request"] .button-label');
  const status = form.querySelector('[data-auth-status]');

  let csrf = '';
  let step = 'password';
  let busy = false;
  let canSend = false;
  let canVerify = false;
  let countdownTimer = 0;
  let countdownLeft = 0;

  const setStatus = (message, tone = '') => {
    if (!status) return;
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };

  /** 按当前能力决定每个面板的按钮状态；发码冷却时间也体现在按钮文案上。 */
  function syncButtons() {
    const cooldown = countdownLeft > 0;
    for (const button of form.querySelectorAll('.auth-submit')) {
      const panel = button.closest('[data-auth-step]')?.dataset.authStep || '';
      const allowed = panel === 'request' ? canSend && !cooldown : canVerify;
      button.disabled = busy || !allowed;
    }
    if (sendLabel) sendLabel.textContent = cooldown ? `稍后再试（${countdownLeft}s）` : '获取验证码';
  }

  /** 切换面板（不换页、不换地址）。邮箱输入框在面板之外，切换时不会丢。 */
  function showStep(name) {
    step = name;
    for (const [key, panel] of Object.entries(panels)) if (panel) panel.hidden = key !== name;
    const focusTarget = name === 'verify' ? codeInput : name === 'password' ? passwordInput : emailInput;
    focusTarget?.focus({ preventScroll: true });
    syncButtons();
  }

  /** 倒计时：秒数以服务端返回的 retryAfter 为准，不写死。 */
  function paintResend() {
    if (!resend) return;
    if (countdownLeft > 0) {
      resend.disabled = true;
      resend.textContent = `重新发送（${countdownLeft}s）`;
    } else {
      resend.disabled = false;
      resend.textContent = '重新发送';
    }
  }
  function stopCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = 0;
    countdownLeft = 0;
    paintResend();
    syncButtons();
  }
  function startCountdown(seconds) {
    clearInterval(countdownTimer);
    countdownLeft = Math.max(1, Math.round(Number(seconds) || 0));
    paintResend();
    syncButtons();
    countdownTimer = setInterval(() => {
      countdownLeft -= 1;
      if (countdownLeft <= 0) {
        stopCountdown();
        return;
      }
      paintResend();
      syncButtons();
    }, 1000);
  }

  /** POST JSON：统一返回 {status, payload}。 */
  async function postJson(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nc-csrf': csrf },
      body: JSON.stringify(body),
      credentials: 'same-origin'
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { status: response.status, payload };
  }

  /** 把服务端的错误码映射成人话。不区分「邮箱是否存在」「没设密码」「密码错」，避免账号枚举。 */
  function explain(httpStatus, error, retryAfter) {
    if (error === 'mail_paused') return '验证码暂时发不出去，过一会儿再试；已经收到的验证码仍然可以用。';
    // 503 是临时故障（库挂了、服务异常）：可以重试。
    if (error === 'unavailable' || error === 'auth_unavailable' || httpStatus === 503) return '账号系统暂时不可用，稍后再试。';
    if (error === 'rate_limited') return `操作太频繁，请 ${retryAfter || '稍后'} 秒后再试。`;
    if (error === 'invalid_email') return '邮箱格式看起来不对，检查一下再试。';
    if (error === 'credentials_invalid') return '邮箱或密码不正确。如果是第一次来，可以改用验证码登录。';
    if (error === 'email_captcha_invalid') return '验证码不对，或者已经过期。可以重新发一次。';
    if (error === 'mail_failed') return '验证码发送失败，稍后再试一次。';
    if (error === 'forbidden') return '页面已经过期，刷新后重试。';
    return '网络不太顺畅，稍后再试一次。';
  }

  const emailValue = () => (emailInput?.value || '').trim();
  const emailLooksValid = () => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailValue());

  // 进页面先问一次状态：登录是否可用、发码是否可用。两件事分开处理。
  (async () => {
    try {
      const response = await fetch('/api/session', { credentials: 'same-origin' });
      const session = await response.json().catch(() => ({}));
      if (!response.ok) {
        // 503：账号系统不可用。具体原因只进服务端日志，不告诉用户。
        canVerify = false;
        canSend = false;
        setStatus(explain(response.status, session.error), 'error');
        syncButtons();
        return;
      }
      csrf = session.csrf || '';
      canVerify = !session.disabled;
      canSend = Boolean(session.canSendCode);
      if (session.mailPaused)
        setStatus('验证码暂时发不出去，过一会儿再试；已经收到的验证码仍然可以用。', 'error');
      else if (!canVerify)
        setStatus('账号系统不可用，暂时无法登录，请联系管理员。', 'error');
    } catch {
      canSend = false;
      canVerify = false;
      setStatus('无法连接服务器，刷新页面重试。', 'error');
    }
    syncButtons();
    if (emailInput && !busy) emailInput.focus({ preventScroll: true });
  })();

  /** 密码登录（本版本 canVerify 为 false，按钮是禁用的）。 */
  async function loginWithPassword() {
    if (!emailLooksValid()) {
      setStatus('先填一个能收信的邮箱。', 'error');
      emailInput?.focus();
      return;
    }
    const password = passwordInput?.value || '';
    if (!password) {
      setStatus('请输入密码。', 'error');
      passwordInput?.focus();
      return;
    }
    busy = true;
    syncButtons();
    setStatus('正在登录…');
    try {
      const { status: httpStatus, payload } = await postJson('/api/auth/login', { email: emailValue(), password, next: target || undefined });
      if (httpStatus === 200 && payload?.ok) {
        setStatus('登录成功，正在返回…');
        location.assign(payload.redirect || '/');
        return;
      }
      setStatus(explain(httpStatus, payload?.error, payload?.retryAfter), 'error');
    } catch {
      setStatus(explain(0), 'error');
    } finally {
      busy = false;
      syncButtons();
    }
  }

  /** 发验证码。 */
  async function requestEmailCaptcha() {
    if (!emailLooksValid()) {
      setStatus('先填一个能收信的邮箱。', 'error');
      emailInput?.focus();
      return;
    }
    busy = true;
    syncButtons();
    setStatus('正在发送验证码…');
    try {
      const { status: httpStatus, payload } = await postJson('/api/auth/email-captcha', { email: emailValue() });
      if (httpStatus === 200) {
        if (payload.canVerify) {
          if (emailEcho) emailEcho.textContent = emailValue();
          showStep('verify');
          startCountdown(payload?.retryAfter || 60);
          setStatus('验证码已发出，10 分钟内有效。没收到可以重新发送。');
        } else {
          // 登录还没接上：信真的发了，就如实说「发了但不能继续」，不把用户骗到验证码那一步。
          startCountdown(payload?.retryAfter || 60);
          setStatus(`验证码已发到 ${emailValue()}，请查收。登录功能尚未开放，这串码暂时无法使用。`);
        }
      } else {
        if (payload?.retryAfter) startCountdown(payload.retryAfter);
        setStatus(explain(httpStatus, payload?.error, payload?.retryAfter), 'error');
      }
    } catch {
      setStatus(explain(0), 'error');
    } finally {
      busy = false;
      syncButtons();
    }
  }

  /** 提交邮箱验证码。 */
  async function submitEmailCaptcha() {
    const emailCaptcha = (codeInput?.value || '').replace(/\D/g, '');
    if (emailCaptcha.length !== 6) {
      setStatus('验证码是 6 位数字。', 'error');
      codeInput?.focus();
      return;
    }
    busy = true;
    syncButtons();
    setStatus('正在验证…');
    try {
      const { status: httpStatus, payload } = await postJson('/api/auth/verify', { emailCaptcha, next: target || undefined });
      if (httpStatus === 200 && payload?.ok) {
        setStatus('登录成功，正在返回…');
        location.assign(payload.redirect || '/');
        return;
      }
      if (payload?.retryAfter) startCountdown(payload.retryAfter);
      setStatus(explain(httpStatus, payload?.error, payload?.retryAfter), 'error');
    } catch {
      setStatus(explain(0), 'error');
    } finally {
      busy = false;
      syncButtons();
    }
  }

  form.addEventListener('submit', event => {
    // 没有整页提交：整页 POST 只会拿到 405，也避免把密码/验证码写进地址栏。
    event.preventDefault();
    if (busy) return;
    if (step === 'password') {
      if (canVerify) loginWithPassword();
      return;
    }
    if (step === 'request') {
      if (canSend && countdownLeft === 0) requestEmailCaptcha();
      return;
    }
    if (canVerify) submitEmailCaptcha();
  });

  // 「改用验证码 / 改用密码」：在两条路径之间切换。
  for (const button of form.querySelectorAll('[data-auth-to]')) {
    button.addEventListener('click', () => {
      if (busy) return;
      setStatus('');
      showStep(button.dataset.authTo);
    });
  }

  // 「重新发送」：倒计时期间按钮自己就是禁用的；服务端还有一层 60 秒限额。
  resend?.addEventListener('click', () => {
    if (busy || resend.disabled) return;
    requestEmailCaptcha();
  });

  // 「改邮箱」：回到发码那一步并保留已填邮箱，不清倒计时（服务端限额仍按邮箱计算）。
  change?.addEventListener('click', () => {
    if (codeInput) codeInput.value = '';
    setStatus('');
    showStep('request');
  });

  // 睁眼=明文，闭眼=密文：图标由 CSS 按 aria-pressed 切换，这里只改状态、类型与无障碍标签。
  reveal?.addEventListener('click', () => {
    if (!passwordInput) return;
    const visible = passwordInput.type === 'text';
    passwordInput.type = visible ? 'password' : 'text';
    reveal.setAttribute('aria-pressed', String(!visible));
    reveal.setAttribute('aria-label', visible ? '显示密码' : '隐藏密码');
    passwordInput.focus({ preventScroll: true });
  });

  // 验证码框只留数字，粘贴整串也能用（单框就是为了这个）。
  codeInput?.addEventListener('input', () => {
    const digits = codeInput.value.replace(/\D/g, '').slice(0, 6);
    if (digits !== codeInput.value) codeInput.value = digits;
  });

  paintResend();
  syncButtons();
})();
