import { programs, faqs, faqCategories, communityFounders, communityChannels, communityContact } from '../content/community.mjs';
import { esc, eyebrow, pageLink, joinButton, logoMark } from './components.mjs';

const arrows = '<span aria-hidden="true" class="card-arrow">↗</span>';
export function programIcon(kind) {
  const paths = {
    camp: '<path d="m6 32 14-24 14 24H6Z"/><path d="m14 32 6-13 6 13M28 8l2-4m4 10 4-1M7 14l-4-2"/>',
    talk: '<path d="M7 8h26v18H19l-8 7v-7H7V8Z"/><path d="M13 14h14M13 20h9"/>',
    build: '<rect x="5" y="6" width="22" height="20" rx="3"/><path d="M11 13h9M11 19h5M27 16h8v18H15v-8m10 0 3 3 5-6"/>',
    connect: '<circle cx="10" cy="11" r="5"/><circle cx="30" cy="11" r="5"/><circle cx="20" cy="30" r="5"/><path d="M15 11h10M12 16l5 10m11-10-5 10"/>',
  };
  return `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind] || paths.camp}</svg>`;
}

function programCard(program, index, compact = false) {
  return `<article class="program-card program-${program.tone} ${compact ? 'program-compact' : ''}" data-category="${program.category}" data-filter-item data-detail-surface>
    <span class="program-ghost-num" aria-hidden="true">0${index + 1}</span><div class="program-top"><span class="program-icon">${programIcon(program.icon)}</span><span class="mono">0${index + 1} / ${esc(program.en)}</span></div>
    <div class="program-label">${esc(program.label)}<span>${esc(program.status)}</span></div>
    <h3><a href="${program.href}">${esc(program.name)}${arrows}</a></h3><p>${esc(program.description)}</p>
${compact ? '' : `<ul class="tag-list" aria-label="活动关键词">${program.tags.map(tag => `<li>${esc(tag)}</li>`).join('')}</ul>`}
    <a class="text-link program-link" href="${program.href}">${esc(program.action)}</a>
  </article>`;
}

function filterBar(options, label) {
  return `<div class="filter-bar" role="group" aria-label="${label}" data-filter-controls hidden>${options.map(([value, name]) => `<button type="button" data-filter="${value}" aria-pressed="${value === 'all'}">${esc(name)}</button>`).join('')}</div>`;
}

export function ecosystem() {
 return `<section class="community-ecosystem" aria-labelledby="ecosystem-title"><div class="container section"><div class="section-top"><h2 id="ecosystem-title">不只一年一次。<br>平常，也一起创造。</h2></div><div class="community-rows">${programs.slice(1).map(p=>`<a class="community-row" href="${p.href}"><span class="row-label">${esc(p.label)}</span><div><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p></div><span class="row-action">${esc(p.action)} <b aria-hidden="true">↗</b></span></a>`).join('')}</div></div></section>`;
}

export function activitiesPage() {
  return `<section class="page-hero container portal-hero"><div>${eyebrow('MEET MORE. MAKE MORE.')}<h1>有趣的事，<br>不止发生<span class="blue-text">一次。<svg class="doodle-ring" viewBox="0 0 140 46" aria-hidden="true"><path d="M12 24 C 28 8, 72 4, 102 9 C 126 13, 136 22, 131 30 C 125 40, 82 43, 48 39 C 22 36, 8 32, 11 22" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg></span></h1><p class="page-subtitle">年度 minicamp，把大家聚在一起。<br>日常分享与共创，让每一次相遇都有下一步。</p><a href="#formats" class="text-link">探索社区的活动形式</a></div><div class="activity-art" aria-hidden="true"><div class="activity-art-grid"></div><span class="art-label mono">THE COMMUNITY LOOP</span><div class="activity-orbit"></div><div class="activity-hub">${logoMark('symbol')}<span>NanoCamp</span></div><span class="activity-node node-meet">相遇 <b>+</b></span><span class="activity-node node-share">分享 <b>↗</b></span><span class="activity-node node-build">创造 <b>✳</b></span><span class="art-note mono">ALWAYS A NEW BEGINNING.</span><svg class="doodle-arrow arrow-meet" viewBox="0 0 80 60" aria-hidden="true"><path d="M10 8 C 32 14, 52 28, 66 46 M66 46 l -11 -2 M66 46 l -3 -11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg><svg class="doodle-arrow arrow-share" viewBox="0 0 80 60" aria-hidden="true"><path d="M8 10 C 30 16, 50 28, 64 46 M64 46 l -11 -1 M64 46 l -2 -11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></div></section>
  <section id="formats" class="container section formats-section" data-directory="formats" aria-labelledby="formats-title"><div class="section-top"><div>${eyebrow('FIND YOUR NEXT THING', '01')}<h2 id="formats-title">找到你想参与的那一种。</h2></div><p class="section-description">年度 minicamp，以及分享、共创、校企交流。<br>具体场次、日期和参与方式以正式公告为准。</p></div>${filterBar([['all','全部形式'], ...programs.map(p => [p.category,p.label])], '筛选活动形式')}<p class="filter-status" role="status" aria-live="polite" data-filter-status hidden></p><div class="program-grid">${programs.map((p,i) => programCard(p,i)).join('')}</div></section>
  <section class="container section activity-records" aria-labelledby="records-title"><div class="section-top"><div>${eyebrow('THE CHAPTERS SO FAR', '02')}<h2 id="records-title">已经发生的相遇。</h2></div><span class="record-caption mono">OUR FIRST CHAPTER</span></div><article class="record-ticket"><div class="ticket-number"><span class="mono">CHAPTER</span><strong>01</strong></div><div class="ticket-main"><span class="status-pill"><i aria-hidden="true"></i>已结束</span><h3>首届 minicamp 黑客松</h3><p>从一场黑客松开始，记录共同创造的作品与相遇的瞬间。</p><div class="ticket-links"><a class="text-link" href="/minicamp/">阅读活动回顾</a><a class="text-link" href="/projects/">浏览作品</a></div></div><div class="ticket-cut" aria-hidden="true"><span>MEET.</span><span>BUILD.</span><span>TOGETHER.</span></div></article><article class="record-ticket ticket-ghost"><div class="ticket-number"><span class="mono">CHAPTER</span><strong>02</strong></div><div class="ticket-main"><span class="status-pill status-planned"><i aria-hidden="true"></i>筹备中</span><h3>带着一个主题，开启下一次相遇。</h3><p>后续场次确认后会公布。也欢迎带着想分享的经验、想共创的问题，先来认识社区。</p><div class="ticket-links"><a href="/community/" class="text-link">我可以怎样参与</a></div></div><div class="ticket-cut" aria-hidden="true"><span>MEET.</span><span>BUILD.</span><span>TOGETHER.</span></div></article></section>`;
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
    ...communityChannels.map(channel => ({ name: channel.name, icon: channel.name, body: '<a class="contact-paper-account" href="' + esc(channel.href) + '" target="_blank" rel="noopener noreferrer">' + esc(channel.id) + ' <span aria-hidden="true">↗</span></a>' })),
    { name: '微信群', icon: '微信', body: '<a class="contact-paper-qr" href="/images/community-groups/wechat-qr.png" target="_blank" rel="noopener noreferrer" aria-label="查看微信群二维码原图"><img src="/images/community-groups/wechat-qr.png" width="706" height="706" alt="微信群二维码"></a>' },
    { name: 'QQ 群', icon: 'QQ', body: '<a class="contact-paper-qr" href="/images/community-groups/qq-qr.png" target="_blank" rel="noopener noreferrer" aria-label="查看 QQ 群二维码原图"><img src="/images/community-groups/qq-qr.png" width="860" height="860" alt="QQ 群二维码"></a>' },
    { name: 'QQ', icon: 'QQ', body: '<p class="contact-paper-account">' + esc(communityContact.qq) + '</p>' },
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
