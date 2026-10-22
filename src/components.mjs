import { site } from '../content/site.mjs';
import { metadata } from './metadata.mjs';
import { galleryDialog } from './recap.mjs';

export const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function safeUrl(value, local = false) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (local && /^\/(?!\/)/.test(value) && !/[\\\r\n]/.test(value)) return value;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

export function wordmark() {
  return logoMark('wordmark');
}

export function logoMark(kind = 'wordmark', classes = '', lazy = false) {
  const symbol = kind === 'symbol';
  let source = safeUrl(symbol ? site.symbol : site.logo, true);
  let crop = symbol ? null : (kind === 'signature' ? site.signatureCrop : site.logoCrop);
  let imageAttributes = '';
  // These derivatives use the supplied originals and the existing wordmark crop.
  // Custom images or crop settings continue to use their own source unchanged.
  if (kind === 'wordmark' && source === '/images/nanocamp-wordmark.png' && Array.isArray(crop) && crop.join(',') === '48,438,1170,290,1254') {
    source = '/images/nanocamp-wordmark-468.webp';
    crop = [0, 0, 1170, 290, 1170];
    imageAttributes = ' width="1170" height="290" srcset="/images/nanocamp-wordmark-468.webp 468w, /images/nanocamp-wordmark-702.webp 702w, /images/nanocamp-wordmark-1170.webp 1170w" sizes="180px"';
  } else if (symbol && source === '/images/nanocamp-symbol.png') {
    source = '/images/nanocamp-symbol.webp';
    imageAttributes = ' width="428" height="430"';
  }
  const validCrop = Array.isArray(crop) && crop.length === 5 && crop.every(Number.isFinite) && crop[2] > 0 && crop[3] > 0 && crop[4] > 0;
  const style = validCrop ? ` style="--crop-ratio:${crop[2]} / ${crop[3]};--image-width:${crop[4] / crop[2] * 100}%;--image-left:${-crop[0] / crop[2] * 100}%;--image-top:${-crop[1] / crop[3] * 100}%"` : '';
  return `<span class="brand-asset brand-${kind} ${validCrop ? 'brand-cropped' : ''} ${esc(classes)}"${style}>${source ? `<img class="brand-image" src="${esc(source)}" alt="${symbol ? 'NanoCamp NC 图形标志' : 'NanoCamp'}" decoding="async" loading="${lazy ? 'lazy' : 'eager'}"${imageAttributes}><span class="brand-fallback" hidden>${symbol ? 'NC' : 'NanoCamp'}</span>` : `<span class="brand-fallback">${symbol ? 'NC' : 'NanoCamp'}</span>`}</span>`;
}

export const arrowIcon = (external = false) => `<svg class="link-arrow" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="${external ? 'M5 15 15 5M5 5h10v10' : 'M3 10h13m-5-5 5 5-5 5'}"/></svg>`;
// The external SVG sprite is shared with base.js; no duplicated icon drawings.
export function uiIcon(kind, classes = '') {
  const name = ['home','minicamp','activities','projects','community','partners','search','join','chat','calendar'].includes(kind) ? kind : 'home';
  return `<svg class="ui-icon ${classes}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><use href="/images/interface-icons.svg#icon-${name}"></use></svg>`;
}
export const joinButton = (label = '加入社区', classes = '') => `<button type="button" class="button button-primary ${classes}" data-join>${uiIcon('join', 'button-community-icon')}<span class="button-label">${label}</span><span class="button-plus" aria-hidden="true">+</span></button><a class="button button-primary join-fallback ${classes}" href="/faq/#join-channel">${uiIcon('join', 'button-community-icon')}${label}<span aria-hidden="true">↗</span></a>`;
export const pageLink = (href, label, classes = '') => `<a class="button button-secondary ${classes}" href="${href}"><span class="button-label">${label}</span>${arrowIcon()}</a>`;
// Section headings carry the hierarchy; keep the shared call signature.
export const eyebrow = () => '';

// 默认头像（人像）。导航圆与成员主页共用同一个形状，换图片时只改这里和调用处。
export const avatarGlyph = () => '<svg class="avatar-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.6" r="3.9"/><path d="M4.7 20.4c.9-3.9 3.8-6 7.3-6s6.4 2.1 7.3 6"/></svg>';

// 右上角的账号入口：**永远是一个圆形**，与站内其它圆形控件一致。
//
//   未登录 —— 主题色实心圆，里面两个白字「登录」；
//   已登录 —— 默认头像（那个人像），以后有图片就换成图片。
//
// 两种形态**都写在这份 HTML 里**，画哪一个由 <html data-account> 决定（见 accountBoot）：
// 服务端渲染不出登录态（页面按路由共享缓存），但可以靠可读的 nc_ui 标记在首帧前定下来。
// href 仍是 /login/：登录后由 public/account.js 改成 /user/<uid>/，点得快也只是先到登录页、
// 再被服务端 303 送到 /profile/ —— 不会走丢。
export function accountEntry() {
  return `<a class="header-account" href="/login/" data-account-entry aria-label="登录 NanoCamp"><span class="account-avatar"><span class="account-label" aria-hidden="true">登录</span>${avatarGlyph()}</span></a>`;
}

export function header(active) {
  return `<a class="skip-link" href="#main">跳到主要内容</a><header class="site-header"><div class="container header-inner">
    <a class="brand" href="/" aria-label="NanoCamp 首页">${wordmark()}</a>
    <nav class="desktop-nav" aria-label="主导航" data-nav="desktop">${desktopNavigation(active)}</nav>
    <div class="header-actions">${active === 'community' ? `<a class="button button-primary button-small" href="#contact">${uiIcon('chat', 'button-community-icon')}联系我们</a>` : joinButton(site.join.qrCode || site.join.contact ? '加入社区' : '加入方式', 'button-small')}${accountEntry()}<button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="mobile-nav" aria-label="打开导航菜单"><span></span><span></span></button></div>
    <nav id="mobile-nav" class="mobile-nav" aria-label="手机导航" data-nav="mobile" hidden>${mobileNavigation(active)}</nav>
  </div></header>`;
}

// 站内导航的**唯一数据源**。改导航只改这里：整页在请求期一次渲染，nav 就是其中一个片段，
// 客户端不再重画一遍（base.js 只绑菜单开合与回到顶部）。加一项就会同时出现在桌面与手机两个 nav 里。
const navLinks = [
  { key: 'home', href: '/', label: '首页' },
  { key: 'minicamp', href: '/minicamp/', label: 'minicamp' },
  { key: 'activities', href: '/activities/', label: '活动' },
  { key: 'projects', href: '/projects/', label: '作品' },
  { key: 'community', href: '/community/', label: '社区' },
  { key: 'partners', href: '/partners/', label: '合作' },
  { key: 'search', href: '/search/', label: '站内搜索', search: true }
];

// 当前页高亮由服务端给 aria-current —— 客户端不需要再算一遍。
function navLink(link, active, label = link.label) {
  const current = (active || 'home') === link.key ? ' aria-current="page"' : '';
  if (link.search) {
    return `<a href="${link.href}" class="nav-search" aria-label="站内搜索"${current} data-search-shortcut>${uiIcon('search', 'nav-search-icon')}<span class="nav-search-label">${label}</span></a>`;
  }
  return `<a href="${link.href}"${current} class="nav-destination">${uiIcon(link.key, 'nav-symbol')}<span class="nav-item-label">${label}</span></a>`;
}

function desktopNavigation(active) {
  return navLinks.map(link => navLink(link, active)).join('');
}

function mobileNavigation(active) {
  return navLinks.map(link => navLink(link, active)).join('');
}

export function media({ src, alt = '活动照片', label = '现场照片', id = '01', theme = 'blue', classes = '', kind = 'moment', fullSrc = null, caption = alt, album = 'moments', albumLabel = 'minicamp 现场相册', linkTo = null, coverArt = '' } = {}) {
  const image = safeUrl(src, true);
  const original = safeUrl(fullSrc, true) || image;
  const placeholder = `<div class="media-placeholder ${image ? 'media-fallback' : ''}" ${image ? 'hidden' : ''}><span class="media-corner corner-tl" aria-hidden="true"></span><span class="media-corner corner-br" aria-hidden="true"></span><span class="media-glyph" aria-hidden="true">${kind === 'project' ? esc(id) : '+'}</span><span class="media-placeholder-caption">${kind === 'project' ? '作品封面' : '现场照片'}待补充</span></div>`;
  const zoom = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4"/></svg>查看照片`;
  const labelRow = `<div class="media-label"><span>${esc(label)}</span><span>${esc(id)}</span></div>`;
  // 作品没有实拍封面时，改用品牌字形的确定性默认封面，替换原先的编号占位块。
  if (!image) return `<div class="media-frame tone-${esc(theme)} ${esc(classes)}${coverArt ? ' has-art' : ''}">${coverArt || placeholder}${labelRow}</div>`;
  if (linkTo) {
    // 封面点击进入作品详情页；「查看照片」作为独立按钮打开大图（lightbox）。
    return `<div class="media-frame tone-${esc(theme)} ${esc(classes)} has-image"><a class="media-open" href="${esc(linkTo)}" aria-label="查看详情：${esc(alt)}"><img src="${esc(image)}" alt="${esc(alt)}" loading="lazy" decoding="async" data-media-image></a><a class="media-zoom" href="${esc(original)}" data-lightbox="${esc(original)}" data-caption="${esc(caption)}" data-album="${esc(album)}" data-album-label="${esc(albumLabel)}" aria-label="查看大图：${esc(alt)}">${zoom}</a>${labelRow}</div>`;
  }
  return `<div class="media-frame tone-${esc(theme)} ${esc(classes)} has-image"><a class="media-open" href="${esc(original)}" data-lightbox="${esc(original)}" data-caption="${esc(caption)}" data-album="${esc(album)}" data-album-label="${esc(albumLabel)}" aria-label="查看大图：${esc(alt)}"><img src="${esc(image)}" alt="${esc(alt)}" loading="lazy" decoding="async" data-media-image><span class="media-zoom" aria-hidden="true">${zoom}</span></a>${labelRow}</div>`;
}

// Shared invitation: homepage and every existing join section use this component.
export function joinSection({ showAvailabilityNote = false } = {}) {
  const available = Boolean(site.join.qrCode || site.join.contact);
  return `<section class="join-section" aria-labelledby="join-heading"><div class="container join-inner"><div class="join-copy"><h2 id="join-heading">有想做的，<br>就会有人一起。</h2><p>说一句你想做什么，自然会有人接话。</p></div><div class="join-paper"><strong>See you<br>at NanoCamp.</strong><span>${showAvailabilityNote && !available ? '加入渠道尚未公布，可先阅读参与指南。' : '欢迎每一份好奇心。'}</span>${joinButton(available ? '查看加入渠道' : '查看加入方式', 'button-small')}</div></div></section>`;
}

export function shareButton(label = '复制页面链接') {
  return `<button type="button" class="page-share-button" data-share-page hidden aria-controls="share-manual"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 10v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-5M5 13H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"/></svg><span data-share-label>${label}</span></button>`;
}

// 页脚全站统一：口号（双色两行）+ 三栏导航 + 通栏字标，与站内搜索页同款结构。
// 原来的署名块（图形标志 + WHO WE BUILD WITH）已整块移除，页脚底部留空。
// [data-nav="footer-bottom"] 是历史遗留的空槽位（以前 base.js 会往里渲染、现在不碰了），
// 保留它是因为 nav-build 测试按它确认「页脚底部仍然是空的」，也方便以后有需要时挂东西。
// 回到顶部浮窗完全由 base.js 在客户端生成，静态 HTML 里没有它的标记。
export function footer() {
  const nav = '<nav aria-label="页脚导航">'
    + '<div><h2>发现</h2><a href="/minicamp/">年度 minicamp</a><a href="/activities/">活动总览</a><a href="/projects/">社区作品</a></div>'
    + '<div><h2>一起创造</h2><a href="/community/">参与指南</a><a href="/resources/">共创资源</a><a href="/partners/">交流合作</a></div>'
    + '<div><h2>了解社区</h2><a href="/faq/">常见问题</a><a href="/about/">关于我们</a><a href="/search/">站内搜索</a></div>'
    + '</nav>';
  const wordmarkImage = '<a class="footer-wordmark" href="/" aria-label="NanoCamp 首页"><img src="/images/nanocamp-wordmark-1170.webp" alt="NanoCamp" width="1170" height="290" loading="lazy" decoding="async"></a>';
  return '<footer class="site-footer footer-shared"><div class="container"><div class="footer-top">'
    + '<div class="footer-brand"><p class="footer-slogan"><span class="brand-blue">Meet. Build.</span><span class="brand-mint">Make something together.</span></p>'
    + '<div data-nav="footer-bottom"><div class="footer-bottom"></div></div></div>'
    + nav
    + '</div>' + wordmarkImage
    + '</div></footer>';
}

export function dialogs() {
  const qr = safeUrl(site.join.qrCode, true);
  return `<dialog id="join-dialog" class="join-dialog" aria-labelledby="join-dialog-title"><div class="dialog-content"><div class="dialog-brand-emblem" aria-hidden="true">${logoMark('symbol', '', true)}</div><button type="button" class="dialog-close" data-close-dialog aria-label="关闭加入社区弹窗" autofocus>×</button>${eyebrow('HELLO, NEW FRIEND')}<h2 id="join-dialog-title">一起创造，从相遇开始。</h2><p class="dialog-intro">${esc(site.join.description)}</p>
    ${qr ? `<img class="join-qr" src="${esc(qr)}" alt="加入 NanoCamp 社区二维码" data-qr><p class="qr-error" hidden>${site.join.contact ? '二维码暂时无法加载，请通过下方渠道联系社区。' : '二维码暂时无法加载，请稍后重试。'}</p>` : `<div class="qr-placeholder" aria-hidden="true"><span>+</span><span>MEET YOU SOON</span></div>`}
    ${!qr && !site.join.contact ? '<h3 class="join-pending">加入渠道尚未公布</h3><p class="muted">官方二维码与联系方式会在这里更新。</p><a class="text-link" href="/community/">先看看怎样参与</a>' : ''}
    ${site.join.contact ? `<div class="contact-row"><div><span>${esc(site.join.contactLabel)}</span><strong>${esc(site.join.contact)}</strong></div><button class="button button-secondary button-small" data-copy="${esc(site.join.contact)}" type="button">复制</button></div>` : ''}<p class="copy-status" role="status" aria-live="polite"></p><div class="dialog-footer">带着兴趣来，不限专业，也欢迎第一次尝试。</div></div></dialog>
    ${galleryDialog()}`;
}

// 首帧的那一行脚本：只要读到 nc_ui 标记，就把 <html data-account="member"> 定下来。
//
// 为什么必须内联、还必须在 <head> 里：页面是按路由共享缓存的，服务端渲染不出登录态；
// 而等 /api/session 回来再画，圆会先显示「登录」再跳成头像（闪一下）。
// 这段跑在 body 解析之前，所以**第一帧就是对的**。读不到标记（无 JS、未登录）就是普通登录入口。
// 它只决定「画什么」，不携带任何凭证，也不参与任何权限判断。
const accountBoot = '<script>document.documentElement.setAttribute("data-account",/(?:^|;\\s*)nc_ui=\\d{1,18}/.test(document.cookie)?"member":"guest")</script>';

export function documentPage({ title, description, active, body, route, noindex = false }) {
  // 首页在内容中放置共享加入区；其余内容页和错误页在这里追加一次。
  if (active && active !== 'search') body += joinSection();
  const fontAssets = '<link rel="preload" href="/fonts/nano-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/nano-display-ui.woff2" as="font" type="font/woff2" crossorigin>';
  const homeAssets = !active ? '<link rel="stylesheet" href="/hero.css"><link rel="stylesheet" href="/home.css"><link rel="stylesheet" href="/home-experiment.css">' : '';
  const partnerAssets = active === 'partners' ? '<script defer src="/partners.js"></script><script defer src="/partner-draft.js"></script><script defer src="/partner-scenes.js"></script>' : '';
  const favicon = safeUrl(site.symbol === '/images/nanocamp-symbol.png' ? '/images/nanocamp-favicon.png' : site.symbol, true);
  const workshop = ['resources', 'partners'].includes(active);
  const album = !active || ['minicamp','projects'].includes(active);
  return `<!doctype html><html lang="zh-CN" class="no-js"><head>${accountBoot}<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#FAFAF6"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">${metadata({ title, description, route, noindex })}${favicon ? `<link rel="icon" type="image/png" href="${esc(favicon)}">` : ''}${fontAssets}<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/details.css"><link rel="stylesheet" href="/community.css"><link rel="stylesheet" href="/discovery.css">${album ? '<link rel="stylesheet" href="/gallery.css">' : ''}${album ? '<link rel="stylesheet" href="/projects.css">' : ''}${active === 'minicamp' || active === 'projects' ? '<link rel="stylesheet" href="/recap.css">' : ''}${workshop ? '<link rel="stylesheet" href="/workshop.css">' : ''}<link rel="stylesheet" href="/collage.css">${active === 'search' ? '<link rel="stylesheet" href="/search.css">' : ''}${['login', 'profile', 'user'].includes(active) ? '<link rel="stylesheet" href="/auth.css">' : ''}${active === 'partners' ? '<link rel="stylesheet" href="/partners.css"><link rel="stylesheet" href="/partner-draft.css"><link rel="stylesheet" href="/partner-scenes.css">' : ''}<link rel="stylesheet" href="/interactions.css">${homeAssets}<script defer src="/base.js"></script><script defer src="/account.js"></script><script defer src="/app.js"></script><script defer src="/details.js"></script>${partnerAssets}<script defer src="/community.js"></script><script defer src="/discovery.js"></script>${active === 'login' ? '<script defer src="/auth.js"></script>' : ''}${active === 'profile' ? '<script defer src="/profile.js"></script>' : ''}${album ? '<script defer src="/gallery.js"></script>' : ''}${active === 'minicamp' ? '<script defer src="/recap.js"></script>' : ''}${active === 'search' ? '<script type="module" src="/search.js"></script>' : ''}${workshop ? '<script defer src="/workshop.js"></script>' : ''}${!active ? '<script defer src="/hero.js"></script><script defer src="/home-playground.js"></script><script defer src="/home-experiment.js"></script>' : ''}</head><body id="top" data-page="${active || 'home'}">${header(active)}<main id="main">${body}</main>${footer(active)}${dialogs()}</body></html>`;
}
