import { joinButton } from './components.mjs';
import { site } from '../content/site.mjs';

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
  // 三张纸共用同一套版式：顶部小字 → Latin 大字 → 底部说明。
  // 薄荷那张原来放圆形 logo，现在换成和淡紫那张同字号同字重的 IDEA. / SPARK.；
  // 黄色便签原来只有一行 20px 标题撑着，是三个里最弱的一块，现在按站内既有的"黄纸"
  // 路数重做：等宽 kicker + Latin 大字 + 细线上方的说明。
  return `<section class="brand-hero poster-b" data-brand-hero aria-labelledby="hero-heading"><div class="container">
  <div class="b-main">
  <div class="b-intro"><h1 id="hero-heading">让有趣的人相遇，<br><span>让相遇的人一起创造。</span></h1></div>
  <div class="b-wall"><div class="b-sheet b-sheet-lilac"><div class="b-sheet-top"><span>学生创造者社区</span><span>NanoCamp</span></div><p class="b-print">MEET.<br>BUILD.</p><div class="b-sheet-bottom"><span>Make something<br>together.</span></div></div><div class="b-sheet b-sheet-mint"><div class="b-sheet-top"><span>把想法做出来</span></div><p class="b-print">IDEA.<br>SPARK.</p><div class="b-sheet-bottom"><span>从好奇开始，一起动手。</span></div></div><div class="b-note"><span class="b-note-label">相遇之后 · 还有很多可能</span><p class="b-note-print">MORE<br>TO&nbsp;COME.</p><span class="b-note-foot">技术分享 · 交流共创<br>一年一度的 minicamp</span></div></div>
  <div class="b-lower"><div class="b-actions"><a class="button b-cta b-cta-solid" href="/community/">了解参与方式 <span class="button-plus" aria-hidden="true">+</span></a><a class="button b-cta b-cta-ghost" href="/minicamp/">回看首届 minicamp</a></div><p>想做点什么，<br>可以先从认识人开始。</p></div>
  </div>
  <a class="b-event" href="/minicamp/"><span class="b-event-name">minicamp <span>年度黑客松</span></span><span>首届已结束，一起创造的故事继续。</span><span class="b-event-open">看看发生了什么 ${arrow}</span></a>
</div></section>`;
}

// 首页专属的加入区。原本用 components.mjs 里的 joinSection()，但那个函数被其余 13 个
// 页面共用，放在这里可以让 components.mjs 只保留 <link> 一处改动，降低合并冲突。
export function homeJoinSection() {
  const available = Boolean(site.join.qrCode || site.join.contact);
  return `<section class="join-section" aria-labelledby="join-heading"><div class="container join-inner"><div class="join-copy"><h2 id="join-heading">有想做的，<br>就会有人一起。</h2><p>说一句你想做什么，自然会有人接话。</p></div><div class="join-paper"><strong>See you<br>at NanoCamp.</strong><span>${available ? '欢迎每一份好奇心。' : '加入渠道尚未公布，可先阅读参与指南。'}</span>${joinButton(available ? '查看加入渠道' : '查看加入方式', 'button-small')}</div></div></section>`;
}
