import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeShowcase, scrollConfig } from '../src/home-showcase.mjs';
import { createDocument, createWindow, parse, runScript, toFakeNodes } from './helpers/fake-dom.mjs';

const source = readFileSync(new URL('../public/projects-scroll.js', import.meta.url), 'utf8');

// 卡片宽 380 + 间距 22 → 每张 402；一组 6 张 = 2400（真卡首张 left=2，副本首张 left=2402）。
const CARD = 380;
const GAP = 22;
const GROUP = 2400;
const SPEED = 30;

function fixture({ loop = true, autoscroll = String(SPEED), reducedMotion = false, snapGrid = 0 } = {}) {
  const document = createDocument();
  document.body.append(toFakeNodes(parse(homeShowcase()), document));

  const scroller = document.querySelector('[data-projects-scroller]');
  const track = document.querySelector('[data-projects-track]');
  if (!loop) scroller.removeAttribute('data-loop');
  if (!autoscroll) scroller.removeAttribute('data-autoscroll');
  scroller.dataset = { autoscroll };
  const classes = new Set();
  scroller.classList = {
    toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
    add: name => classes.add(name),
    remove: name => classes.delete(name),
  };

  const cards = [...track.querySelectorAll('.project-card')];
  const place = (nodes, start) => nodes.forEach((node, index) => {
    node.getBoundingClientRect = () => ({ width: CARD, left: start + index * (CARD + GAP) });
  });
  place(cards.filter(card => !card.hasAttribute('aria-hidden')), 2);
  place(cards.filter(card => card.hasAttribute('aria-hidden')), 2 + GROUP);

  track.scrollLeft = 0;
  track.scrollWidth = 2 * GROUP + 4;
  track.clientWidth = 1200;
  if (snapGrid) {
    // 模拟浏览器把 scrollLeft 吸附到物理像素栅格（dpr 1.5 → 0.667px）：写 0.5 读回来是 0。
    let stored = 0;
    Object.defineProperty(track, 'scrollLeft', {
      get: () => stored,
      set: value => { stored = Math.floor(value / snapGrid) * snapGrid; },
      configurable: true,
    });
  }
  track.scrollBy = ({ left }) => {
    track.scrollLeft += left;
    track.dispatchEvent({ type: 'scroll' });
  };

  const window = createWindow(document);
  const frames = [];
  window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  const reduced = { matches: reducedMotion, addEventListener: () => {}, removeEventListener: () => {} };
  const clock = { now: 0 };
  const timers = { timeouts: [], intervals: [] };
  runScript(source, document, window, {
    requestAnimationFrame: window.requestAnimationFrame,
    matchMedia: () => reduced,
    getComputedStyle: () => ({ columnGap: `${GAP}px`, paddingLeft: '2px' }),
    addEventListener: () => {},
    performance: { now: () => clock.now },
    setTimeout: (callback, ms) => { timers.timeouts.push({ callback, ms }); return timers.timeouts.length; },
    setInterval: (callback, ms) => { timers.intervals.push({ callback, ms, cleared: false }); return timers.intervals.length; },
    clearInterval: id => { if (timers.intervals[id - 1]) timers.intervals[id - 1].cleared = true; },
  }, 'public/projects-scroll.js');

  // 手动推进：时长取自 performance.now()，所以先把假时钟往前拨，再跑这一帧。
  const advance = ms => {
    clock.now += ms;
    const pending = frames.splice(0);
    pending.forEach(callback => callback(clock.now));
  };
  return {
    document,
    scroller,
    track,
    reduced,
    classes,
    advance,
    clock,
    timers,
    cards,
    prev: scroller.querySelector('[data-scroll-prev]'),
    next: scroller.querySelector('[data-scroll-next]'),
  };
}

test('横滑区按 JSON 配置渲染：自动滚动、副本卡片、无重复 id', () => {
  const html = homeShowcase();
  const config = scrollConfig();
  assert.equal(config.autoScroll.enabled, true);
  assert.equal(config.snap, false, '开启自动滚动时不再吸附，否则每帧都会被吸回对齐点');
  assert.match(html, /data-autoscroll="\d+"/);
  assert.match(html, /data-pause-on-hover/);
  assert.match(html, /data-loop/);
  assert.doesNotMatch(html, /data-snap/);

  const ids = [...html.matchAll(/id="(project-[\w-]+)"/g)].map(match => match[1]);
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length, '副本卡片不能重复真卡片的 id');

  const clones = html.match(/class="project-card"[^>]*aria-hidden="true"[\s\S]*?<\/article>/g) || [];
  assert.ok(clones.length > 0, '自动滚动需要副本卡片做无缝循环');
  assert.equal(clones.length, ids.length, '副本数量应与真卡片一致');
  assert.ok(clones.every(block => !/<a (?!tabindex="-1")/.test(block)), '副本里的链接不参与 Tab 顺序');
});

test('自动滚动：按 speed 推进，悬停暂停，移开后继续', () => {
  const { scroller, track, advance } = fixture();
  advance(0);
  assert.equal(track.scrollLeft, 0, '第一帧没有时间差，不该跳动');
  advance(25);
  assert.ok(Math.abs(track.scrollLeft - SPEED * 0.025) < 1e-6, `25ms 应前进 0.75px，实际 ${track.scrollLeft}`);
  for (let i = 0; i < 39; i++) advance(25);
  assert.ok(Math.abs(track.scrollLeft - SPEED) < 1e-6, `累计 1 秒应前进 ${SPEED}px，实际 ${track.scrollLeft}`);

  scroller.dispatchEvent({ type: 'pointerenter' });
  const paused = track.scrollLeft;
  for (let i = 0; i < 39; i++) advance(25);
  assert.equal(track.scrollLeft, paused, '悬停期间不应继续滚动');

  scroller.dispatchEvent({ type: 'pointerleave' });
  advance(25);
  assert.ok(track.scrollLeft > paused, '移开鼠标后应恢复滚动');
  assert.ok(Math.abs(track.scrollLeft - (paused + SPEED * 0.025)) < 1e-6, '恢复后按同一速度继续');
});

test('无缝循环：滚过一组宽度后减去组宽，画面接得上', () => {
  const { track, advance } = fixture();
  advance(0);
  track.scrollLeft = GROUP - 0.5;
  track.dispatchEvent({ type: 'scroll' });   // 外部改位置要经过 scroll 事件才会被采纳
  advance(25);
  assert.ok(track.scrollLeft < GROUP, `应已回绕，实际 ${track.scrollLeft}`);
  assert.ok(Math.abs(track.scrollLeft - (SPEED * 0.025 - 0.5)) < 1e-6, `回绕后应贴近开头，实际 ${track.scrollLeft}`);
});

test('scrollLeft 被吸附到像素栅格时依然推进（回归：读回累加的写法会永远停在原地）', () => {
  const { track, advance } = fixture({ snapGrid: 2 / 3 });   // dpr 1.5 → 栅格 0.667px
  advance(0);
  for (let i = 0; i < 40; i++) advance(25);
  assert.ok(track.scrollLeft >= 29, `1 秒应推进约 ${SPEED}px，实际 ${track.scrollLeft}`);
  assert.ok(track.scrollLeft <= SPEED + 1e-6, `不该超过 1 秒的量，实际 ${track.scrollLeft}`);
});

test('箭头：点一下滚一张卡，最左禁用左箭头', () => {
  const { track, prev, next } = fixture();
  track.dispatchEvent({ type: 'scroll' });
  assert.equal(prev.disabled, true, '已在最左，左箭头应禁用');
  assert.equal(next.disabled, false, '右边还有副本，右箭头一直可用');
  next.dispatchEvent({ type: 'click' });
  assert.equal(track.scrollLeft, CARD + GAP, '点右箭头前进一张卡 + 一个间距');
  assert.equal(prev.disabled, false, '前进之后左箭头恢复可用');
});

test('rAF 不触发时用定时器兜底，rAF 正常时定时器自动退出', () => {
  const dead = fixture();
  assert.equal(dead.timers.timeouts.length, 1, '应注册一个看门狗');
  assert.equal(dead.timers.intervals.length, 0, '还没到点，先不起定时器');
  dead.timers.timeouts[0].callback();
  assert.equal(dead.timers.intervals.length, 1, '看门狗到点后应起定时器');

  const timer = dead.timers.intervals[0];
  dead.clock.now = 1000;
  timer.callback();
  dead.clock.now = 1016;
  timer.callback();
  assert.ok(dead.track.scrollLeft > 0, `rAF 缺失时定时器应推动滚动，实际 ${dead.track.scrollLeft}`);
  assert.equal(timer.cleared, false, 'rAF 一直没动静，定时器应继续跑');
  assert.equal(dead.scroller.dataset.autoscrollState, 'running', '当前状态应写在元素上，便于排查');

  const alive = fixture();
  alive.advance(0);
  alive.timers.timeouts[0].callback();
  const spare = alive.timers.intervals[0];
  spare.callback();
  assert.equal(spare.cleared, true, 'rAF 活着时兜底定时器应立刻退出');
});

test('暂停状态写在元素上，移开恢复 running', () => {
  const { scroller, advance } = fixture();
  advance(0);
  assert.equal(scroller.dataset.autoscrollState, 'running');
  scroller.dispatchEvent({ type: 'pointerenter' });
  advance(16);
  assert.equal(scroller.dataset.autoscrollState, 'paused');
  scroller.dispatchEvent({ type: 'pointerleave' });
  advance(16);
  assert.equal(scroller.dataset.autoscrollState, 'running');
});

test('未开自动滚动或减少动效时，退回普通横滑区并标记 off', () => {
  const off = fixture({ autoscroll: '' });
  off.advance(0);
  off.advance(1000);
  assert.equal(off.track.scrollLeft, 0, '没有 data-autoscroll 就不该自动滚');
  assert.equal(off.scroller.dataset.autoscrollState, 'off');
  assert.equal(off.timers.timeouts.length, 0, '不自动滚就不该留看门狗');

  const still = fixture({ reducedMotion: true });
  still.advance(0);
  still.advance(1000);
  assert.equal(still.track.scrollLeft, 0, 'prefers-reduced-motion 下不该自动滚');
  assert.equal(still.scroller.dataset.autoscrollState, 'off');
  still.track.scrollLeft = still.track.scrollWidth - still.track.clientWidth;
  still.track.dispatchEvent({ type: 'scroll' });
  assert.equal(still.next.disabled, true, '不循环时应能滚到底并禁用右箭头');

  const plain = fixture({ loop: false });
  plain.track.dispatchEvent({ type: 'scroll' });
  assert.equal(plain.prev.disabled, true);
  plain.track.scrollLeft = plain.track.scrollWidth - plain.track.clientWidth;
  plain.track.dispatchEvent({ type: 'scroll' });
  assert.equal(plain.next.disabled, true, '没有循环时滚到最右应禁用右箭头');
  assert.equal(plain.classes.has('is-static'), false);
});
