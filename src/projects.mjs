// 作品列表页与详情页。数据来自 content/site.mjs，由 scripts/sync-minicamp-projects.mjs 从 minicamp 接口整理而来。
import { projects, communityProjects, personalProjects } from '../content/site.mjs';
import { esc, safeUrl, media, eyebrow, arrowIcon, joinSection, shareButton } from './components.mjs';

// 占位作品的 title 仍是「项目名称」，不进入列表、详情页路由与站内搜索。
export const readyProjects = (items = projects) => items.filter(item => item?.title?.trim() && item.title.trim() !== '项目名称');
const slugify = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const projectSlug = project => slugify(project?.slug) || `project-${slugify(project?.id) || '0'}`;
export const projectPath = project => `/projects/${projectSlug(project)}/`;
// 封面占位底色按条目轮换，让没有封面的作品也能区分开。
const tones = ['blue', 'orange', 'mint', 'sand'];
const toneOf = project => tones[Math.max(0, readyProjects().indexOf(project)) % tones.length];

// 列表优先展示有封面的作品：无封面条目会渲染成占位块，排在后面版面更整齐。
const hasCover = project => Boolean(String(project?.cover ?? '').trim());
const coverFirst = items => [...items].sort((a, b) => Number(hasCover(b)) - Number(hasCover(a)));

const memberNames = project => (project.members || []).map(member => member.name).filter(Boolean);
// problem / solution 是人工填写的自由文本，换行表示分段。
const paragraphs = value => String(value ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const pending = (label, note) => `<div class="content-placeholder"><span class="mono">FIELD NOTES</span><h3>${esc(label)}，待补充。</h3><p>${esc(note)}</p></div>`;

// 作品分类（作品列表页顶部 Tab）。MiniCamp 来自同步数据；社区 / 成员作品后续填充。
export const projectCategories = [
  { key: 'minicamp', label: 'MiniCamp 作品' },
  { key: 'community', label: '社区作品' },
  { key: 'personal', label: '成员作品' },
];

// 每个分类对应的数据源。MiniCamp 取已就绪的同步作品，其余两类暂为空占位。
const categorySource = key => {
  if (key === 'community') return communityProjects;
  if (key === 'personal') return personalProjects;
  return readyProjects();
};

// 单个分类的展示内容：空分类显示占位，少量作品直接网格，较多作品按主题分组。
function categoryPanel(key) {
  const items = categorySource(key);
  if (!items.length) {
    const label = projectCategories.find(cat => cat.key === key)?.label || '作品';
    return `<div class="project-empty"><div><h3>${esc(label)}，待补充。</h3><p>这一部分会陆续整理上线，欢迎先看看 MiniCamp 作品。</p></div><a class="text-link" href="/projects/">浏览 MiniCamp 作品</a></div>`;
  }
  return items.length <= 6 ? projectGrid(items) : catalogGroups(items);
}

function tagList(items, limit = 0, label = '用到的工具') {
  const tags = (Array.isArray(items) ? items : []).filter(Boolean).map(tag => esc(String(tag).trim()));
  if (!tags.length) return '';
  const shown = limit > 0 ? tags.slice(0, limit) : tags;
  const extra = tags.length - shown.length;
  return `<ul class="tag-list project-tags" aria-label="${esc(label)}">${shown.map(tag => `<li>${tag}</li>`).join('')}${extra > 0 ? `<li class="tag-more">+${extra}</li>` : ''}</ul>`;
}

// 外链统一处理：只放行 http/https，新标签页打开，并给读屏用户明确提示。
function externalLink(href, label, classes = '') {
  const url = safeUrl(href);
  if (!url) return `<span class="unavailable">${esc(label)}待补充</span>`;
  return `<a${classes ? ` class="${esc(classes)}"` : ''} href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}${arrowIcon(true)}<span class="sr-only">（新标签页打开）</span></a>`;
}
function externalButton(href, label, classes = 'button-secondary') {
  const url = safeUrl(href);
  if (!url) return `<span class="unavailable">${esc(label)}待补充</span>`;
  return `<a class="button ${esc(classes)}" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span class="button-label">${esc(label)}</span>${arrowIcon(true)}<span class="sr-only">（新标签页打开）</span></a>`;
}

// clone=true 时输出"副本卡片"：不带 id（避免同一页面出现重复 id）、不进无障碍树、
// 链接不参与 Tab 顺序，但仍可点击。首页无缝循环的第二组卡片用它。
export function projectCard(project, tone = toneOf(project), { clone = false } = {}) {
  // 首页的作品卡片来自 content/home-showcase.json，可以用 href 指定站内地址；
  // 没写 href 就按作品本身推导 /projects/<slug>/。
  const detail = safeUrl(project.href, true) || projectPath(project);
  const demo = safeUrl(project.demoUrl);
  const names = memberNames(project);
  const optionalInfo = [tagList(project.tools, 3), names.length ? `<p class="project-members">${names.map(esc).join(' · ')}</p>` : ''].filter(Boolean).join('\n    ');
  // 两边改动互不冲突，一起保留：homepage 加了 clone（副本卡片不带 id、不进无障碍树、不参与 Tab），
  // main 给封面加了 linkTo（点封面直接进详情页）。
  const markup = `<article${clone ? '' : ` id="project-${esc(project.id)}"`} class="project-card" data-detail-surface data-source="${esc(project.sourceId || '')}"${clone ? ' aria-hidden="true"' : ''}>${media({ src: project.cover, alt: project.coverAlt || project.title, label: 'MINICAMP / PROJECT', id: project.id, theme: tone, kind: 'project', fullSrc: project.coverFull, caption: project.title, linkTo: detail, album: 'projects', albumLabel: '社区作品封面' })}
    <div class="project-meta"><span>${esc(project.theme || '首届 minicamp')}</span><span class="mono">NO. ${esc(project.id)}</span></div>
    <h3><a href="${esc(detail)}">${esc(project.title)}</a></h3><p>${esc(project.description)}</p>${optionalInfo ? `\n    ${optionalInfo}` : ''}
    <div class="project-links"><a href="${esc(detail)}">查看详情<span class="sr-only">：${esc(project.title)}</span></a>${externalLink(project.repoUrl, 'GitHub 仓库')}${demo ? externalLink(demo, '体验 Demo') : ''}</div>
  </article>`;
  return clone ? markup.replace(/<a /g, '<a tabindex="-1" ') : markup;
}

export function projectGrid(items = projects) {
  const list = coverFirst(readyProjects(items));
  return list.length
    ? `<div class="projects-grid">${list.map((item, index) => projectCard(item, tones[index % tones.length])).join('')}</div>`
    : '<div class="archive-empty"><div><h3>首届作品，待补充。</h3><p>作品介绍、团队成员与 Demo 链接会收录在这里。</p></div><a class="text-link" href="/resources/from-idea-to-demo/">先读一份 Demo 指南</a></div>';
}

// 作品较多时按活动主题分组。每组先展示 3 个，超出部分折叠并提供「查看该主题全部」展开。
function catalogGroups(categoryItems = readyProjects()) {
  const items = categoryItems;
  if (!items.length) return '';
  if (items.length <= 6) return projectGrid(items);
  const groups = [];
  for (const item of items) {
    let group = groups.find(entry => entry.theme === (item.theme || ''));
    if (!group) groups.push(group = { theme: item.theme || '', items: [] });
    group.items.push(item);
  }
  // 每个主题组内也把有封面的作品排在前面，首屏 3 个尽量都有封面。
  groups.forEach(group => { group.items = coverFirst(group.items); });
  let offset = 0;
  return groups.map(group => {
    const id = `theme-${slugify(group.theme) || 'unthemed'}`;
    const shown = group.items.slice(0, 3);
    const extra = group.items.slice(3);
    const cards = [...shown, ...extra].map((item, index) => {
      const isExtra = index >= 3;
      return `<div class="${isExtra ? 'theme-extra' : ''}"${isExtra ? ' hidden' : ''}>${projectCard(item, tones[(offset + index) % tones.length])}</div>`;
    }).join('');
    offset += group.items.length;
    const more = extra.length
      ? `<button type="button" class="theme-more" data-theme-more="${id}" aria-expanded="false" aria-controls="${id}">查看该主题全部 ${group.items.length} 个<span class="sr-only">：${esc(group.theme)}</span> <span class="theme-more-arrow" aria-hidden="true">↓</span></button>`
      : '';
    return `<section class="project-group" id="${id}" aria-labelledby="${id}-title"><div class="group-label"><h2 id="${id}-title">${esc(group.theme)}</h2><span class="mono">${group.items.length} 个作品</span></div><div class="projects-grid">${cards}</div>${more}</section>`;
  }).join('');
}

export function projectsPage() {
  const tabs = projectCategories.map((cat, index) => `<button type="button" class="project-tab" data-project-tab="${esc(cat.key)}" aria-pressed="${index === 0}">${esc(cat.label)}</button>`).join('');
  const panels = projectCategories.map(cat => `<div class="project-category" data-project-panel="${esc(cat.key)}" ${cat.key === 'minicamp' ? '' : 'hidden'}>${categoryPanel(cat.key)}</div>`).join('');
  return `<section class="page-hero projects-page-hero container">${eyebrow('MADE BY CURIOUS MINDS')}<div class="page-title-row"><div><h1>想法不止于想法。<br><span class="blue-text">一起把它做出来。</span></h1><p class="page-subtitle">从 minicamp 到 NanoCamp，<br>记录那些从好奇心出发的作品。</p></div><div class="project-page-symbol" aria-hidden="true">✳</div></div></section><div class="container project-tabs" role="tablist" aria-label="作品分类">${tabs}</div><div class="container project-categories">${panels}</div><div class="container project-closing"><span class="mono">STILL MAKING. STILL EXPLORING.</span><p>从一个能演示的版本开始，让想法慢慢长大。</p></div>${joinSection(true)}`;
}

function teamList(members) {
  const roster = (Array.isArray(members) ? members : []).filter(member => member?.name);
  if (!roster.length) return pending('参与的同学', '团队成员与分工整理后会记录在这里。');
  return `<ul class="project-team">${roster.map(member => `<li><b>${esc(member.name)}</b>${member.role ? `<span>${esc(member.role)}</span>` : ''}</li>`).join('')}</ul>`;
}

export function projectDetailPage(project, siblings = readyProjects()) {
  const detail = projectPath(project);
  const index = siblings.indexOf(project);
  const previous = siblings.length > 1 ? siblings[(index - 1 + siblings.length) % siblings.length] : null;
  const next = siblings.length > 1 ? siblings[(index + 1) % siblings.length] : null;
  const problem = paragraphs(project.problem);
  const solution = paragraphs(project.solution);
  const facts = [
    ['所属届次', '首届 minicamp'],
    ['活动主题', project.theme || null],
    ['所属队伍', project.team || null],
    ['完成年份', project.year || null],
  ].filter(([, value]) => value);
  return `<div class="container project-breadcrumb"><a href="/projects/">社区作品</a><span aria-hidden="true">/</span><span>${esc(project.title)}</span></div>
  <header class="container project-detail-hero"><div class="project-kicker"><span class="project-tag">${esc(project.theme || '首届 minicamp')}</span><span class="mono">作品 / ${esc(project.id)}</span></div><h1>${esc(project.title)}</h1><p class="project-detail-summary">${esc(project.description)}</p>${tagList(project.tools, 8)}<div class="project-actions">${externalButton(project.repoUrl, 'GitHub 仓库', 'button-primary')}${externalButton(project.demoUrl, '体验 Demo')}</div></header>
  <div class="container project-detail-cover">${media({ src: project.cover, alt: project.coverAlt || project.title, label: 'PROJECT / COVER', id: project.id, theme: toneOf(project), kind: 'project', fullSrc: project.coverFull, caption: project.title, album: 'projects', albumLabel: '社区作品封面' })}</div>
  <div class="container project-detail-layout"><aside class="project-sidebar" aria-label="这个作品的信息"><div class="project-toc"><span class="mono">本篇目录</span><nav aria-label="作品章节"><a href="#problem"><span class="mono">01</span>想解决的问题</a><a href="#solution"><span class="mono">02</span>我们的做法</a><a href="#tools"><span class="mono">03</span>用到的工具</a><a href="#team"><span class="mono">04</span>参与的同学</a></nav><dl class="project-facts">${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><div class="project-outbound"><span class="mono">外部链接</span>${externalLink(project.repoUrl, 'GitHub 仓库')}${externalLink(project.demoUrl, '体验 Demo')}<p class="project-outbound-note">以上链接会在新标签页打开。</p></div>${shareButton('复制作品链接')}<p class="share-status" role="status" aria-live="polite" data-share-status></p><div id="share-manual" class="share-fallback" data-share-fallback hidden><label for="share-url">手动复制链接</label><input id="share-url" type="text" readonly autocomplete="off" spellcheck="false"><button type="button">收起</button></div><a class="text-link" href="/projects/">返回作品列表</a></div></aside>
  <article class="project-detail-body"><section id="problem" class="project-section"><span class="guide-section-index mono">01</span><h2>想解决的问题。</h2>${problem.length ? problem.map(line => `<p>${esc(line)}</p>`).join('') : pending('问题描述', '这个作品想解决的问题，会记录在这里。')}</section>
    <section id="solution" class="project-section"><span class="guide-section-index mono">02</span><h2>我们的做法。</h2>${solution.length ? solution.map(line => `<p>${esc(line)}</p>`).join('') : pending('解决方案', '团队最终采用的方案，会记录在这里。')}</section>
    <section id="tools" class="project-section"><span class="guide-section-index mono">03</span><h2>用到的工具。</h2>${tagList(project.tools) || pending('工具', '开发中使用的 AI 工具与技术，会整理在这里。')}</section>
    <section id="team" class="project-section"><span class="guide-section-index mono">04</span><h2>参与的同学。</h2>${teamList(project.members)}</section>
  </article></div>
  ${previous && next ? `<section class="container project-detail-next"><span class="mono">继续浏览</span><div><h2>下一个作品，也在路上。</h2><div class="project-detail-next-links"><a href="${esc(projectPath(previous))}"><span aria-hidden="true">←</span>${esc(previous.title)}</a><a href="${esc(projectPath(next))}">${esc(next.title)}<span aria-hidden="true">→</span></a></div></div></section>` : ''}${joinSection(true)}`;
}
