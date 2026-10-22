// 导航栏右上角的账号入口。
//
// 「画哪一个」——主题色圆里的「登录」还是人像——已经由 <head> 里的内联脚本按 nc_ui
// 标记定好了（见 src/components.mjs 的 accountBoot），所以这里**不再产生闪烁**。
//
// 本文件只补两件 HTML/CSS 表达不了的事：
//   1. 登录后 href 要指向 /user/<uid>/（CSS 改不了属性）；
//   2. 后台对一次账：cookie 可能是旧的（在别处退出、会话空闲超时），以服务端为准改回「登录」。
//
// 安全边界：nc_ui 只是 UI 提示，不含任何凭证。真正的身份判定永远在服务端
// （HttpOnly 的 nc_sid 会话、/profile/ 的 303、/api/profile 的 401），
// 伪造这个标记最多让人在自己的浏览器里看到一个头像。
(() => {
  const entry = document.querySelector('[data-account-entry]');
  if (!entry) return;

  const root = document.documentElement;

  const showGuest = () => {
    root.setAttribute('data-account', 'guest');
    entry.setAttribute('href', '/login/');
    entry.setAttribute('aria-label', '登录 NanoCamp');
  };

  const showMember = (uid, name) => {
    root.setAttribute('data-account', 'member');
    entry.setAttribute('href', '/user/' + uid + '/');
    entry.setAttribute('aria-label', name ? name + ' 的公开主页' : '我的公开主页');
  };

  // 与内联脚本同一套判定，只是这里还需要 uid 来拼链接。
  const uid = (/(?:^|;\s*)nc_ui=(\d{1,18})/.exec(document.cookie || '') || [])[1] || '';
  if (uid) showMember(uid, '');

  fetch('/api/session', { credentials: 'same-origin' })
    .then(response => (response.ok ? response.json() : null))
    .then(session => {
      if (!session) return;
      const user = session.user;
      if (user && user.id) showMember(String(user.id), (user.nickname || '').trim());
      // disabled 表示账号系统暂时不可用：别把已有的头像改回「登录」，那会误导人。
      else if (!session.disabled) showGuest();
    })
    .catch(() => {});
})();
