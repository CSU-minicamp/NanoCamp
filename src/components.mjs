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

const arrowIcon = (external = false) => `<svg class="link-arrow" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="${external ? 'M5 15 15 5M5 5h10v10' : 'M3 10h13m-5-5 5 5-5 5'}"/></svg>`;
export const joinButton = (label = '加入社区', classes = '') => `<button type="button" class="button button-primary ${classes}" data-join><span class="button-label">${label}</span><span class="button-plus" aria-hidden="true">+</span></button><a class="button button-primary join-fallback ${classes}" href="/faq/#join-channel">${label}<span aria-hidden="true">↗</span></a>`;
export const pageLink = (href, label, classes = '') => `<a class="button button-secondary ${classes}" href="${href}"><span class="button-label">${label}</span>${arrowIcon()}</a>`;
// Section headings carry the hierarchy; keep the shared call signature.
export const eyebrow = () => '';

export function header(active) {
  return `<a class="skip-link" href="#main">跳到主要内容</a><header class="site-header"><div class="container header-inner">
    <a class="brand" href="/" aria-label="NanoCamp 首页">${wordmark()}</a>
    <nav class="desktop-nav" aria-label="主导航">${navLinks(active, true)}${moreNavigation(active)}</nav>
    <div class="header-actions">${joinButton(site.join.qrCode || site.join.contact ? '加入社区' : '加入方式', 'button-small')}<button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="mobile-nav" aria-label="打开导航菜单"><span></span><span></span></button></div>
    <nav id="mobile-nav" class="mobile-nav" aria-label="手机导航" hidden>${navLinks(active)}</nav>
  </div><div class="reading-progress" data-reading-progress hidden aria-hidden="true"><span></span></div></header>`;
}

function navLinks(active, compact = false) {
  return [['minicamp', '/minicamp/', 'minicamp'], ['activities', '/activities/', '活动'], ['projects', '/projects/', '作品'], ['resources', '/resources/', '资源'], ['community', '/community/', '社区'], ['partners', '/partners/', '合作'], ['about', '/about/', '关于'], ['search', '/search/', '搜索']].filter(([key]) => !compact || ['minicamp', 'projects', 'activities', 'community'].includes(key)).map(([key, href, name]) => `<a href="${href}" ${key === 'search' ? 'class="nav-search" aria-label="站内搜索" data-search-shortcut' : ''} ${active === key ? 'aria-current="page"' : ''}>${key === 'search' ? '<svg class="nav-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><span class="nav-search-label">搜索</span>' : name}</a>`).join('');
}

function moreNavigation(active) {
  const links=[['resources','/resources/','共创资源'],['partners','/partners/','交流合作'],['about','/about/','关于社区'],['search','/search/','站内搜索']];
  return `<details class="nav-more"><summary>更多<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><div class="nav-more-panel">${links.map(([key,href,name])=>`<a href="${href}" ${active===key?'aria-current="page"':''}>${name}</a>`).join('')}</div></details>`;
}

export function media({ src, alt = '活动照片', label = '现场照片', id = '01', theme = 'blue', classes = '', kind = 'moment', fullSrc = null, caption = alt, album = 'moments', albumLabel = 'minicamp 现场相册' } = {}) {
  const image = safeUrl(src, true);
  const original = safeUrl(fullSrc, true) || image;
  const placeholder = `<div class="media-placeholder ${image ? 'media-fallback' : ''}" ${image ? 'hidden' : ''}><span class="media-corner corner-tl" aria-hidden="true"></span><span class="media-corner corner-br" aria-hidden="true"></span><span class="media-glyph" aria-hidden="true">${kind === 'project' ? esc(id) : '+'}</span><span class="media-placeholder-caption">${kind === 'project' ? '作品封面' : '现场照片'}待补充</span></div>`;
  return `<div class="media-frame tone-${esc(theme)} ${esc(classes)} ${image ? 'has-image' : ''}">${image ? `<a class="media-open" href="${esc(original)}" data-lightbox="${esc(original)}" data-caption="${esc(caption)}" data-album="${esc(album)}" data-album-label="${esc(albumLabel)}" aria-label="查看大图：${esc(alt)}"><img src="${esc(image)}" alt="${esc(alt)}" loading="lazy" decoding="async" data-media-image><span class="media-zoom" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4"/></svg>查看照片</span></a>` : ''}${placeholder}<div class="media-label"><span>${esc(label)}</span><span>${esc(id)}</span></div></div>`;
}

export function projectCard(project) {
  const intro = safeUrl(project.introUrl);
  const demo = safeUrl(project.demoUrl);
  return `<article id="project-${esc(project.id)}" class="project-card" data-detail-surface>${media({ src: project.cover, alt: project.coverAlt || project.title, label: 'MINICAMP / PROJECT', id: project.id, theme: project.theme, kind: 'project', fullSrc: project.coverFull, caption: project.title, album: 'projects', albumLabel: '社区作品封面' })}
    <div class="project-meta"><span>${esc(project.category || '首届 minicamp')}</span><span class="mono">NO. ${esc(project.id)}</span></div>
    <h3>${esc(project.title)}</h3><p>${esc(project.description)}</p>
    ${project.members?.length ? `<p class="project-members">${project.members.map(esc).join(' · ')}</p>` : ''}
    <div class="project-links">${intro ? `<a href="${esc(intro)}" target="_blank" rel="noopener noreferrer">作品介绍${arrowIcon(true)}<span class="sr-only">（新标签页打开）</span></a>` : '<span class="unavailable">介绍待补充</span>'}${demo ? `<a href="${esc(demo)}" target="_blank" rel="noopener noreferrer">体验 Demo${arrowIcon(true)}<span class="sr-only">（新标签页打开）</span></a>` : '<span class="unavailable">Demo 待补充</span>'}</div>
  </article>`;
}

export function joinSection(compact = false) {
  const available=Boolean(site.join.qrCode || site.join.contact);
  return `<section class="join-section ${compact?'join-compact':''}" aria-labelledby="join-heading"><div class="container join-inner"><div><h2 id="join-heading">下一个有趣的想法，<br>从遇见你开始。</h2><p>带上好奇心，来认识和你一起动手的伙伴。</p>${available?joinButton('加入 NanoCamp'):pageLink('/community/','了解参与方式','button-white')}</div><div class="join-paper"><strong>See you<br>at NanoCamp.</strong><span>${available?'欢迎每一份好奇心。':'加入渠道尚未公布，可先阅读参与指南。'}</span>${joinButton(available?'查看加入渠道':'查看加入方式','button-small')}</div></div></section>`;
}

export function shareButton(label = '复制页面链接') {
  return `<button type="button" class="page-share-button" data-share-page hidden aria-controls="share-manual"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 10v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-5M5 13H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"/></svg><span data-share-label>${label}</span></button>`;
}
export function footer() {
  return `<footer class="site-footer"><div class="container"><div class="footer-top"><a class="brand" href="/" aria-label="NanoCamp 首页">${wordmark()}</a><p>Meet. Build.<br>Make something together.</p><nav aria-label="页脚导航"><a href="/minicamp/">年度 minicamp</a><a href="/activities/">活动总览</a><a href="/projects/">社区作品</a><a href="/community/">参与指南</a><a href="/resources/">共创资源</a><a href="/partners/">交流合作</a><a href="/faq/">常见问题</a><a href="/about/">关于我们</a><a href="/search/">站内搜索</a></nav></div><div class="footer-bottom"><span class="footer-signoff"><i aria-hidden="true"></i>一个属于学生创造者的社区。</span><div class="footer-tools"><button type="button" class="site-motion-toggle" data-site-motion-toggle aria-pressed="false" hidden><span class="motion-levels" aria-hidden="true"><i></i><i></i><i></i></span><span>暂停全站动效</span></button>${shareButton()}<a class="back-to-top" href="#top"><span>回到顶部</span><span class="back-top-arrow" aria-hidden="true">↑</span></a></div></div><p class="share-status" role="status" aria-live="polite" data-share-status></p><div id="share-manual" class="share-fallback" data-share-fallback hidden><label for="share-url">手动复制链接</label><input id="share-url" type="text" readonly autocomplete="off" spellcheck="false"><button type="button">收起</button></div></div></footer>`;
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
  const fontAssets = '<link rel="preload" href="/fonts/nano-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/nano-display-ui.woff2" as="font" type="font/woff2" crossorigin>';
  const heroAssets = !active ? '<link rel="stylesheet" href="/hero.css">' : '';
  const partnerAssets = active === 'partners' ? '<script defer src="/partners.js"></script>' : '';
  const favicon = safeUrl(site.symbol === '/images/nanocamp-symbol.png' ? '/images/nanocamp-favicon.png' : site.symbol, true);
  const workshop = ['resources', 'partners'].includes(active);
  const album = !active || ['minicamp','projects'].includes(active);
  return `<!doctype html><html lang="zh-CN" class="no-js"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#FAFAF6"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">${metadata({ title, description, route, noindex })}${favicon ? `<link rel="icon" type="image/png" href="${esc(favicon)}">` : ''}${fontAssets}<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/details.css"><link rel="stylesheet" href="/community.css"><link rel="stylesheet" href="/discovery.css">${album ? '<link rel="stylesheet" href="/gallery.css">' : ''}${active === 'minicamp' ? '<link rel="stylesheet" href="/recap.css">' : ''}${workshop ? '<link rel="stylesheet" href="/workshop.css">' : ''}<link rel="stylesheet" href="/collage.css">${active === 'partners' ? '<link rel="stylesheet" href="/partners.css">' : ''}${heroAssets}<script defer src="/app.js"></script><script defer src="/details.js"></script>${partnerAssets}<script defer src="/community.js"></script><script defer src="/discovery.js"></script>${album ? '<script defer src="/gallery.js"></script>' : ''}${active === 'minicamp' ? '<script defer src="/recap.js"></script>' : ''}${active === 'search' ? '<script type="module" src="/search.js"></script>' : ''}${workshop ? '<script defer src="/workshop.js"></script>' : ''}${!active ? '<script defer src="/hero.js"></script>' : ''}</head><body id="top" data-page="${active || 'home'}">${header(active)}<main id="main">${body}</main>${footer()}${dialogs()}</body></html>`;
}
