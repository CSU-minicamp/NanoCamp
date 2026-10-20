import { homeIcon } from './home-art.mjs';


// 海报就是首页首屏的全部内容，现在单独成页（/intro/），首页只用 iframe 嵌入它：
// 入场动画在 iframe 里跑，不会拖住首页其余部分的渲染，海报也能单独打开检查。
export const introPath = '/intro/';

// 首页只留嵌入用的外壳和一个视觉隐藏的 h1：
// 页面标题结构不依赖 iframe 内部，JS 被禁用时首页也不会缺主标题。
export function heroEmbed() {
  return `<section class="home-hero" aria-labelledby="hero-heading"><h1 id="hero-heading" class="sr-only">让有趣的人相遇，让相遇的人一起创造。</h1><iframe class="home-hero-frame" src="${introPath}" title="NanoCamp 首页海报：让有趣的人相遇，让相遇的人一起创造。" loading="eager"></iframe></section>`;
}

export function hero() {
  return `<section class="brand-hero poster-b" aria-labelledby="hero-heading"><div class="hero-playground"><canvas class="hero-constellation" aria-hidden="true"></canvas>
    <div class="hero-orbit orbit-planet">${homeIcon('planet')}<span>A LITTLE CURIOUS.</span></div>
    <div class="hero-orbit orbit-code">${homeIcon('code')}</div>
    <div class="hero-orbit orbit-bulb">${homeIcon('bulb')}</div>
    <div class="hero-orbit orbit-people">${homeIcon('people')}<span>BETTER TOGETHER.</span></div>
    <span class="hero-spark spark-one" aria-hidden="true">✦</span><span class="hero-spark spark-two" aria-hidden="true">✧</span>
    <div class="hero-center"><p class="hero-eyebrow"><span></span> HELLO, WE ARE NANOCAMP</p><h1 id="hero-heading">让有趣的人相遇，<br>让相遇的人<span class="hero-highlight">一起创造<svg viewBox="0 0 360 20" preserveAspectRatio="none" aria-hidden="true"><path d="M6 13Q160-2 352 10M27 18Q170 7 330 17"/></svg></span>。</h1><p class="hero-description">一个面向学生的创造者社区。<br>从好奇开始，把「要不试试」变成「我们做到了」。</p><div class="hero-links"><a class="hero-primary" href="/community/">来认识新伙伴 <span aria-hidden="true">↗</span></a><a class="hero-secondary" href="/projects/">看看大家做了什么 <span aria-hidden="true">→</span></a></div><div class="hero-welcome"><span>不限专业</span><i>✦</i><span>无需经验</span><i>✦</i><span>感兴趣就来</span></div></div>
    <div class="hero-bottom"><span>SMALL IDEAS. BIG POSSIBILITIES.</span><span>向下探索 <span aria-hidden="true">↓</span></span><span>MEET / BUILD / TOGETHER</span></div>
  </div></section>`;
}
