import { faqs, programs } from '../content/community.mjs';
import { guides } from '../content/guides.mjs';
import { partnership } from '../content/partners.mjs';
import { esc, eyebrow, pageLink } from './components.mjs';
import { readyProjects, projectPath } from './projects.mjs';

export const searchTypes = [['all','全部'],['page','社区页面'],['event','活动'],['guide','共创指南'],['faq','常见问题'],['project','作品']];
const labels = Object.fromEntries(searchTypes);
export function createSearchIndex(pages) {
  const records = pages.filter(page => page.path !== '/search/').map(page => ({
    id: `page:${page.path}`, href: page.path, title: page.title.replace(/ · NanoCamp.*$/, ''), description: page.description,
    type: page.path === '/minicamp/' || page.path === '/activities/' ? 'event' : page.path.startsWith('/resources/') ? 'guide' : page.path === '/faq/' ? 'faq' : page.path.startsWith('/projects/') && page.path !== '/projects/' ? 'project' : 'page',
    context: 'NanoCamp 官网', text: page.path === '/community/' ? '参与 加入 新手 学生 专业 分享 组队 志愿 交流 社群' : page.path === '/partners/' ? '合作 学校 企业 校园 校企交流 社团 赞助 支持 交流 草稿 提案' : '',
  }));
  records.push(...partnership.cases.map(item => ({ id:`partner:${item.id}`, href:`/partners/#partner-${encodeURIComponent(item.id)}`, title:item.name, description:item.summary?.trim() || '首届 minicamp 合作案例，合作介绍与现场记录待补充。', text:'合作伙伴 minicamp', type:'page', context:'合作案例 · minicamp' })));
  records.push(...programs.slice(1).map(program => ({ id:`format:${program.id}`, href:program.href, title:program.name, description:program.description, text:[program.label,...program.tags].join(' '), type:'event', context:`活动形式 · ${program.label}` })));
  records.push(...faqs.map(faq => ({ id:`faq:${faq.id}`, href:`/faq/#${faq.id}`, title:faq.question, description:faq.answer, text:'', type:'faq', context:'常见问题 · 直达回答' })));
  for (const guide of guides) {
    const root = records.find(record => record.href === `/resources/${guide.slug}/`);
    if (root) { root.text = guide.sections.flatMap(section => [section.title,...section.paragraphs,...(section.bullets || [])]).join(' '); root.context = `共创指南 · ${guide.tag}`; }
    records.push(...guide.sections.map(section => ({ id:`guide:${guide.slug}:${section.id}`, href:`/resources/${guide.slug}/#${section.id}`, title:section.title, description:section.paragraphs[0], text:[...section.paragraphs,...(section.bullets || []),section.prompt || ''].join(' '), type:'guide', context:`指南段落 · ${guide.shortTitle}` })));
    records.push({ id:`template:${guide.slug}`, href:`/resources/${guide.slug}/#template`, title:`${guide.shortTitle} · 空白模板`, description:guide.takeaway, text:guide.template, type:'guide', context:'共创资源 · 可复制与下载' });
  }
  // members 是 {name, role} 对象，只取姓名；problem / solution 让正文也能被检索到。
  records.push(...readyProjects().map(project => ({
    id: `project:${project.id}`, href: projectPath(project), title: project.title, description: project.description,
    text: [project.theme, project.team, ...(project.tools || []), ...(project.members || []).map(member => member?.name).filter(Boolean), project.problem, project.solution].filter(Boolean).join(' '),
    type: 'project', context: '社区作品 · 首届 minicamp',
  })));
  return records;
}

export function searchPage(records) {
  const links = records.filter(record => record.id.startsWith('page:'));
  const safeJSON = JSON.stringify(records).replace(/</g, '\\u003c');
  return `<section class="page-hero container search-hero"><h1 class="search-label">站内搜索</h1><a class="search-landing-logo" href="/" aria-label="NanoCamp 首页"><img src="/images/nanocamp-wordmark-1170.webp" alt="NanoCamp" width="1170" height="290"></a></section><section class="container site-search" data-site-search aria-label="站内搜索"><script type="application/json" data-search-index>${safeJSON}</script><div data-search-ui hidden><form action="/search/" method="get" class="site-search-form" role="search"><label class="search-label" for="site-query">输入你想了解的内容</label><div class="site-search-input"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" name="q" id="site-query" maxlength="120" placeholder="搜索" autocomplete="off"><button type="button" class="query-clear" data-query-clear aria-label="清空关键词" hidden>×</button></div></form><div class="search-suggestions" aria-label="猜你想搜"><span class="search-suggestions-label">猜你想搜</span>${['组队','分享','模板','minicamp'].map(word=>`<button type="button" data-suggestion="${word}">${word}</button>`).join('')}</div><div class="filter-bar search-type-bar" role="group" aria-label="筛选搜索内容类型">${searchTypes.map(([value,name])=>`<button type="button" data-search-type="${value}" aria-pressed="${value==='all'}">${name}</button>`).join('')}</div><div class="search-results-heading"><h2 data-results-title>从这里开始探索。</h2><span role="status" aria-live="polite" data-results-status></span></div><ol class="site-search-results" data-search-results></ol><div class="directory-empty" data-search-empty hidden><span aria-hidden="true">?</span><h2>换个关键词，也许就找到了。</h2><p>可以试试更短的词，或切换到「全部」看看。</p><button type="button" class="button button-secondary" data-search-reset>清除搜索与筛选</button><a href="/faq/" class="text-link">到常见问题看看</a></div><div class="search-more"><button type="button" class="button button-secondary" data-search-more hidden>查看更多结果 <span aria-hidden="true">↓</span></button></div></div><p class="search-load-note" data-search-error hidden>搜索暂时没有加载成功，可以通过下面的目录继续探索。</p><div class="search-fallback" data-search-fallback><div class="section-top"><div>${eyebrow('TAKE A LOOK AROUND')}<h2>按页面继续探索。</h2></div></div><nav aria-label="网站内容目录">${links.map(record=>`<a href="${record.href}"><span>${labels[record.type]}</span><strong>${esc(record.title)}</strong><span aria-hidden="true">↗</span></a>`).join('')}</nav></div></section>`;
}

export function notFoundPage() {
  return `<section class="container missing-page"><div class="missing-art" aria-hidden="true"><span>4</span><div class="missing-orbit"><i></i><b>0</b></div><span>4</span></div>${eyebrow('A SMALL DETOUR. A NEW POSSIBILITY.')}<h1>这一页，<br>暂时<span class="blue-text">没有找到。</span></h1><p>链接可能已经变更，也可以检查一下网址。<br>换个方向，我们继续探索。</p><div class="portal-actions">${pageLink('/','回到首页','missing-primary')}${pageLink('/search/','试试站内搜索')}</div><div class="missing-shortcuts"><a href="/minicamp/">年度 minicamp <span aria-hidden="true">↗</span></a><a href="/resources/">找份共创指南 <span aria-hidden="true">↗</span></a><a href="/community/">认识社区 <span aria-hidden="true">↗</span></a></div></section>`;
}
