import { site } from '../content/site.mjs';
import { esc, safeUrl } from './components.mjs';
import { metadata } from './metadata.mjs';
import { hero } from './hero.mjs';

// 首页首屏的海报文档。它只在首页的 iframe 里出现，因此不放站点 header / 页脚 / 弹窗，
// 但样式表与脚本的顺序和首页保持一致，海报的版式与原先嵌在首页时逐像素相同。
// <base target="_top"> 让海报里的链接（了解参与方式、回看 minicamp）跳转整个页面，
// 而不是只把 iframe 自己导航走。
export function renderIntroPage() {
  const title = 'NanoCamp 首页海报';
  const description = '让有趣的人相遇，让相遇的人一起创造。';
  const favicon = safeUrl(site.symbol === '/images/nanocamp-symbol.png' ? '/images/nanocamp-favicon.png' : site.symbol, true);
  const fontAssets = '<link rel="preload" href="/fonts/nano-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/nano-display-ui.woff2" as="font" type="font/woff2" crossorigin>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#FAFAF6"><base target="_top"><title>${esc(title)}</title><meta name="description" content="${esc(description)}">${metadata({ title, description, route: '/', noindex: true })}${favicon ? `<link rel="icon" type="image/png" href="${esc(favicon)}">` : ''}${fontAssets}<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/details.css"><link rel="stylesheet" href="/community.css"><link rel="stylesheet" href="/discovery.css"><link rel="stylesheet" href="/gallery.css"><link rel="stylesheet" href="/projects.css"><link rel="stylesheet" href="/collage.css"><link rel="stylesheet" href="/hero.css"><link rel="stylesheet" href="/interactions.css"><script defer src="/app.js"></script><script defer src="/hero.js"></script></head><body data-page="home" class="intro-page"><main id="main">${hero()}</main></body></html>`;
}
