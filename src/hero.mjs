import { logoMark } from './components.mjs';

const arrow = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 16 16 4M4 4h12v12"/></svg>';
const spark = '<svg class="spark" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0Q58 42 100 50Q58 58 50 100Q42 58 0 50Q42 42 50 0Z" fill="currentColor"/></svg>';

export function hero() {
  return `<section class="brand-hero poster-b" data-brand-hero aria-labelledby="hero-heading"><div class="container">
  <div class="b-intro"><h1 id="hero-heading">让有趣的人相遇，<br><span>让相遇的人一起创造。</span></h1><p>从一次 minicamp 开始，<br>之后一直在一起做东西。</p></div>
  <div class="b-wall"><div class="b-sheet b-sheet-lilac"><div class="b-sheet-top"><span>学生创造者社区</span><span>NanoCamp</span></div><p class="b-print">MEET.<br>BUILD.</p><div class="b-sheet-bottom"><span>Make something<br>together.</span>${spark}</div></div><div class="b-sheet b-sheet-mint"><div class="b-mark-wrap">${logoMark('symbol')}</div><div class="b-mint-caption"><strong>把想法<br>做出来。</strong><span>从好奇开始，<br>一起动手。</span></div></div><div class="b-note"><span class="b-note-title">相遇之后，<br>还有很多可能。</span><span>技术分享 · 交流共创<br>一年一度的 minicamp</span></div></div>
  <div class="b-lower"><div class="b-actions"><a class="button button-primary" href="/community/">了解参与方式 <span class="button-plus" aria-hidden="true">+</span></a><a class="b-recap" href="/minicamp/">回看首届 minicamp</a></div><p>想做点什么，<br>可以先从认识人开始。</p></div>
  <a class="b-event" href="/minicamp/"><span class="b-event-name">minicamp <span>年度黑客松</span></span><span>首届已结束，一起创造的故事继续。</span><span class="b-event-open">看看发生了什么 ${arrow}</span></a>
</div></section>`;
}

