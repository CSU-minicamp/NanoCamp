// 导航栏右上角的账号入口。
//
// 页面是按路由共享缓存的：同一个 URL 对所有人输出同一份 HTML，所以服务端只能渲染
// 「未登录」形态（主题色圆 + 白字「登录」，指向 /login/）。登录态在这里补上 ——
// 问一次 /api/session，有 user 就把圆换成默认头像（人像，暂时没有头像图片，
// 以后有图片也只改模板），链接指向 /user/<uid>/。
//
// 失败时保持未登录形态：点进去先到 /login/，已登录的人会被服务端 303 送到 /profile/，
// 所以「脚本没跑起来」也不会把人送错地方。
(() => {
  const entry = document.querySelector('[data-account-entry]');
  if (!entry) return;

  fetch('/api/session', { credentials: 'same-origin' })
    .then(response => (response.ok ? response.json() : null))
    .then(session => {
      const user = session && session.user;
      if (!user || !user.id) return;
      const name = (user.nickname || '').trim();
      entry.setAttribute('href', '/user/' + user.id + '/');
      entry.setAttribute('data-state', 'member');
      entry.setAttribute('aria-label', name ? name + ' 的公开主页' : '我的公开主页');
    })
    .catch(() => {});
})();
