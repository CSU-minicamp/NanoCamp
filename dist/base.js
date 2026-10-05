// NanoCamp base.js
// 站点框架（nav，未来含页脚）的唯一数据源与渲染入口。
//
// 工作方式：HTML 里保留构建期渲染好的 nav 作为首屏内容与无 JS 兜底；
// base.js 用同一份配置在客户端重新渲染并替换掉原节点，保证 nav 结构
// 与当前页面状态始终来自同一处。
//
// 约定：HTML 里的 nav 槽位用 data-nav 标记。
//   <nav class="desktop-nav" aria-label="主导航" data-nav="desktop">
//   <nav id="mobile-nav" class="mobile-nav" aria-label="手机导航" data-nav="mobile" hidden>
(() => {
  'use strict';

  if (typeof window === 'undefined' || !window.document) return;
  const doc = window.document;

  const NAV_LINKS = Object.freeze([
    Object.freeze({ key: 'minicamp', href: '/minicamp/', label: 'minicamp', compact: true, more: false, footer: true, footerLabel: '年度 minicamp' }),
    Object.freeze({ key: 'activities', href: '/activities/', label: '活动', compact: true, more: false, footer: true, footerLabel: '活动总览' }),
    Object.freeze({ key: 'projects', href: '/projects/', label: '作品', compact: true, more: false, footer: true, footerLabel: '社区作品' }),
    Object.freeze({ key: 'resources', href: '/resources/', label: '资源', compact: false, more: true, moreLabel: '共创资源', footer: true, footerLabel: '共创资源' }),
    Object.freeze({ key: 'community', href: '/community/', label: '社区', compact: true, more: false, footer: true, footerLabel: '参与指南' }),
    Object.freeze({ key: 'partners', href: '/partners/', label: '合作', compact: false, more: true, moreLabel: '交流合作', footer: true, footerLabel: '交流合作' }),
    Object.freeze({ key: 'about', href: '/about/', label: '关于', compact: false, more: true, moreLabel: '关于社区', footer: true, footerLabel: '关于我们' }),
    Object.freeze({ key: 'search', href: '/search/', label: '搜索', compact: false, more: true, moreLabel: '站内搜索', footer: true, footerLabel: '站内搜索', search: true }),
    // 页脚专有项：主导航里没有，页脚渲染器接管时使用。
    Object.freeze({ key: 'faq', href: '/faq/', label: '常见问题', compact: false, more: false, footer: true, footerLabel: '常见问题', footerOnly: true })
  ]);

  const SVG_NS = 'http://www.w3.org/2000/svg';
  let warned = false;

  function warn(message) {
    if (warned || typeof console === 'undefined' || !console.warn) return;
    warned = true;
    console.warn('[NanoCamp base.js] ' + message);
  }

  function svg(node, viewBox, attrs) {
    node.setAttribute('viewBox', viewBox);
    node.setAttribute('aria-hidden', 'true');
    Object.keys(attrs || {}).forEach(name => node.setAttribute(name, attrs[name]));
    return node;
  }

  function svgEl(name) {
    return doc.createElementNS(SVG_NS, name);
  }

  function svgPath(node, d) {
    const path = svgEl('path');
    path.setAttribute('d', d);
    node.append(path);
    return node;
  }

  function searchIcon() {
    const node = svg(svgEl('svg'), '0 0 24 24', { class: 'nav-search-icon' });
    const circle = svgEl('circle');
    circle.setAttribute('cx', '10.5');
    circle.setAttribute('cy', '10.5');
    circle.setAttribute('r', '6.5');
    node.append(circle);
    return svgPath(node, 'm16 16 5 5');
  }

  function caretIcon() {
    return svgPath(svg(svgEl('svg'), '0 0 16 16'), 'm4 6 4 4 4-4');
  }

  function linkNode(link, active, label = link.label) {
    const node = doc.createElement('a');
    node.setAttribute('href', link.href);
    if (active === link.key) node.setAttribute('aria-current', 'page');
    if (link.search) {
      node.setAttribute('class', 'nav-search');
      node.setAttribute('aria-label', '站内搜索');
      // discovery.js 依赖这个钩子补 title、aria-keyshortcuts 与 Ctrl/⌘ + K。
      node.setAttribute('data-search-shortcut', '');
      node.append(searchIcon());
      const text = doc.createElement('span');
      text.setAttribute('class', 'nav-search-label');
      text.textContent = label;
      node.append(text);
      return node;
    }
    node.textContent = label;
    return node;
  }

  function navLinks(active, compact) {
    // footerOnly 的条目（如常见问题）只属于页脚，不进入头部导航。
    const links = NAV_LINKS.filter(link => !link.footerOnly);
    return (compact ? links.filter(link => link.compact) : links).map(link => linkNode(link, active));
  }

  // 桌面端的「更多」用原生 details，无 JS 也能展开。
  function navMore(active) {
    const details = doc.createElement('details');
    details.setAttribute('class', 'nav-more');
    const summary = doc.createElement('summary');
    summary.append(doc.createTextNode('更多'), caretIcon());
    details.append(summary);
    const panel = doc.createElement('div');
    panel.setAttribute('class', 'nav-more-panel');
    NAV_LINKS.filter(link => link.more).forEach(link => panel.append(linkNode(link, active, link.moreLabel || link.label)));
    details.append(panel);
    return details;
  }

  function desktopNav(active = navActive()) {
    const fragment = doc.createDocumentFragment();
    navLinks(active, true).forEach(node => fragment.append(node));
    fragment.append(navMore(active));
    return fragment;
  }

  function mobileNav(active = navActive()) {
    const fragment = doc.createDocumentFragment();
    navLinks(active, false).forEach(node => fragment.append(node));
    return fragment;
  }

  function footerNav(active = navActive()) {
    const fragment = doc.createDocumentFragment();
    NAV_LINKS.filter(link => link.footer).forEach(link => {
      const node = doc.createElement('a');
      node.setAttribute('href', link.href);
      if (active === link.key) node.setAttribute('aria-current', 'page');
      node.textContent = link.footerLabel || link.label;
      fragment.append(node);
    });
    return fragment;
  }

  // --- 页脚底部（数据源在这里，构建期会按同一份定义输出一份静态 HTML）---

  // 页脚署名：普通页面是菱形点 + 文字，minicamp 页用图形标志加说明。
  // 这行文字同时写死在静态 HTML 里（见 src/components.mjs），无 JS 时也可见。
  function signoff() {
    const wrapper = doc.createElement('span');
    wrapper.setAttribute('class', 'footer-signoff');
    if (navActive() !== 'minicamp') {
      const dot = doc.createElement('i');
      dot.setAttribute('aria-hidden', 'true');
      wrapper.append(dot, doc.createTextNode('一个属于学生创造者的社区。'));
      return wrapper;
    }
    const mark = doc.createElement('span');
    mark.setAttribute('class', 'footer-signoff-mark');
    mark.setAttribute('aria-hidden', 'true');
    const asset = doc.createElement('span');
    asset.setAttribute('class', 'brand-asset brand-symbol');
    const image = doc.createElement('img');
    image.setAttribute('class', 'brand-image');
    image.setAttribute('src', '/images/nanocamp-symbol.webp');
    image.setAttribute('alt', 'NanoCamp NC 图形标志');
    image.setAttribute('decoding', 'async');
    image.setAttribute('loading', 'lazy');
    image.setAttribute('width', '428');
    image.setAttribute('height', '430');
    const fallback = doc.createElement('span');
    fallback.setAttribute('class', 'brand-fallback');
    fallback.hidden = true;
    fallback.textContent = 'NC';
    asset.append(image, fallback);
    mark.append(asset);
    const copy = doc.createElement('span');
    copy.setAttribute('class', 'footer-signoff-copy');
    const kicker = doc.createElement('span');
    kicker.setAttribute('class', 'footer-signoff-kicker mono');
    kicker.textContent = 'WHO WE BUILD WITH';
    const line = doc.createElement('span');
    line.textContent = '一个属于学生创造者的社区。';
    copy.append(kicker, line);
    wrapper.append(mark, copy);
    return wrapper;
  }

  function footerBottom() {
    const bottom = doc.createElement('div');
    bottom.setAttribute('class', 'footer-bottom');
    bottom.append(signoff());
    return bottom;
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
    // 已有的浮窗先清空属性再复用节点：navMount 可能被再次调用，重复插入会在页脚
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

    // 点击行为归 base.js 所有：details.js 不再插手这个元素，避免两处竞态。
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

  const NAV_RENDERERS = Object.freeze({
    desktop: desktopNav,
    mobile: mobileNav,
    footer: footerNav,
    'footer-bottom': footerBottom
  });

  // 当前页以 <body data-page="..."> 为准；home 与 404 页没有对应的 nav 项。
  function navActive() {
    return doc.body ? doc.body.getAttribute('data-page') || '' : '';
  }

  function navSlots() {
    return Array.prototype.slice.call(doc.querySelectorAll('[data-nav]'));
  }

  function navMount() {
    const active = navActive();
    navSlots().forEach(slot => {
      const name = slot.getAttribute('data-nav');
      const render = NAV_RENDERERS[name];
      if (!render) { warn('未知的 data-nav 槽位："' + name + '"，已跳过。'); return; }
      slot.replaceChildren(render(active));
    });
    bindMenu();
    bindMoreMenu();
    mountBackToTop();
  }

  // 手机导航面板的开合（槽位与按钮都由本文件之外的模板提供，找不到就跳过）。
  function bindMenu() {
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

    button.addEventListener('click', () => {
      const open = !isOpen();
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
      menu.hidden = !open;
    });
    doc.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || menu.hidden) return;
      close();
      button.focus();
    });
    doc.addEventListener('focusin', event => {
      if (menu.hidden || menu.contains(event.target) || button.contains(event.target)) return;
      close();
    });
    doc.addEventListener('click', event => {
      if (menu.hidden || menu.contains(event.target) || button.contains(event.target)) return;
      close();
    });
    if (mobile) mobile.addEventListener('change', () => { if (!mobile.matches) close(); });
  }

  // 桌面端「更多」的收尾：点击外部、失焦、Esc 时收起。原生 details 自身负责开合。
  function bindMoreMenu() {
    const more = doc.querySelector('.nav-more');
    if (!more) return;
    const close = () => { more.open = false; };
    doc.addEventListener('click', event => { if (!more.contains(event.target)) close(); });
    doc.addEventListener('focusin', event => { if (more.open && !more.contains(event.target)) close(); });
    doc.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !more.open) return;
      close();
      const summary = more.querySelector('summary');
      if (summary) summary.focus();
    });
  }

  const api = Object.freeze({
    links: NAV_LINKS,
    active: navActive,
    slots: navSlots,
    mount: navMount,
    nav: NAV_RENDERERS,
    backToTop: mountBackToTop
  });

  window.NanoCampBase = api;
  navMount();
})();
