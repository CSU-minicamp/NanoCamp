import { programs, faqs, faqCategories, communityFounders, communityChannels, communityContact } from '../content/community.mjs';
import { esc, eyebrow, pageLink, joinButton, logoMark, media } from './components.mjs';
import { event } from '../content/site.mjs';

export function programIcon(kind) {
  const paths = {
    camp: '<path d="m6 32 14-24 14 24H6Z"/><path d="m14 32 6-13 6 13M28 8l2-4m4 10 4-1M7 14l-4-2"/>',
    talk: '<path d="M7 8h26v18H19l-8 7v-7H7V8Z"/><path d="M13 14h14M13 20h9"/>',
    build: '<rect x="5" y="6" width="22" height="20" rx="3"/><path d="M11 13h9M11 19h5M27 16h8v18H15v-8m10 0 3 3 5-6"/>',
    connect: '<circle cx="10" cy="11" r="5"/><circle cx="30" cy="11" r="5"/><circle cx="20" cy="30" r="5"/><path d="M15 11h10M12 16l5 10m11-10-5 10"/>',
  };
  return `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind] || paths.camp}</svg>`;
}

function activityCard(program, index) {
  const featured = program.id === 'minicamp';
  const descriptions = {
    sharing: '一个好用的工具，一次踩坑的经历。把你的发现，变成彼此的下一步。',
    building: '约几个伙伴，从一个小问题开始，一起做出能体验的小作品。',
    exchange: '和校园社群、行业实践者聊一聊，让不同的视角碰在一起。',
  };
  return `<article class="act-card act-card-${program.tone} ${featured ? 'act-feature' : 'act-mini'}" id="format-${esc(program.id)}">
    <div class="act-card-top"><span class="act-type">${esc(program.label)}</span><span class="act-card-number" aria-hidden="true">0${index + 1}</span></div>
    ${featured ? '<div class="act-camp-word" aria-hidden="true">mini<br>camp<span>✳</span></div>' : `<span class="act-icon" aria-hidden="true">${programIcon(program.icon)}</span>`}
    <div class="act-card-copy"><h3>${featured ? '一年一次，把想法做出来。' : esc(program.name)}</h3><p>${esc(descriptions[program.id] || program.description)}</p></div>
${featured ? `<ul class="act-tags" aria-label="活动关键词">${program.tags.map(tag => `<li>${esc(tag)}</li>`).join('')}</ul><span class="act-availability">${esc(program.status)} · 回顾已上线</span>` : ''}
    <a class="act-card-link" href="${esc(program.href)}">${esc(program.action)}<span aria-hidden="true">↗</span></a>
  </article>`;
}

function filterBar(options, label) {
  return `<div class="filter-bar" role="group" aria-label="${label}" data-filter-controls hidden>${options.map(([value, name]) => `<button type="button" data-filter="${value}" aria-pressed="${value === 'all'}">${esc(name)}</button>`).join('')}</div>`;
}

export function ecosystem() {
 return `<section class="community-ecosystem" aria-labelledby="ecosystem-title"><div class="container section"><div class="section-top"><h2 id="ecosystem-title">不只一年一次。<br>平常，也一起创造。</h2></div><div class="community-rows">${programs.slice(1).map(p=>`<a class="community-row" href="${p.href}"><span class="row-label">${esc(p.label)}</span><div><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p></div><span class="row-action">${esc(p.action)} <b aria-hidden="true">↗</b></span></a>`).join('')}</div></div></section>`;
}

export function activitiesPage() {
  const photo = media({ src: event.cover, alt: event.coverAlt || 'minicamp 活动现场合照', fullSrc: event.coverFull, caption: 'minicamp 2026 · 我们的第一次相遇', label: 'MINICAMP / FIELD NOTES', id: '01', classes: 'act-photo' });
  return `<section class="page-hero container act-hero" aria-labelledby="activities-title">
    <div class="act-hero-copy"><p class="act-kicker"><span aria-hidden="true">✳</span> NANOCAMP / 活动</p><h1 id="activities-title">有趣的事，<br>不止发生<span class="act-highlight">一次。<svg viewBox="0 0 170 60" aria-hidden="true"><path d="M12 31C29 9 113 6 148 17S170 47 126 51S22 54 12 36"/></svg></span></h1><p class="page-subtitle">年度 minicamp，把大家聚在一起。<br>日常分享与共创，让相遇有下一步。</p><div class="act-hero-actions"><a class="act-button" href="#formats">找到你的下一次相遇 <span aria-hidden="true">↗</span></a><a class="text-link" href="#records">看看已经发生的故事</a></div><p class="act-hero-footnote">不限专业，带着好奇心来。</p></div>
    <div class="act-photo-stage"><span class="act-photo-star" aria-hidden="true">✳</span><figure class="act-photo-paper">${photo}<figcaption><span>我们的第一次相遇。</span></figcaption></figure><div class="act-date-sticker"><span>相遇的两天</span><strong>${esc(event.date || '日期待补充')}</strong><span>MEET. BUILD. TOGETHER.</span></div></div>
  </section>
  <section id="formats" class="container section act-formats" aria-labelledby="formats-title"><div class="act-section-heading"><div><p class="act-section-index">01 / 一起做点什么</p><h2 id="formats-title">找到你想参与的那一种。</h2></div><p class="act-section-note">一次集中共创，或一次日常交流。<br>具体场次与参与方式，以正式公告为准。</p></div><div class="act-programs">${programs.map(activityCard).join('')}</div></section>
  <section id="records" class="container section act-records" aria-labelledby="records-title"><div class="act-section-heading"><div><p class="act-section-index">02 / 相遇留下的记录</p><h2 id="records-title">把一起动手的时刻，留下来。</h2></div><span class="act-archive-label mono">THE FIRST CHAPTER ↘</span></div><article class="act-ticket"><div class="act-ticket-number"><span class="mono">CHAPTER</span><strong>01</strong><span class="act-ticket-year">2026</span></div><div class="act-ticket-main"><span class="act-ticket-status">已结束 · 可回顾</span><h3>${esc(event.title)} 黑客松</h3><dl class="act-ticket-facts"><div><dt>时间</dt><dd>${esc(event.date || '日期待补充')}</dd></div><div><dt>地点</dt><dd>${esc(event.location || '地点待补充')}</dd></div></dl><div class="act-ticket-links"><a class="text-link" href="/minicamp/">阅读活动回顾</a><a class="text-link" href="/projects/">浏览社区作品</a></div></div><div class="act-ticket-stub" aria-hidden="true"><span>GOOD<br>THINGS<br>HAPPEN<br>TOGETHER.</span><i></i><small>NC / 2026 / 01</small></div></article><article class="act-ticket act-ticket-ghost" aria-labelledby="next-event-title"><div class="act-ticket-number"><span class="mono">CHAPTER</span><strong>02</strong><span class="act-ticket-year">待开启</span></div><div class="act-ticket-main"><span class="act-ticket-status">尚未举办</span><h3 id="next-event-title">下一场活动，敬请期待。</h3><dl class="act-ticket-facts"><div><dt>时间</dt><dd>待公布</dd></div><div><dt>地点</dt><dd>待公布</dd></div></dl><p class="act-ticket-pending">活动主题与安排确认后，会在这里公布。</p></div><div class="act-ticket-stub" aria-hidden="true"><span>NEXT<br>CHAPTER<br>TO BE<br>WRITTEN.</span><i></i><small>NC / NEXT / 02</small></div></article><div class="act-next"><span class="act-next-plus" aria-hidden="true">+</span><div><h3>下一次相遇，也许从你的想法开始。</h3><p>后续场次确认后公布。想分享经验，或找伙伴共创？先来认识社区。</p></div><a class="text-link" href="/community/">看看怎样参与</a></div></section>`;
}

function communityHistory() {
  return `<section id="history" class="container section community-history" aria-labelledby="history-title" data-community-reveal><h2 id="history-title">我们是谁？</h2><div class="community-story"><p class="community-story-lead">NanoCamp 是一个面向<span class="blue-text">跨专业学生的创造者社区</span>。</p><p class="community-story-copy">从首届 minicamp 出发，把现场的相遇延续为日常的分享、共创与交流。</p><ul class="community-founders" aria-label="联合创办方"><li class="community-founders-label">联合创办</li>${communityFounders.map(founder => `<li class="community-founder"><span class="founder-mark founder-mark-${founder.mark}"><img src="${esc(founder.image)}" alt="" width="${founder.width}" height="${founder.height}" loading="lazy" decoding="async"></span><span>${esc(founder.name)}</span></li>`).join('')}</ul></div></section>`;
}

function communityMediaIcon(name) {
  const files = { '抖音': 'douyin.ico', '小红书': 'xiaohongshu.png', 'B站': 'bilibili.ico', '微信': 'wechat.ico', 'QQ': 'qq.png' };
  return `<img class="community-media-icon" src="/images/social/${files[name]}" width="36" height="36" alt="" aria-hidden="true">`;
}

function communityConnections() {
  const cards = [
    ...communityChannels.map(channel => ({ name: channel.name, icon: channel.name, body: '<a class="contact-paper-account" href="' + esc(channel.href) + '" target="_blank" rel="noopener noreferrer" aria-label="浏览' + esc(channel.name) + '主页，' + esc(channel.label) + ' ' + esc(channel.id) + '（新标签页打开）">' + esc(channel.id) + ' <span aria-hidden="true">↗</span></a>' })),
    { name: '微信群', icon: '微信', body: '<a class="contact-paper-qr" href="/images/community-groups/wechat-qr.png" target="_blank" rel="noopener noreferrer" aria-label="查看微信群二维码原图（新标签页打开）"><img src="/images/community-groups/wechat-qr.png" width="706" height="706" alt="NanoCamp 微信群二维码，图片标注 10 月 12 日前有效"></a><p class="contact-paper-note">二维码有效期至 10 月 12 日；如已失效，可<a href="#contact">联系 QQ</a>。</p>' },
    { name: 'QQ 群', icon: 'QQ', body: '<a class="contact-paper-qr" href="/images/community-groups/qq-qr.png" target="_blank" rel="noopener noreferrer" aria-label="查看 QQ 群二维码原图（新标签页打开）"><img src="/images/community-groups/qq-qr.png" width="860" height="860" alt="NanoCamp QQ 群二维码，群号 1126393930"></a><p class="contact-paper-note">使用 QQ 扫码，或搜索群号 1126393930 加入。</p>' },
    { name: 'QQ', icon: 'QQ', body: '<p class="contact-paper-account">' + esc(communityContact.qq) + '</p><p class="contact-paper-note">搜索 QQ 号，添加好友。</p>' },
  ];
  return '<section id="updates" class="container section community-updates" aria-labelledby="updates-title" data-community-reveal><h2 id="updates-title">关注<span class="blue-text">社区动态。</span></h2><div id="groups" class="contact-fan" data-contact-fan>' + cards.map((card, index) => '<article class="contact-paper" data-contact-paper style="--slot:' + (index - 2.5) + ';--paper-order:' + (index + 1) + '"' + (index === 5 ? ' id="contact"' : '') + '><button type="button" class="contact-paper-tab" aria-expanded="true" aria-controls="contact-paper-body-' + index + '" aria-label="显示' + card.name + '联系方式">' + communityMediaIcon(card.icon) + '<span>' + card.name + '</span></button><div class="contact-paper-body" id="contact-paper-body-' + index + '"><h3>' + card.name + '</h3>' + card.body + '</div></article>').join('') + '</div></section>';
}

export function communityPage() {
  return `<section class="page-hero container community-page-hero"><div class="page-title-row"><div><h1><span class="brand-blue">带上好奇心，<br>找到</span><span class="brand-mint">你的同路人。</span></h1><p class="page-subtitle">从提问、分享，到做出一个小作品。</p></div><div class="community-badge" aria-hidden="true"><span class="community-paper">YOU</span><span class="community-paper-plus">+</span><span class="community-paper">US</span></div></div></section>
  ${communityHistory()}
  <section id="start" class="container section start-section" aria-labelledby="start-title" data-community-reveal><h2 id="start-title">第一次来，<span class="blue-text">不用准备得很完美。</span></h2><div class="community-steps-layout"><svg class="community-step-curve" viewBox="0 0 1000 100" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M40 50 C210 -12 275 0 380 40 S650 114 790 50" stroke="#a6c4fa" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg><ol class="start-steps"><li><span class="step-number">01</span><h3>说说你的好奇</h3><p>分享你的兴趣，或一个想探索的问题。</p></li><li><span class="step-number">02</span><h3>找到共同兴趣</h3><p>听一次分享，先认识彼此。</p></li><li><span class="step-number">03</span><h3>一起迈出第一步</h3><p>画张草图，验证想法，做个小原型。</p></li></ol></div></section>
  <section class="community-pathways" aria-labelledby="paths-title" data-community-reveal><div class="container section"><h2 id="paths-title">你可以这样参与。</h2><div class="role-grid"><article id="build" class="community-pathway-item"><h3>组队，做一个小作品</h3><p>在 minicamp 黑客松中，找到互补的队友，把一个好奇的问题，做成可以演示的小作品。</p><a href="/resources/from-idea-to-demo/">带走一份最小实验单 <span aria-hidden="true">↗</span></a></article><article id="share" class="community-pathway-item"><h3>开讲，分享你的发现</h3><p>在技术交流分享会上，演示一个好用的工具，或聊聊一次踩坑经历，让你的经验成为别人的启发。</p><a href="/resources/host-a-sharing/">看看轻量分享指南 <span aria-hidden="true">↗</span></a></article><article id="help" class="community-pathway-item"><h3>搭把手，参与活动幕后</h3><p>为黑客松或分享会设计海报、记录现场、协助流程。从一个具体的小任务开始，支持一次相遇。</p><a href="/activities/">认识社区的活动形式 <span aria-hidden="true">↗</span></a></article><article id="connect" class="community-pathway-item"><h3>聊一聊，遇见不同视角</h3><p>在校园交流或校企对谈中，和不同学校的伙伴聊聊想法，向行业实践者提问，看看课堂之外的探索。</p><a href="/partners/">探索交流与合作 <span aria-hidden="true">↗</span></a></article></div></div></section>
  <section id="principles" class="container section community-principles" aria-labelledby="principles-title" data-community-reveal><h2 id="principles-title">一起创造，也一起<span class="blue-text">照顾彼此。</span></h2><div class="principles-grid"><article><h3>给尝试留空间</h3><p>认真倾听，欢迎不同经验。反馈具体，判断慢一点。</p></article><article><h3>让贡献被看见</h3><p>说明来源与分工，尊重原创、授权与未公开的想法。</p></article><article><h3>把边界讲清楚</h3><p>沟通时间与职责，公开照片、作品和联系方式前先征得同意。</p></article></div></section>
  <section class="container community-help" data-community-reveal><h2>还有一点好奇？</h2>${pageLink('/faq/','去常见问题看看')}</section>${communityConnections()}`;
}

export function faqItem(item) {
  const label = faqCategories.find(([key]) => key === item.category)?.[1] || '';
  return `<details id="${item.id}" class="faq-item" data-filter-item data-category="${item.category}" data-search="${esc(item.question + ' ' + item.answer + ' ' + label)}"><summary><span class="faq-category">${esc(label)}</span><span class="faq-question">${esc(item.question)}</span><span class="faq-plus" aria-hidden="true"></span></summary><div class="faq-answer"><p>${esc(item.answer)}</p><div class="faq-answer-links">${item.href ? `<a class="text-link" href="${item.href}">${esc(item.link)}</a>` : ''}<a class="faq-permalink" href="#${item.id}" aria-label="定位问题：${esc(item.question)}"><span aria-hidden="true">#</span> 问题直达</a></div></div></details>`;
}

export function faqPage() {
  return `<section class="page-hero container faq-hero">${eyebrow('A LITTLE LESS UNKNOWN.')}<h1>好奇的问题，<br><span class="blue-text">慢慢说清楚。</span></h1><p class="page-subtitle">第一次来，或准备迈出下一步，<br>先从这些常见问题开始认识 NanoCamp。</p></section><section class="container faq-directory" data-directory="faq" aria-label="常见问题列表"><div class="directory-tools" data-search-controls hidden><label for="faq-search" class="search-label">搜索问题</label><div class="search-field"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="faq-search" type="search" data-search-input placeholder="试试「专业」「报名」或「分享」" autocomplete="off" maxlength="120"><button type="button" data-search-clear aria-label="清空搜索" hidden>×</button></div></div>${filterBar(faqCategories, '筛选问题类型')}<p class="filter-status" data-filter-status role="status" aria-live="polite" hidden></p><div class="faq-list">${faqs.map(faqItem).join('')}</div><div class="directory-empty" data-filter-empty hidden><span aria-hidden="true">?</span><h2>还没有找到这个问题。</h2><p>换个关键词试试，或者清除筛选，看看所有问题。</p><button type="button" class="button button-secondary" data-filter-reset>查看所有问题 <span aria-hidden="true">↗</span></button></div><div class="faq-note"><span aria-hidden="true">✳</span><p>没有看到你关心的问题？<a href="/community/">先了解社区参与方式</a>，官方联系渠道更新后，也欢迎继续交流。</p></div></section>`;
}
