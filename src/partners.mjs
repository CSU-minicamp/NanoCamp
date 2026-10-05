import { partnership } from '../content/partners.mjs';
import { esc, safeUrl } from './components.mjs';
import { partnerDraft } from './partner-draft.mjs';

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
    <a class="collab-case-trigger" href="#partner-${esc(item.id)}-details" data-partner-open="partner-${esc(item.id)}-details" aria-haspopup="dialog">
      <div class="collab-case-sheet">${brandImage(item)}<h3 id="partner-${esc(item.id)}-name">${esc(item.name)}${item.tagline ? `<span>${esc(item.tagline)}</span>` : ''}</h3><span class="collab-case-action">查看合作详情</span></div>
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
    ? `<a class="collab-email-link" href="mailto:${esc(encodeURI(email))}?subject=${encodeURIComponent('与 NanoCamp 一起合作')}"><span>${esc(email)}</span>${arrow}</a><p>欢迎告诉我们你的团队、合作想法和大致时间。</p>`
    : '<p class="collab-email-pending">合作邮箱待补充</p><p>邮箱公布后，欢迎带着你的合作想法来信。</p>'}</div>`;
}

export function partnersPage(data = partnership) {
  return `<section class="container collab-opening" aria-labelledby="collab-title">
    <div class="collab-intro"><h1 id="collab-title">期待与你<span>相遇</span></h1><div><p>从一年一度的 minicamp，到平日的技术分享与校园交流。<br>期待和你一起，创造更多相遇的机会。</p></div></div>
    <div class="collab-cases-heading"><h2>合作样例</h2></div>
    <div class="collab-cases">${data.cases.map(caseStudy).join('')}</div>
    <div class="collab-case-details">${data.cases.map(caseDetails).join('')}</div>
  </section>
  <section id="possibilities" class="container collab-section collab-formats" aria-labelledby="possibilities-title">
    <div class="collab-section-intro"><h2 id="possibilities-title">我们接受<br>哪些合作？</h2><p>一次分享，一场共创，<br>或者一年一度的重要相遇。</p><p class="collab-side-note">不必一开始就有完整方案。<br>从一个共同感兴趣的主题聊起。</p></div>
    <div class="collab-format-list">${data.formats.map(item => `<article${item.featured ? ' class="collab-format-featured"' : ''}><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p><p class="collab-format-examples">${esc(item.examples)}</p></article>`).join('')}</div>
  </section>
  <section id="what-we-bring" class="collab-offers" aria-labelledby="collab-offers-title"><div class="container collab-section collab-exchange">
    <div class="collab-section-intro"><h2 id="collab-offers-title">我们能带来什么。</h2><p>把社区的好奇心与行动力，<br>变成彼此都能有所收获的合作。</p><p class="collab-side-note">具体参与形式与传播安排，<br>会结合每次合作一起确认。</p></div>${exchangeList(data.offers)}
  </div></section>
  <section id="what-we-need" class="container collab-section collab-exchange collab-requests" aria-labelledby="collab-requests-title">
    <div class="collab-section-intro"><h2 id="collab-requests-title">也期待，<br>你的一份支持。</h2><p>带来你擅长的部分，<br>让更多想法有机会走到现场。</p></div>${exchangeList(data.requests)}
  </section>
  <section id="contact" class="container collab-contact" aria-labelledby="collab-contact-title">
    <div class="collab-contact-intro"><h2 id="collab-contact-title">下一次相遇，<span>从一封信开始。</span></h2><p>你来自哪里，想一起做什么？<br>简单介绍一下，就可以开始对话。</p></div>
    <details id="brief" class="collab-draft"><summary><span>把合作想法整理成一份草稿</span>${plus}</summary><div class="collab-draft-content"><p class="collab-draft-note">填写几个要点，生成可复制、可下载的草稿。内容只保留在当前页面，需要你自行发送。</p>${partnerDraft()}</div></details>
    ${emailContact(data.email)}
  </section>`;
}
