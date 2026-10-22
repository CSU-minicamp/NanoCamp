// NanoCamp base.js
// 站点框架的**交互**层：手机导航的开合、回到顶部浮窗。
//
// 导航本身不再由这里渲染。整页在请求期一次渲染（`src/components.mjs` 的 `header()` 把 nav 拼进
// 同一根字符串），HTML 里就是成品 —— 无 JS 也有完整导航，首帧也不会「晚一拍出现」。
//
// 这里以前还有一份 `NAV_LINKS`，把 desktop / mobile 两个槽位重画一遍，理由是「结构始终来自同一份定义」。
// 但那份数据和 `src/components.mjs` 的 `navLinks` 是两处各写一遍的，产出又逐字节相同
// （曾经靠 tests/nav-build.test.mjs 比对兜着），所以它只是重复渲染 + 重复维护。已整段删除。
// **改导航请只改 src/components.mjs 一处。**
//
// 约定：HTML 里的槽位仍用 data-nav 标记，本文件**只读不写**：
//   <nav class="desktop-nav" aria-label="主导航" data-nav="desktop">
//   <nav id="mobile-nav" class="mobile-nav" aria-label="手机导航" data-nav="mobile" hidden>
(() => {
  'use strict';

  if (typeof window === 'undefined' || !window.document) return;
  const doc = window.document;

  let warned = false;
  let unbindMenu = () => {};
  const backToTopBindings = new WeakSet();

  function warn(message) {
    if (warned || typeof console === 'undefined' || !console.warn) return;
    warned = true;
    console.warn('[NanoCamp base.js] ' + message);
  }

  // 当前页以 <body data-page="..."> 为准；首页缺省为 home，404 不高亮。
  // 高亮本身由服务端渲染的 aria-current 决定，这里只用于判断要不要挂「回到顶部」。
  function navActive() {
    return doc.body ? doc.body.getAttribute('data-page') || 'home' : 'home';
  }

  // 回到顶部浮窗：常驻右下角，下滑一段距离后由 mountBackToTop 显示。
  // minicamp 与社区页按原设计不提供。
  function backToTop() {
    const button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('class', 'back-to-top');
    button.setAttribute('data-back-to-top', '');
    button.setAttribute('aria-label', '回到顶部');
    button.setAttribute('aria-controls', 'top');
    button.hidden = true;
    const arrow = doc.createElement('span');
    arrow.setAttribute('class', 'back-top-arrow');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↑';
    button.append(arrow);
    return button;
  }

  function mountBackToTop() {
    const active = navActive();
    // 已有的浮窗先清空属性再复用节点：mount 可能被再次调用，重复插入会在页脚
    // 留下第二个按钮。这里不用 node.remove()，保持与测试用的精简 DOM 兼容。
    const existing = doc.querySelectorAll('[data-back-to-top]');
    Array.prototype.forEach.call(existing, (node, index) => {
      if (index === 0) return;
      node.setAttribute('hidden', '');
      node.setAttribute('aria-hidden', 'true');
    });
    if (active === 'minicamp' || active === 'community') return null;
    const footer = doc.querySelector('.site-footer');
    if (!footer) return null;

    let button = existing[0];
    if (button && button.parentNode !== footer) button = null;
    if (!button) {
      button = backToTop();
      footer.append(button);
    }
    if (backToTopBindings.has(button)) return button;
    backToTopBindings.add(button);

    // 点击行为归 base.js 所有：details.js 不插手这个元素，避免两处竞态。
    button.addEventListener('click', () => {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });

    let frame = 0;
    const shouldShow = () => window.scrollY > Math.max(240, window.innerHeight * .5);
    function paint() {
      frame = 0;
      const show = shouldShow();
      // 只切 data-visible：显隐完全交给 base.css 的 visibility + opacity 过渡。
      // 不回写 hidden —— hidden 在浏览器里有 display:none 的 UA 样式，回写会让
      // display 在 grid / none 之间拆装，下一次淡入可能从“无盒子”开始而丢掉插值。
      // 首次出现时清掉 hidden 即可；CSS 的 [data-visible] 会它让立刻可见。
      if (show && button.hidden) button.hidden = false;
      if (show) button.setAttribute('data-visible', '');
      else button.removeAttribute('data-visible');
    }
    function schedule() { if (!frame && !doc.hidden) frame = window.requestAnimationFrame(paint); }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) { window.cancelAnimationFrame(frame); frame = 0; }
      else schedule();
    });
    paint();
    return button;
  }

  // 手机导航面板的开合（槽位与按钮都由服务端模板提供，找不到就跳过）。
  function bindMenu() {
    unbindMenu();
    const button = doc.querySelector('[data-menu-toggle]');
    const menu = doc.querySelector('[data-nav="mobile"]');
    if (!button || !menu) { warn('没有找到手机导航槽位，菜单交互未启用。'); return; }
    const mobile = window.matchMedia ? window.matchMedia('(max-width: 860px)') : null;

    function close() {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', '打开导航菜单');
    }

    function isOpen() {
      return button.getAttribute('aria-expanded') === 'true';
    }

    const toggle = () => {
      const open = !isOpen();
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
      menu.hidden = !open;
    };
    const escape = event => {
      if (event.key !== 'Escape' || menu.hidden) return;
      close();
      button.focus();
    };
    const outside = event => {
      if (menu.hidden || menu.contains(event.target) || button.contains(event.target)) return;
      close();
    };
    const resize = () => { if (!mobile.matches) close(); };
    button.addEventListener('click', toggle);
    doc.addEventListener('keydown', escape);
    doc.addEventListener('focusin', outside);
    doc.addEventListener('click', outside);
    if (mobile) mobile.addEventListener('change', resize);
    unbindMenu = () => {
      button.removeEventListener('click', toggle);
      doc.removeEventListener('keydown', escape);
      doc.removeEventListener('focusin', outside);
      doc.removeEventListener('click', outside);
      if (mobile) mobile.removeEventListener('change', resize);
    };
  }

  // 唯一入口：挂上所有交互。可重复调用（先解绑再绑，不会叠加监听）。
  function mount() {
    bindMenu();
    mountBackToTop();
  }

  const api = Object.freeze({
    active: navActive,
    mount,
    backToTop: mountBackToTop
  });

  window.NanoCampBase = api;
  mount();
})();
