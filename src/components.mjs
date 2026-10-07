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
export const joinButton = (label = '加入社区', classes = '') => `<button type="button" class="button button-primary ${classes}" data-join><span class="button-label">${label}</span><span class="button-plus" aria-hidden="true">+</span></button><a class="button button-primary join-fallback ${classes}" href="/faq/#join-channel">${label}<span aria-hidden="true">↗</span></a>`;
export const pageLink = (href, label, classes = '') => `<a class="button button-secondary ${classes}" href="${href}"><span class="button-label">${label}</span>${arrowIcon()}</a>`;
// Section headings carry the hierarchy; keep the shared call signature.
export const eyebrow = () => '';

export function header(active) {
  return `<a class="skip-link" href="#main">跳到主要内容</a><header class="site-header"><div class="container header-inner">
    <a class="brand" href="/" aria-label="NanoCamp 首页">${wordmark()}</a>
    <nav class="desktop-nav" aria-label="主导航" data-nav="desktop">${desktopNavigation(active)}</nav>
    <div class="header-actions">${active === 'community' ? '<a class="button button-primary button-small" href="#contact">联系我们</a>' : joinButton(site.join.qrCode || site.join.contact ? '加入社区' : '加入方式', 'button-small')}<button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="mobile-nav" aria-label="打开导航菜单"><span></span><span></span></button></div>
    <nav id="mobile-nav" class="mobile-nav" aria-label="手机导航" data-nav="mobile" hidden>${mobileNavigation(active)}</nav>
  </div><div class="reading-progress" data-reading-progress hidden aria-hidden="true"><span></span></div></header>`;
}

// 站内导航的数据源是 public/base.js：客户端由它统一渲染，
// 这里按同一份定义做一份构建期输出，作为首屏内容与无 JS 兜底。
// 两边由 tests/nav.test.mjs 比对，改动时请同时更新 public/base.js。
const navLinks = [
  { key: 'home', href: '/', label: '首页' },
  { key: 'minicamp', href: '/minicamp/', label: 'minicamp' },
  { key: 'activities', href: '/activities/', label: '活动' },
  { key: 'projects', href: '/projects/', label: '作品' },
  { key: 'community', href: '/community/', label: '社区' },
  { key: 'partners', href: '/partners/', label: '交流合作' },
  { key: 'search', href: '/search/', label: '站内搜索', search: true }
];

// 属性顺序与 public/base.js 的 DOM 输出保持一致，替换时不会产生无谓的结构差异。
function navLink(link, active, label = link.label) {
  const current = (active || 'home') === link.key ? ' aria-current="page"' : '';
  if (link.search) {
    return `<a href="${link.href}" class="nav-search" aria-label="站内搜索"${current} data-search-shortcut><svg class="nav-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><span class="nav-search-label">${label}</span></a>`;
  }
  return `<a href="${link.href}"${current}>${label}</a>`;
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

export function joinSection() {
  const available=Boolean(site.join.qrCode || site.join.contact);
  const paperButton=joinButton(available ? '查看加入渠道' : '查看加入方式', 'button-small');
  return '<section class="join-section join-shared" aria-labelledby="join-heading"><div class="container join-inner"><div><h2 id="join-heading">下一个有趣的想法，<br>从遇见你开始。</h2><p>带上好奇心，来认识和你一起动手的伙伴。</p>' + (available ? joinButton('加入 NanoCamp') : pageLink('/community/','了解参与方式','button-white')) + '</div><div class="join-paper"><strong>See you<br>at NanoCamp.</strong>' + paperButton + '</div></div></section>';
}

export function shareButton(label = '复制页面链接') {
  return `<button type="button" class="page-share-button" data-share-page hidden aria-controls="share-manual"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 10v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-5M5 13H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"/></svg><span data-share-label>${label}</span></button>`;
}
export function footer(active) {
  if (active !== 'search') return sharedFooter();
  return `<footer class="site-footer"><div class="container"><div class="footer-top"><div class="footer-brand"><a class="brand" href="/" aria-label="NanoCamp 首页">${wordmark()}</a><p class="footer-slogan"><span class="brand-blue">Meet. Build.</span><span class="brand-mint">Make something together.</span></p></div><nav aria-label="页脚导航"><a href="/minicamp/">年度 minicamp</a><a href="/activities/">活动总览</a><a href="/projects/">社区作品</a><a href="/community/">参与指南</a><a href="/resources/">共创资源</a><a href="/partners/">交流合作</a><a href="/faq/">常见问题</a><a href="/about/">关于我们</a><a href="/search/">站内搜索</a></nav></div><div data-nav="footer-bottom"><div class="footer-bottom"><span class="footer-signoff"><i aria-hidden="true"></i>一个属于学生创造者的社区。</span></div></div></div></footer>`;
}

// 页脚底部的数据源是 public/base.js：署名同时写死在静态 HTML 里（无 JS 也可见），
// base.js 载入后用同一份定义原地替换，并由 tests/nav.test.mjs 逐节点比对。
// 回到顶部浮窗完全由 base.js 在客户端生成，静态 HTML 里没有它的标记。
function sharedFooter() {
  const signoffMark = '<span class="footer-signoff"><span class="footer-signoff-mark" aria-hidden="true">' + logoMark('symbol', '', true) + '</span><span class="footer-signoff-copy"><span class="footer-signoff-kicker mono">WHO WE BUILD WITH</span><span>一个属于学生创造者的社区。</span></span></span>';
  return '<footer class="site-footer footer-shared"><div class="container"><div class="footer-top"><a class="brand" href="/" aria-label="NanoCamp 首页">' + wordmark() + '</a><p>Meet. Build.<br>Make something together.</p><nav aria-label="页脚导航"><a href="/minicamp/">年度 minicamp</a><a href="/activities/">活动总览</a><a href="/projects/">社区作品</a><a href="/community/">参与指南</a><a href="/resources/">共创资源</a><a href="/partners/">交流合作</a><a href="/faq/">常见问题</a><a href="/about/">关于我们</a><a href="/search/">站内搜索</a></nav></div><div data-nav="footer-bottom"><div class="footer-bottom">' + signoffMark + '</div></div></div></footer>';
}

export function dialogs() {
  const qr = safeUrl(site.join.qrCode, true);
  return `<dialog id="join-dialog" class="join-dialog" aria-labelledby="join-dialog-title"><div class="dialog-content"><div class="dialog-brand-emblem" aria-hidden="true">${logoMark('symbol', '', true)}</div><button type="button" class="dialog-close" data-close-dialog aria-label="关闭加入社区弹窗" autofocus>×</button>${eyebrow('HELLO, NEW FRIEND')}<h2 id="join-dialog-title">一起创造，从相遇开始。</h2><p class="dialog-intro">${esc(site.join.description)}</p>
    ${qr ? `<img class="join-qr" src="${esc(qr)}" alt="加入 NanoCamp 社区二维码" data-qr><p class="qr-error" hidden>${site.join.contact ? '二维码暂时无法加载，请通过下方渠道联系社区。' : '二维码暂时无法加载，请稍后重试。'}</p>` : `<div class="qr-placeholder" aria-hidden="true"><span>+</span><span>MEET YOU SOON</span></div>`}
    ${!qr && !site.join.contact ? '<h3 class="join-pending">加入渠道尚未公布</h3><p class="muted">官方二维码与联系方式会在这里更新。</p><a class="text-link" href="/community/">先看看怎样参与</a>' : ''}
    ${site.join.contact ? `<div class="contact-row"><div><span>${esc(site.join.contactLabel)}</span><strong>${esc(site.join.contact)}</strong></div><button class="button button-secondary button-small" data-copy="${esc(site.join.contact)}" type="button">复制</button></div>` : ''}<p class="copy-status" role="status" aria-live="polite"></p><div class="dialog-footer">带着兴趣来，不限专业，也欢迎第一次尝试。</div></div></dialog>
    ${galleryDialog()}`;
}

export function documentPage({ title, description, active, body, route, noindex = false }) {
  // 页面末尾只在这里追加一次共用加入区，确保所有子页面也一致。
  if (active !== 'search') body += joinSection();
  const fontAssets = '<link rel="preload" href="/fonts/nano-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/nano-display-ui.woff2" as="font" type="font/woff2" crossorigin>';
  const homeAssets = !active ? '<link rel="stylesheet" href="/hero.css"><link rel="stylesheet" href="/home.css">' : '';
  const partnerAssets = active === 'partners' ? '<script defer src="/partners.js"></script><script defer src="/partner-draft.js"></script><script defer src="/partner-scenes.js"></script>' : '';
  const favicon = safeUrl(site.symbol === '/images/nanocamp-symbol.png' ? '/images/nanocamp-favicon.png' : site.symbol, true);
  const workshop = ['resources', 'partners'].includes(active);
  const album = !active || ['minicamp','projects'].includes(active);
  return `<!doctype html><html lang="zh-CN" class="no-js"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#FAFAF6"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">${metadata({ title, description, route, noindex })}${favicon ? `<link rel="icon" type="image/png" href="${esc(favicon)}">` : ''}${fontAssets}<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/details.css"><link rel="stylesheet" href="/community.css"><link rel="stylesheet" href="/discovery.css">${album ? '<link rel="stylesheet" href="/gallery.css">' : ''}${album ? '<link rel="stylesheet" href="/projects.css">' : ''}${active === 'minicamp' || active === 'projects' ? '<link rel="stylesheet" href="/recap.css">' : ''}${workshop ? '<link rel="stylesheet" href="/workshop.css">' : ''}<link rel="stylesheet" href="/collage.css">${active === 'partners' ? '<link rel="stylesheet" href="/partners.css"><link rel="stylesheet" href="/partner-draft.css"><link rel="stylesheet" href="/partner-scenes.css">' : ''}${homeAssets}<link rel="stylesheet" href="/interactions.css"><script defer src="/base.js"></script><script defer src="/app.js"></script><script defer src="/details.js"></script>${partnerAssets}<script defer src="/community.js"></script><script defer src="/discovery.js"></script>${album ? '<script defer src="/gallery.js"></script>' : ''}${active === 'minicamp' ? '<script defer src="/recap.js"></script>' : ''}${active === 'search' ? '<script type="module" src="/search.js"></script>' : ''}${workshop ? '<script defer src="/workshop.js"></script>' : ''}${!active ? '<script defer src="/hero.js"></script><script defer src="/projects-scroll.js"></script>' : ''}</head><body id="top" data-page="${active || 'home'}">${header(active)}<main id="main">${body}</main>${footer(active)}${dialogs()}</body></html>`;
}
