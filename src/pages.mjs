import { site, event, projects, featuredProjects, moments } from '../content/site.mjs';
import { esc, safeUrl, documentPage, eyebrow, joinButton, pageLink, media, projectCard, joinSection, logoMark } from './components.mjs';
import { hero } from './hero.mjs';
import { ecosystem, activitiesPage, communityPage, faqPage } from './community.mjs';
import { guides } from '../content/guides.mjs';
import { resourcesPage, guidePage, guidePath } from './learning.mjs';
import { partnersPage } from './partners.mjs';
import { createSearchIndex, searchPage, notFoundPage } from './search.mjs';
import { recapNavigation } from './recap.mjs';

const readyProjects = items => items.filter(item => item.title?.trim() && item.title.trim() !== '项目名称');
const gridProjects = (items = projects, classes = '') => readyProjects(items).length ? `<div class="projects-grid ${classes}">${readyProjects(items).map(projectCard).join('')}</div>` : '<div class="archive-empty"><div><h3>2026 届作品，待补充。</h3><p>作品介绍、团队成员与 Demo 链接会收录在这里。</p></div></div>';
const readyMoments = () => moments.filter(item => item.src);
const photoNotice = '<div class="archive-empty archive-empty-mint"><div><h3>现场相册，待补充。</h3><p>相册更新后，在这里回看一起动手的瞬间。</p></div><a class="text-link" href="/community/">认识 NanoCamp 社区</a></div>';

const momentMedia = (item = { id: '01', caption: '现场照片', theme: 'blue' }, classes = '') => media({ ...item, label: item.caption, classes });

function home() {
 return `${hero()}
 <section class="section container home-camp" aria-labelledby="event-heading"><div class="section-top"><h2 id="event-heading">一年一度，<br>一起把想法做出来。</h2><p class="section-description">minicamp 是 NanoCamp 最重要的年度活动。<br>从一场黑客松出发，把创造延续到日常。</p></div><div class="event-panel"><div class="event-visual">${event.cover?media({src:event.cover,alt:event.coverAlt || 'minicamp 活动现场',fullSrc:event.coverFull}):'<div class="camp-print" aria-hidden="true"><span>mini<br>camp.</span><small>MEET. BUILD. MAKE SOMETHING TOGETHER.</small></div>'}</div><div class="event-copy"><span class="event-badge">${esc(event.edition)} 届 · ${esc(event.status)}</span><h3>一次相遇，<br>也是新的开始。</h3><p>${esc(event.intro)}</p><div class="event-facts"><span>每年一届</span><span>学生黑客松</span></div>${pageLink('/minicamp/','打开 2026 届活动回顾')}</div></div></section>
 ${ecosystem()}
 <section id="community" class="container community-intro-strip"><h2>一个属于学生创造者的社区。</h2><p>不同专业、不同经验，带上好奇心就能开始。<br>认识伙伴，交换想法，一起完成一个小小的作品。</p><a class="text-link" href="/community/">找到适合你的参与方式</a></section>
 <section class="section container home-archive" aria-labelledby="projects-heading"><div class="section-top"><h2 id="projects-heading">把创造和相遇，<br>慢慢收进这里。</h2><p class="section-description">2026 届 minicamp 的作品与现场记录。</p></div>${readyProjects(projects).length?gridProjects(readyProjects(projects).slice(0,3)):'<div class="archive-links"><a href="/projects/"><span>作品档案</span><h3>每个想法，都值得被看见。</h3><p>作品介绍与 Demo 链接待补充。</p><b>进入作品空间</b></a><a href="/minicamp/#moments"><span>现场相册</span><h3>记住一起动手的时刻。</h3><p>'+ (readyMoments().length ? '一起回看 2026 届 minicamp 的现场瞬间。' : '2026 届活动照片待补充。') +'</p><b>查看现场记录</b></a></div>'}${readyMoments().length?'<div class="moments-grid">'+readyMoments().slice(0,3).map(item=>'<figure>'+momentMedia(item)+'<figcaption>'+esc(item.caption)+'</figcaption></figure>').join('')+'</div>':''}</section>
 ${joinSection()}`;
}

function minicamp() {
  const officialUrl = safeUrl(event.officialUrl);
  const officialLink = officialUrl ? `<a class="button button-primary event-official-link" href="${esc(officialUrl)}" target="_blank" rel="noopener noreferrer"><span class="button-label">进入 minicamp 活动官网</span><svg class="link-arrow" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 15 15 5M5 5h10v10"/></svg><span class="sr-only">（新标签页打开）</span></a>` : '';
  return `<section class="page-hero event-page-hero container" data-detail-surface>${eyebrow('OUR ANNUAL HACKATHON')}<div class="page-title-row"><div><span class="event-badge">${esc(event.edition)} 届 · ${esc(event.status)}</span><h1>mini<span class="blue-text">camp</span><span class="title-star" aria-hidden="true">✳</span></h1><p class="page-subtitle">一年一度的学生黑客松。<br>把一次相遇，变成一起创造。</p><div class="event-hero-actions">${officialLink}<a class="button button-secondary" href="#recap"><span class="button-label">查看活动回顾</span><svg class="link-arrow" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg></a></div></div><div class="edition-stamp"><span class="mono">CHAPTER</span><strong>${esc(event.edition)}</strong><span>这一届，一起</span></div></div>${event.theme ? `<div class="event-theme" aria-label="活动主题"><span class="event-theme-label">活动主题</span><div class="event-theme-list">${(Array.isArray(event.theme) ? event.theme : [event.theme]).map((theme, index) => `<span class="event-theme-item"><i>${String(index + 1).padStart(2, '0')}</i>${esc(theme)}</span>`).join('')}</div></div>` : ''}<div class="event-detail-facts"><div><span>活动时间</span><strong>${esc(event.date || '日期待补充')}</strong></div><div><span>活动地点</span><strong>${esc(event.location || '地点待补充')}</strong></div><div><span>活动形式</span><strong>学生黑客松</strong></div><div><span>活动状态</span><strong>${esc(event.status)}</strong></div></div></section>
  ${recapNavigation()}
  <div class="container event-cover">${event.cover ? media({src:event.cover,alt:event.coverAlt || 'minicamp 活动现场照片',fullSrc:event.coverFull}) : `<div class="camp-banner" data-detail-surface><strong>Meet.<br>Build.<br>Together.</strong><div><span>minicamp 2026</span><p>从这里相遇，<br>在 NanoCamp 继续。</p>${officialLink}</div></div>`}</div>
  <section id="recap" class="section container recap-section recap-chapter" tabindex="-1" aria-labelledby="recap-title"><div class="recap-intro">${eyebrow('THE STORY SO FAR')}<h2 id="recap-title">这一届，一起。</h2><p class="recap-side-note">一场黑客松的过程，<br>和那些一起动手的时刻。</p><div class="recap-brand-mark" aria-hidden="true"><span class="recap-brand-orbit recap-brand-orbit-a"></span><span class="recap-brand-orbit recap-brand-orbit-b"></span>${logoMark('symbol', '', true)}<span class="recap-brand-label mono">MEET / BUILD / TOGETHER</span></div></div><div class="recap-body"><p class="lead">${esc(event.intro)}</p>${event.summary.length ? event.summary.map(paragraph => `<p>${esc(paragraph)}</p>`).join('') : '<div class="content-placeholder"><span class="mono">FIELD NOTES / 02</span><h3>2026 届总结，待补充。</h3><p>活动过程、共创收获与复盘，会在这里记录。</p></div>'}</div></section>
  <section id="moments" class="gallery-section container recap-chapter" tabindex="-1" aria-labelledby="moments-title"><div class="section-top"><div>${eyebrow('FROM THE CAMP')}<h2 id="moments-title">把这些瞬间留下。</h2></div><p class="section-description">2026 届 minicamp 现场记录</p></div>${readyMoments().length ? `<div class="event-gallery">${readyMoments().map(item=>`<figure>${momentMedia(item)}<figcaption>${esc(item.caption)}</figcaption></figure>`).join('')}</div>` : photoNotice}</section>
  <section id="camp-projects" class="section container recap-chapter" tabindex="-1" aria-labelledby="camp-projects-title"><div class="section-top"><div>${eyebrow('BUILT AT MINICAMP')}<h2 id="camp-projects-title">2026 届优秀作品。</h2></div><a class="text-link" href="/projects/">查看全部作品</a></div>${gridProjects(featuredProjects, 'minicamp-featured-projects')}</section><section id="keep-building" class="container community-help recap-chapter" tabindex="-1" aria-labelledby="keep-building-title"><div><span class="mono">AFTER THE CAMP, WE KEEP BUILDING.</span><h2 id="keep-building-title">活动告一段落，共创继续。</h2><p>参加一次技术分享，约伙伴继续完善作品，<br>或带着新的问题，开始下一次共创。</p></div>${pageLink('/community/','探索全年社区')}</section>${joinSection(true, 'minicamp')}`;
}

function projectsPage() {
  return `<section class="page-hero projects-page-hero container">${eyebrow('MADE BY CURIOUS MINDS')}<div class="page-title-row"><div><h1>想法不止于想法。<br><span class="blue-text">一起把它做出来。</span></h1><p class="page-subtitle">从 minicamp 到 NanoCamp，<br>记录那些从好奇心出发的作品。</p></div><div class="project-page-symbol" aria-hidden="true">✳</div></div></section><section class="container project-catalog" aria-label="首届 minicamp 作品"><div class="catalog-label"><span>首届 minicamp 作品</span><span class="mono">IDEA → PROTOTYPE → SOMETHING REAL</span></div>${gridProjects()}</section><div class="container project-closing"><span class="mono">STILL MAKING. STILL EXPLORING.</span><p>从一个能演示的版本开始，让想法慢慢长大。</p></div>${joinSection(true)}`;
}

function about() {
  return `<section class="page-hero about-hero container">${eyebrow('NICE TO MEET YOU. WE ARE NANOCAMP.')}<h1>有趣的人，<br>值得一起<span class="blue-text">做点什么。</span></h1><div class="about-hero-bottom"><p>一个面向学生的创造者社区。<br>从一场 minicamp 开始，把一起创造变成日常。</p><span class="about-hero-slogan">Meet.<br>Build.<br>Together.</span></div></section><section class="about-origin"><div class="container origin-grid"><div>${eyebrow('HOW IT STARTED', '01')}<h2>黑客松结束了，<br>我们继续。</h2><div class="origin-note mono">MINICAMP → NANOCAMP</div></div><div class="origin-copy"><p class="lead">一次 minicamp，让有趣的人相遇。<br>NanoCamp 希望把这种连接延续下去。</p><p>这里面向不同专业、不同经验的学生。你可以带着一个问题来，也可以带着一个还不完整的想法来，和伙伴一起探索它的可能。</p><p>一年一度的 minicamp，是我们集中相遇、动手共创的时刻。活动之外，社区让分享与合作继续发生。</p><a class="text-link" href="/minicamp/">回看我们的第一场 minicamp</a></div></div></section><section class="section container about-values"><div class="section-top"><div>${eyebrow('WHAT BRINGS US TOGETHER', '02')}<h2>让我们走到一起的事。</h2></div></div><div class="belief-list"><article><span class="mono">01</span><h3>好奇心，是共同语言。</h3><p>专业可以不同，经验可以从零开始。愿意提问、愿意尝试，就有一起探索的可能。</p></article><article><span class="mono">02</span><h3>不同的人，带来新的可能。</h3><p>代码、设计、艺术、产品……让不同的视角相遇，给想法多一点生长的空间。</p></article><article><span class="mono">03</span><h3>先动手，再一起变好。</h3><p>从一次交流、一个小实验、一件小作品开始。在创造的过程中，找到自己的下一步。</p></article></div></section><section class="welcome-section container"><div>${eyebrow('YOU BELONG HERE', '03')}<h2>从你喜欢的事，<br>找到一起做的人。</h2><p>写代码、画画、做产品，或探索新的方向。<br>不必先有完整答案，交流本身就是开始。</p>${joinButton('来认识新伙伴')}</div><div class="welcome-type" aria-hidden="true"><span>YOU</span><b>+</b><span>US</span><small class="mono">SOMETHING NEW.</small></div></section>${joinSection(true)}`;
}

const routes = {
  '/': { title: 'NanoCamp · 让有趣的人相遇', description: site.description, active: '', content: home },
  '/minicamp/': { title: 'minicamp 2026 活动回顾 · NanoCamp', description: '回看 minicamp 2026 校园黑客松，浏览活动总结、现场合照与学生作品。', active: 'minicamp', content: minicamp },
  '/projects/': { title: '社区作品 · NanoCamp', description: '探索 minicamp 中从好奇心出发的项目、创意和 Demo。', active: 'projects', content: projectsPage },
  '/activities/': { title: '活动总览 · NanoCamp', description: '探索年度 minicamp、技术分享、日常共创和校企交流，找到适合你的社区参与方式。', active: 'activities', content: activitiesPage },
  '/community/': { title: '参与社区 · NanoCamp', description: '从第一次交流到一起共创，认识 NanoCamp 的参与方式、分享准备和共创约定。', active: 'community', content: communityPage },
  '/faq/': { title: '常见问题 · NanoCamp', description: '关于 NanoCamp 社区、minicamp 活动、作品展示和交流合作的常见问题。', active: 'faq', content: faqPage },
  '/resources/': { title: '共创资源 · NanoCamp', description: '从想法到 Demo、组队协作与技术分享：实用指南、可下载模板和官方学习入口。', active: 'resources', content: resourcesPage },
  '/partners/': { title: '交流与合作 · NanoCamp', description: '连接学校、企业和实践者，探索技术分享、校园联动与共创交流，整理你的交流提案。', active: 'partners', content: partnersPage },
  ...Object.fromEntries(guides.map(guide => [guidePath(guide), { title: `${guide.shortTitle} · NanoCamp 共创指南`, description: guide.description, active: 'resources', content: () => guidePage(guide) }])),
  '/search/': { title: '站内搜索 · NanoCamp', description: '搜索 NanoCamp 的活动、社区指南、模板与常见问题，找到下一次探索的起点。', active: 'search', noindex: true, content: () => searchPage(createSearchIndex(pageSummaries())) },
  '/about/': { title: '关于社区 · NanoCamp', description: '认识 NanoCamp，一个从黑客松出发、欢迎跨专业学生的创造者社区。', active: 'about', content: about },
};
export function pageSummaries() { return Object.entries(routes).map(([path, page]) => ({ path, title: page.title, description: page.description })); }
export function renderNotFound() { return documentPage({ title: '页面未找到 · NanoCamp', description: '这个链接暂时没有找到，从 NanoCamp 首页、社区指南或站内搜索继续探索。', active: 'missing', noindex: true, body: notFoundPage() }); }
export const routePaths = Object.keys(routes);
export function renderPage(route) { const page = routes[route]; if (!page) throw new Error(`Unknown route: ${route}`); return documentPage({ ...page, route, body: page.content() }); }
