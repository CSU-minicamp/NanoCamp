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

  function svg(viewBox, attrs) {
    const node = doc.createElementNS(SVG_NS, 'svg');
    node.setAttribute('viewBox', viewBox);
    node.setAttribute('aria-hidden', 'true');
    Object.keys(attrs || {}).forEach(name => node.setAttribute(name, attrs[name]));
    return node;
  }

  function searchIcon() {
    const node = svg('0 0 24 24', { class: 'nav-search-icon' });
    const circle = doc.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '10.5');
    circle.setAttribute('cy', '10.5');
    circle.setAttribute('r', '6.5');
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'm16 16 5 5');
    node.append(circle, path);
    return node;
  }

  function caretIcon() {
    const node = svg('0 0 16 16');
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'm4 6 4 4 4-4');
    node.append(path);
    return node;
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

  const NAV_RENDERERS = Object.freeze({
    desktop: desktopNav,
    mobile: mobileNav,
    footer: footerNav
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
    nav: NAV_RENDERERS
  });

  window.NanoCampBase = api;
  navMount();
})();
