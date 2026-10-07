import { logoMark } from './components.mjs';

const arrow = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 16 16 4M4 4h12v12"/></svg>';

// 海报就是首页首屏的全部内容，现在单独成页（/intro/），首页只用 iframe 嵌入它：
// 入场动画在 iframe 里跑，不会拖住首页其余部分的渲染，海报也能单独打开检查。
export const introPath = '/intro/';

// 首页只留嵌入用的外壳和一个视觉隐藏的 h1：
// 页面标题结构不依赖 iframe 内部，JS 被禁用时首页也不会缺主标题。
export function heroEmbed() {
  return `<section class="home-hero" aria-labelledby="hero-heading"><h1 id="hero-heading" class="sr-only">让有趣的人相遇，让相遇的人一起创造。</h1><iframe class="home-hero-frame" src="${introPath}" title="NanoCamp 首页海报：让有趣的人相遇，让相遇的人一起创造。" loading="eager"></iframe></section>`;
}

export function hero() {
  return `<section class="brand-hero poster-b" data-brand-hero aria-labelledby="hero-heading"><div class="container">
  <div class="b-main">
  <div class="b-intro"><h1 id="hero-heading">让有趣的人相遇，<br><span>让相遇的人一起创造。</span></h1></div>
  <div class="b-wall"><div class="b-sheet b-sheet-lilac"><div class="b-sheet-top"><span>学生创造者社区</span><span>NanoCamp</span></div><p class="b-print">MEET.<br>BUILD.</p><div class="b-sheet-bottom"><span>Make something<br>together.</span></div></div><div class="b-sheet b-sheet-mint"><div class="b-mark-wrap">${logoMark('symbol')}</div><div class="b-mint-caption"><strong>把想法<br>做出来。</strong><span>从好奇开始，<br>一起动手。</span></div></div><div class="b-note"><span class="b-note-title">相遇之后，<br>还有很多可能。</span><span>技术分享 · 交流共创<br>一年一度的 minicamp</span></div></div>
  <div class="b-lower"><div class="b-actions"><a class="button button-primary" href="/community/">了解参与方式 <span class="button-plus" aria-hidden="true">+</span></a><a class="b-recap" href="/minicamp/">回看首届 minicamp</a></div><p>想做点什么，<br>可以先从认识人开始。</p></div>
  </div>
  <a class="b-event" href="/minicamp/"><span class="b-event-name">minicamp <span>年度黑客松</span></span><span>首届已结束，一起创造的故事继续。</span><span class="b-event-open">看看发生了什么 ${arrow}</span></a>
</div></section>`;
}

