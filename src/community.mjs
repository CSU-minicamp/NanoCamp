import { programs, faqs, faqCategories } from '../content/community.mjs';
import { esc, eyebrow, pageLink, joinButton, joinSection, logoMark } from './components.mjs';

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
    <div class="program-top"><span class="program-icon">${programIcon(program.icon)}</span><span class="mono">0${index + 1} / ${esc(program.en)}</span></div>
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
 return `<section class="community-ecosystem" aria-labelledby="ecosystem-title"><div class="container section"><div class="section-top"><h2 id="ecosystem-title">不只一年一次。<br>平常，也一起创造。</h2><p class="section-description">技术分享、日常共创、校企交流。<br>具体场次与参与方式，以正式公告为准。</p></div><div class="community-rows">${programs.slice(1).map(p=>`<a class="community-row" href="${p.href}"><span class="row-label">${esc(p.label)}</span><div><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p></div><span class="row-action">${esc(p.action)} <b aria-hidden="true">↗</b></span></a>`).join('')}</div></div></section>`;
}

export function activitiesPage() {
  return `<section class="page-hero container portal-hero"><div>${eyebrow('MEET MORE. MAKE MORE.')}<h1>有趣的事，<br>不止发生<span class="blue-text">一次。<svg class="doodle-ring" viewBox="0 0 140 46" aria-hidden="true"><path d="M12 24 C 28 8, 72 4, 102 9 C 126 13, 136 22, 131 30 C 125 40, 82 43, 48 39 C 22 36, 8 32, 11 22" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg></span></h1><p class="page-subtitle">年度 minicamp，把大家聚在一起。<br>日常分享与共创，让每一次相遇都有下一步。</p><a href="#formats" class="text-link">探索社区的活动形式</a></div><div class="activity-art" aria-hidden="true"><div class="activity-art-grid"></div><span class="art-label mono">THE COMMUNITY LOOP</span><div class="activity-orbit"></div><div class="activity-hub">${logoMark('symbol')}<span>NanoCamp</span></div><span class="activity-node node-meet">相遇 <b>+</b></span><span class="activity-node node-share">分享 <b>↗</b></span><span class="activity-node node-build">创造 <b>✳</b></span><span class="art-note mono">ALWAYS A NEW BEGINNING.</span><svg class="doodle-arrow arrow-meet" viewBox="0 0 80 60" aria-hidden="true"><path d="M10 8 C 32 14, 52 28, 66 46 M66 46 l -11 -2 M66 46 l -3 -11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg><svg class="doodle-arrow arrow-share" viewBox="0 0 80 60" aria-hidden="true"><path d="M8 10 C 30 16, 50 28, 64 46 M64 46 l -11 -1 M64 46 l -2 -11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></div></section>
  <section id="formats" class="container section formats-section" data-directory="formats" aria-labelledby="formats-title"><div class="section-top"><div>${eyebrow('FIND YOUR NEXT THING', '01')}<h2 id="formats-title">找到你想参与的那一种。</h2></div><p class="section-description">年度 minicamp，以及分享、共创、校企交流。<br>具体场次、日期和参与方式以正式公告为准。</p></div>${filterBar([['all','全部形式'], ...programs.map(p => [p.category,p.label])], '筛选活动形式')}<p class="filter-status" role="status" aria-live="polite" data-filter-status hidden></p><div class="program-grid">${programs.map((p,i) => programCard(p,i)).join('')}</div></section>
  <section class="container section activity-records" aria-labelledby="records-title"><div class="section-top"><div>${eyebrow('THE CHAPTERS SO FAR', '02')}<h2 id="records-title">已经发生的相遇。</h2></div><span class="record-caption mono">OUR FIRST CHAPTER</span></div><article class="record-ticket"><div class="ticket-number"><span class="mono">CHAPTER</span><strong>01</strong></div><div class="ticket-main"><span class="status-pill"><i aria-hidden="true"></i>已结束</span><h3>首届 minicamp 黑客松</h3><p>从一场黑客松开始，记录共同创造的作品与相遇的瞬间。</p><div class="ticket-links"><a class="text-link" href="/minicamp/">阅读活动回顾</a><a class="text-link" href="/projects/">浏览作品</a></div></div><div class="ticket-cut" aria-hidden="true"><span>MEET.</span><span>BUILD.</span><span>TOGETHER.</span></div></article><article class="record-ticket ticket-ghost"><div class="ticket-number"><span class="mono">CHAPTER</span><strong>02</strong></div><div class="ticket-main"><span class="status-pill status-planned"><i aria-hidden="true"></i>筹备中</span><h3>带着一个主题，开启下一次相遇。</h3><p>后续场次确认后会公布。也欢迎带着想分享的经验、想共创的问题，先来认识社区。</p><div class="ticket-links"><a href="/community/" class="text-link">我可以怎样参与</a></div></div><div class="ticket-cut" aria-hidden="true"><span>MEET.</span><span>BUILD.</span><span>TOGETHER.</span></div></article></section>${joinSection(true)}`;
}

const pathwayLinks = {
  build: ['/resources/from-idea-to-demo/', '带走一份最小实验单'],
  share: ['/resources/host-a-sharing/', '看看轻量分享指南'],
  help: ['/activities/', '认识社区的活动形式'],
  connect: ['/partners/', '探索交流与合作'],
};
const roleCard = (id, number, icon, name, text, items) => `<article id="${id}" class="role-card" data-detail-surface><div class="role-heading"><span class="program-icon">${programIcon(icon)}</span><span class="mono">参与方向 / ${number}</span></div><h3>${name}</h3><p>${text}</p><ul class="prepare-list">${items.map(item => `<li>${item}</li>`).join('')}</ul><a class="role-bottom role-resource-link" href="${pathwayLinks[id][0]}">${pathwayLinks[id][1]}<span aria-hidden="true">↗</span></a></article>`;

export function communityPage() {
  return `<section class="page-hero container community-page-hero">${eyebrow('THERE IS A PLACE FOR YOUR CURIOSITY.')}<div class="page-title-row"><div><h1>带上好奇心，<br>找到<span class="blue-text">你的同路人。</span></h1><p class="page-subtitle">从提问、分享，到做出一个小作品。<br>带着你的兴趣，找到适合自己的参与方式。</p><div class="portal-actions">${joinButton('来认识新伙伴')}${pageLink('#start','第一次来，从这里开始')}</div></div><div class="community-badge" aria-hidden="true"><span class="mono">MEET. BUILD. TOGETHER.</span><b>YOU<span>+</span>US</b><span>不同的兴趣，共同的好奇心。</span><i>✳</i></div></div></section>
  <section id="start" class="container section start-section" aria-labelledby="start-title"><div class="section-top"><div>${eyebrow('YOUR FIRST LITTLE STEP', '01')}<h2 id="start-title">第一次来，不用准备得很完美。</h2></div><p class="section-description">从认识一个人，到试着做一点。<br>小小的开始，也会长出新的可能。</p></div><ol class="start-steps"><li><span class="step-number mono">01</span><h3>说说你在好奇什么</h3><p>介绍你的兴趣、想探索的问题，以及愿意尝试的事情。经验和专业只是你的其中一部分。</p><span class="step-prompt">「最近我想试试……」</span></li><li><span class="step-number mono">02</span><h3>找到一个共同的兴趣</h3><p>听一次分享，讨论一个点子，找到一个共同关心的问题。先认识彼此，再决定一起做什么。</p><span class="step-prompt">「这个问题，我也在想！」</span></li><li><span class="step-number mono">03</span><h3>一起完成第一步</h3><p>约定清楚的目标和时间。画出一张草图、验证一个假设，或做出一个能演示的小原型。</p><span class="step-prompt">「要不，我们先做这个？」</span></li></ol></section>
  <section class="community-pathways" aria-labelledby="paths-title"><div class="container section"><div class="section-top"><div>${eyebrow('MANY WAYS TO BE PART OF IT', '02')}<h2 id="paths-title">你可以这样参与。</h2></div><p class="section-description">从兴趣和可投入的时间出发。<br>具体活动与协作安排，一起确认。</p></div><div class="role-grid">${roleCard('build','01','build','带着想法来共创','带来一个问题、一张草图，或一个想试试的点子。',['用一句话描述想解决的问题','画一个简单草图，或列出最小功能','说明希望找到的伙伴与可投入时间'])}${roleCard('share','02','talk','把一次发现讲给大家','一次踩坑、一种方法、一个有意思的工具，都可以是起点。',['选择一个具体的小主题','说明适合谁、需要什么基础','准备一个例子，留一点交流时间'])}${roleCard('help','03','camp','让一次相遇顺利发生','活动记录、视觉设计、现场协助与内容整理，也能让创造发生。',['说说你擅长或愿意尝试的事情','说明可以参与的时间与方式','从一个明确、能完成的小任务开始'])}${roleCard('connect','04','connect','连接学校、企业与社群','让不同校园和实践者之间，有机会交换问题与经验。',['介绍你所在的学校、社团或团队','提出一个具体的交流主题或形式','说明期待的参与者、时间与所需支持'])}</div></div></section>
  <section id="principles" class="container section" aria-labelledby="principles-title"><div class="section-top"><div>${eyebrow('GOOD THINGS GROW WITH CARE', '03')}<h2 id="principles-title">一起创造，也一起照顾彼此。</h2></div></div><div class="principles-grid"><article><span aria-hidden="true">01 / ↗</span><h3>给第一次尝试留空间</h3><p>认真听完一个问题，欢迎不同经验的人。反馈具体一点，判断慢一点。</p></article><article><span aria-hidden="true">02 / ©</span><h3>让每一份贡献被看见</h3><p>说明素材来源与团队分工，尊重原创、授权和彼此尚未公开的想法。</p></article><article><span aria-hidden="true">03 / +</span><h3>把边界和期待讲清楚</h3><p>提前沟通时间、职责与公开范围。分享照片、作品或联系方式前，先征得同意。</p></article></div></section>
  <section class="container community-help"><div><span class="mono">A FEW MORE THINGS</span><h2>还有一点好奇？</h2><p>参与门槛、活动安排、作品展示……<br>把常见的问题放在了一起。</p></div>${pageLink('/faq/','去常见问题看看')}</section>${joinSection(true)}`;
}

export function faqItem(item) {
  const label = faqCategories.find(([key]) => key === item.category)?.[1] || '';
  return `<details id="${item.id}" class="faq-item" data-filter-item data-category="${item.category}" data-search="${esc(item.question + ' ' + item.answer + ' ' + label)}"><summary><span class="faq-category">${esc(label)}</span><span class="faq-question">${esc(item.question)}</span><span class="faq-plus" aria-hidden="true"></span></summary><div class="faq-answer"><p>${esc(item.answer)}</p><div class="faq-answer-links">${item.href ? `<a class="text-link" href="${item.href}">${esc(item.link)}</a>` : ''}<a class="faq-permalink" href="#${item.id}" aria-label="定位问题：${esc(item.question)}"><span aria-hidden="true">#</span> 问题直达</a></div></div></details>`;
}

export function faqPage() {
  return `<section class="page-hero container faq-hero">${eyebrow('A LITTLE LESS UNKNOWN.')}<h1>好奇的问题，<br><span class="blue-text">慢慢说清楚。</span></h1><p class="page-subtitle">第一次来，或准备迈出下一步，<br>先从这些常见问题开始认识 NanoCamp。</p></section><section class="container faq-directory" data-directory="faq" aria-label="常见问题列表"><div class="directory-tools" data-search-controls hidden><label for="faq-search" class="search-label">搜索问题</label><div class="search-field"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="faq-search" type="search" data-search-input placeholder="试试「专业」「报名」或「分享」" autocomplete="off" maxlength="120"><button type="button" data-search-clear aria-label="清空搜索" hidden>×</button></div></div>${filterBar(faqCategories, '筛选问题类型')}<p class="filter-status" data-filter-status role="status" aria-live="polite" hidden></p><div class="faq-list">${faqs.map(faqItem).join('')}</div><div class="directory-empty" data-filter-empty hidden><span aria-hidden="true">?</span><h2>还没有找到这个问题。</h2><p>换个关键词试试，或者清除筛选，看看所有问题。</p><button type="button" class="button button-secondary" data-filter-reset>查看所有问题 <span aria-hidden="true">↗</span></button></div><div class="faq-note"><span aria-hidden="true">✳</span><p>没有看到你关心的问题？<a href="/community/">先了解社区参与方式</a>，官方联系渠道更新后，也欢迎继续交流。</p></div></section>${joinSection(true)}`;
}