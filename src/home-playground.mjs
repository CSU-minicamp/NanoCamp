import { event, moments } from '../content/site.mjs';
import { programs } from '../content/community.mjs';
import { esc, safeUrl, pageLink, media, joinSection, uiIcon } from './components.mjs';
import { heroEmbed } from './hero.mjs';
import { showcaseCards } from './home-showcase.mjs';
import { projectPath } from './projects.mjs';
import { homeIcon } from './home-art.mjs';

const recordHref = project => safeUrl(project.href, true) || projectPath(project);

function everydayCommunity() {
  const icons = { sharing: 'code', building: 'puzzle', exchange: 'chat' };
  return `<section class="play-daily" aria-labelledby="daily-heading"><div class="container">
    <div class="play-section-heading"><div><span class="play-kicker">THE CAMP ENDS. THE COMMUNITY CONTINUES.</span><h2 id="daily-heading">不只一年一次。<br>平常，也一起创造。</h2></div><div class="daily-note"><span>全年社区方向</span><p>从一次分享、一个小实验开始。</p></div></div>
    <div class="daily-sessions">${programs.filter(p => p.id !== 'minicamp').map((p, i) => `<a class="daily-track daily-${esc(p.id)}" href="${esc(safeUrl(p.href, true) || '/activities/')}"><span class="daily-mark" aria-hidden="true">${homeIcon(icons[p.id] || 'planet')}<span>${String(i + 1).padStart(2, '0')}</span></span><div class="daily-copy"><span class="daily-type">${esc(p.label)} <span>${esc(p.en)}</span></span><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p></div><span class="daily-action">${esc(p.action)}<span aria-hidden="true">↗</span></span></a>`).join('')}</div>
  </div></section>`;
}

function projectJukebox() {
  const cards = showcaseCards();
  if (!cards.length) return `<div class="record-empty"><p>作品介绍与 Demo 链接待补充。</p><a class="play-link" href="/projects/">浏览作品档案 ↗</a><p>${moments.some(item => item.src) ? '一起回看 2026 届 minicamp 的现场瞬间。' : '2026 届活动照片待补充。'}</p><a class="play-link" href="/minicamp/#recap">阅读活动回顾 ↗</a></div>`;
  const colors = ['blue', 'mint', 'lilac', 'peach', 'yellow', 'pink'];
  return `<div class="jukebox" data-jukebox>
    <div class="record-player"><div class="player-lid"><div class="player-screen">${cards.map((p, i) => `<a class="player-image" data-record-screen="${i}" href="${esc(recordHref(p))}"${i ? ' hidden' : ''} aria-label="查看作品：${esc(p.title)}">${safeUrl(p.cover, true) ? `<img src="${esc(safeUrl(p.cover, true))}" alt="${esc(p.title)}作品封面" loading="lazy" decoding="async" data-media-image>` : `<span class="record-placeholder">${homeIcon('planet')}<strong>${esc(p.title)}</strong><small>封面待补充 · 点击了解作品</small></span>`}</a>`).join('')}</div><span class="player-brand" aria-hidden="true">NanoCamp <span>IDEAS ON REPEAT</span></span></div>
    <div class="player-hinge" aria-hidden="true"></div><div class="player-deck" aria-hidden="true"><div class="deck-disc" data-deck-disc><span>MAKE SOMETHING<br>TOGETHER.</span></div><div class="deck-controls"><span class="deck-light"></span><span class="deck-key">▶</span><span class="deck-key">＋</span><div class="deck-speaker"></div></div><span class="deck-note">FROM A LITTLE IDEA.</span></div></div>
    <div class="record-library"><div class="record-picker" data-record-picker hidden aria-label="选择展示的作品">${cards.map((p,i) => `<button type="button" class="record-choice disc-${colors[i % colors.length]}" data-record="${i}" id="record-tab-${i}" aria-controls="record-panel-${i}"><span class="record-disc" aria-hidden="true"><span class="record-number">VOL. ${String(i+1).padStart(2,'0')}</span><span class="record-hole"></span><span class="record-mini">NANOCAMP</span></span><span class="record-label">${esc(p.title)}</span></button>`).join('')}</div><div class="record-transport" data-record-transport hidden><button type="button" data-record-prev aria-label="上一个作品">←</button><span class="record-position" data-record-position role="status" aria-live="polite"></span><button type="button" data-record-next aria-label="下一个作品">→</button></div><p class="record-hint" data-record-hint hidden>↖ 选一张唱片，听听想法的回响</p>
    <div class="record-notes">${cards.map((p,i) => `<article id="record-panel-${i}" class="record-panel" data-record-panel="${i}"><span class="play-kicker">MINICAMP 2026 / TRACK ${String(i+1).padStart(2,'0')}</span><h3>${esc(p.title)}</h3><p>${esc(p.description)}</p><a class="play-link" href="${esc(recordHref(p))}">打开作品 ${'<span aria-hidden="true">↗</span>'}</a></article>`).join('')}</div></div>
  </div>`;
}

export function playgroundHome() {
  return `${heroEmbed()}
  <div class="home-flow" data-home-flow>
  <svg class="home-thread" data-home-thread hidden aria-hidden="true" focusable="false"><defs><linearGradient id="home-thread-color" x1="0" y1="0" x2="0" y2="1" gradientUnits="userSpaceOnUse"><stop stop-color="#a390d2"/><stop offset=".4" stop-color="#cfaa65"/><stop offset=".7" stop-color="#55a48a"/><stop offset="1" stop-color="#bca3f0"/></linearGradient></defs><path class="thread-track" data-thread-track fill="none"/><path class="thread-ink" data-thread-ink fill="none"/><g class="thread-signal" data-thread-signal><circle r="13" class="thread-halo"/><circle r="4"/><path d="M0-8 2-2 8 0 2 2 0 8-2 2-8 0-2-2Z"/></g></svg>
  <div class="idea-ribbon" aria-hidden="true"><div class="idea-ribbon-track">${Array.from({length: 4}, () => '<span>MEET <i>✳</i> BUILD <i>✦</i> MAKE SOMETHING TOGETHER <i>↗</i></span>').join('')}</div></div>
  <section id="community" class="play-about" aria-labelledby="community-heading"><div class="container"><div class="play-section-heading"><div><span class="play-kicker">WHO WE ARE</span><h2 id="community-heading">一个属于学生<br>创造者的社区。</h2><ul class="about-invitations" aria-label="参与门槛"><li>不限专业</li><li>无需经验</li><li>感兴趣就来</li></ul></div><div class="about-intro"><p>代码、设计、产品、艺术，各种不同的兴趣都欢迎。<br>带着一个还不完整的想法来，也可以。</p><a class="about-participate" href="/community/">看看怎么参与 <span aria-hidden="true">↗</span></a></div></div>
  <div class="play-paths"><a href="/community/">${homeIcon('people')}<span class="path-number">01 / MEET</span><h3>认识新伙伴</h3><p>不限专业，无需经验。<br>从一句「我也感兴趣」开始。</p><span class="path-arrow" aria-hidden="true">↗</span></a><a href="/activities/">${homeIcon('code')}<span class="path-number">02 / SHARE</span><h3>交换一点灵感</h3><p>技术分享、交流共创，<br>让不同的视角在这里相遇。</p><span class="path-arrow" aria-hidden="true">↗</span></a><a href="/resources/">${homeIcon('folder')}<span class="path-number">03 / BUILD</span><h3>把想法做出来</h3><p>从一个小实验、一件小作品，<br>找到属于自己的下一步。</p><span class="path-arrow" aria-hidden="true">↗</span></a></div></div></section>
  <section class="play-camp"><div class="container camp-layout"><div class="camp-memory"><div class="memory-label"><span>OUR FIRST CHAPTER</span><span>${esc(event.date)}</span></div>${event.cover ? media({src:event.cover,alt:event.coverAlt,fullSrc:event.coverFull}) : homeIcon('people')}<div class="memory-caption"><span>minicamp '26</span><span>相逢两日，故事刚刚开始。</span></div></div><div class="camp-story"><span class="play-kicker">ONCE A YEAR, TOGETHER.</span><h2>一年一次，<br>把想法做出来<span class="title-dot">.</span></h2><span class="camp-status">${uiIcon('calendar', 'camp-calendar')}${esc(event.edition)} 届 · ${esc(event.status)}</span><p>${esc(event.intro)}</p>${pageLink('/minicamp/','回看首届 minicamp')}${homeIcon('tent','camp-puzzle')}</div></div></section>
  ${everydayCommunity()}
  <section class="play-projects" aria-labelledby="projects-heading"><div class="container"><div class="play-section-heading"><div><span class="play-kicker">THE THINGS WE MAKE</span><h2 id="projects-heading">小小想法，<span>有声有色。</span></h2></div><a class="play-link" href="/projects/">浏览全部作品 <span aria-hidden="true">↗</span></a></div>${projectJukebox()}<div class="project-endnote"><span>MADE WITH CURIOSITY & A LITTLE COURAGE.</span>${homeIcon('bulb')}</div></div></section>
  <svg class="flow-handoff" viewBox="0 0 1440 140" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path fill="#9583be55" d="M0 70C250 140 390 0 730 28S1200 145 1440 54V140H0Z"/><path fill="#514698" d="M0 92C250 150 390 22 730 50S1200 162 1440 82V140H0Z"/></svg>
  </div>${joinSection({ showAvailabilityNote: true })}`;
}
