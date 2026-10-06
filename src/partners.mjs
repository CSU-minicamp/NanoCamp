import { partnership } from '../content/partners.mjs';
import { esc, safeUrl } from './components.mjs';
import { partnerDraft } from './partner-draft.mjs';
import { ideasScene, photoAlbumScene, puzzleScene } from './partner-scenes.mjs';

const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg>';
const plus = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14"/><path class="collab-plus-vertical" d="M12 5v14"/></svg>';
const photoIcon = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="4" y="6" width="24" height="20" rx="2"/><circle cx="11" cy="12" r="2"/><path d="m5 23 7-7 5 5 4-4 7 7"/></svg>';
const caseTheme = item => ['mint', 'lilac', 'yellow'].includes(item.theme) ? item.theme : 'mint';

function brandImage(item) {
  const logo = safeUrl(item.logo, true);
  return logo ? `<img class="collab-brand-image" src="${esc(logo)}" alt="" aria-hidden="true" decoding="async">` : '';
}

function caseStudy(item) {
  const theme = caseTheme(item);
  const url = safeUrl(item.url, true);
  return `<article class="collab-case collab-case--${theme}" id="partner-${esc(item.id)}" aria-labelledby="partner-${esc(item.id)}-name">
    <a class="collab-case-trigger" aria-label="查看${esc(item.name)}合作详情" href="#partner-${esc(item.id)}-details" data-partner-open="partner-${esc(item.id)}-details" aria-haspopup="dialog">
      <h3 class="sr-only" id="partner-${esc(item.id)}-name">${esc(item.name)}</h3><div class="collab-case-sheet">${brandImage(item)}</div>
      <div class="collab-case-caption"><p>${esc(item.summary?.trim() || '合作介绍与现场记录待补充。')}</p></div>
    </a>${url ? `<a href="${esc(url)}" class="collab-case-link">阅读合作记录 ${arrow}</a>` : ''}
  </article>`;
}

function caseDetails(item) {
  const list = values => Array.isArray(values) && values.length ? `<ul>${values.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : '<p>合作内容待补充。</p>';
  const photos = (Array.isArray(item.photos) ? item.photos : []).filter(photo => safeUrl(photo.src, true));
  return `<dialog class="collab-detail collab-case--${caseTheme(item)}" id="partner-${esc(item.id)}-details" aria-labelledby="partner-${esc(item.id)}-detail-title">
    <button class="collab-detail-close" type="button" data-partner-close aria-label="关闭${esc(item.name)}合作详情" autofocus><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
    <header class="collab-detail-header">${brandImage(item)}<h2 id="partner-${esc(item.id)}-detail-title">${esc(item.name)}${item.tagline ? `<span>${esc(item.tagline)}</span>` : ''}</h2><dl class="collab-detail-time"><div><dt>合作时间</dt><dd>${esc(item.period?.trim() || '具体日期待补充')}</dd></div></dl></header>
    <div class="collab-detail-body"><div class="collab-detail-exchange"><section aria-labelledby="partner-${esc(item.id)}-support"><h3 id="partner-${esc(item.id)}-support">赞助内容</h3>${list(item.sponsorship)}</section><section aria-labelledby="partner-${esc(item.id)}-promotion"><h3 id="partner-${esc(item.id)}-promotion">我们的宣传支持</h3>${list(item.promotion)}</section></div>
      <section class="collab-detail-photos" aria-labelledby="partner-${esc(item.id)}-photos"><h3 id="partner-${esc(item.id)}-photos">风采照片</h3>${photos.length ? `<div class="collab-photo-grid">${photos.map(photo => `<figure><img src="${esc(safeUrl(photo.src, true))}" alt="${esc(photo.alt || item.name + '合作现场')}" loading="lazy" decoding="async">${photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : `<div class="collab-photo-placeholder">${photoIcon}<p>照片待补充</p></div>`}</section>
    </div>
  </dialog>`;
}

function exchangeList(items) {
  return `<dl class="collab-exchange-list">${items.map(item => `<div><dt>${esc(item.title)}</dt><dd>${esc(item.description)}</dd></div>`).join('')}</dl>`;
}

function emailContact(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  const valid = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
  return `<div class="collab-email"><p class="collab-email-label">合作邮箱</p>${valid
    ? `<button class="collab-email-link" type="button" data-copy-email="${esc(email)}" aria-label="复制合作邮箱 ${esc(email)}" disabled><span data-email-value>${esc(email)}</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button><p>欢迎告诉我们你的团队、合作想法和大致时间。</p><p class="collab-email-status" role="status" aria-live="polite" data-email-status></p>`
    : '<p class="collab-email-pending">合作邮箱待补充</p><p>邮箱公布后，欢迎带着你的合作想法来信。</p>'}</div>`;
}

export function partnersPage(data = partnership) {
  return `<section class="container collab-opening" aria-labelledby="collab-title">
    <div class="collab-intro"><h1 id="collab-title"><span class="brand-blue">期待与你</span><span class="brand-mint">相遇</span></h1><div><p>从一年一度的 minicamp，到平日的技术分享与校园交流。<br>期待和你一起，创造更多相遇的机会。</p></div></div>
    <div class="collab-cases-heading"><h2>合作样例</h2></div>
    <div class="collab-cases">${data.cases.map(caseStudy).join('')}</div>
    <div class="collab-case-details">${data.cases.map(caseDetails).join('')}</div>
  </section>
  <section id="possibilities" class="container collab-section collab-formats" aria-labelledby="possibilities-title">
    <div class="collab-section-intro"><h2 id="possibilities-title">我们接受<br>哪些合作？</h2>${ideasScene(data.formats)}</div>
    <div class="collab-format-list">${data.formats.map((item, index) => `<article id="collab-format-${index}" data-idea-section="${index}" tabindex="-1" aria-labelledby="collab-format-title-${index}"${item.featured ? ' class="collab-format-featured"' : ''}><h3 id="collab-format-title-${index}">${esc(item.name)}</h3><p>${esc(item.description)}</p><p class="collab-format-examples">${esc(item.examples)}</p></article>`).join('')}</div>
  </section>
  <section id="what-we-bring" class="collab-offers" aria-labelledby="collab-offers-title"><div class="container collab-section collab-exchange">
    <div class="collab-section-intro"><h2 id="collab-offers-title">我们能带来什么。</h2>${photoAlbumScene()}</div>${exchangeList(data.offers)}
  </div></section>
  <section id="what-we-need" class="container collab-section collab-exchange collab-requests" aria-labelledby="collab-requests-title">
    <div class="collab-section-intro"><h2 id="collab-requests-title">我们期待什么</h2>${puzzleScene()}</div>${exchangeList(data.requests)}
  </section>
  <section id="contact" class="container collab-contact" aria-labelledby="collab-contact-title" tabindex="-1">
    <div class="collab-contact-intro"><h2 id="collab-contact-title">下一次相遇，<span>从一封信开始。</span></h2></div>
    <details id="brief" class="collab-draft"><summary><span>把合作想法整理成一份草稿</span>${plus}</summary><div class="collab-draft-content"><p class="collab-draft-note">左侧填写要点，右侧实时预览。填写主题后即可复制或下载，内容只保留在当前页面，需要你自行发送。</p>${partnerDraft()}</div></details>
    ${emailContact(data.email)}
  </section>`;
}
