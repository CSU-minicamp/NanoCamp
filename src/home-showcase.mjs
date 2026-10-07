// 首页作品区的数据来源，构建期读取 content/ 下两份 JSON，页面本身仍是静态 HTML。
//
//   content/home-showcase.json         卡片数据
//   content/home-showcase.scroll.json  滚动配置
//
// 卡片可以只写 id 复用 content/site.mjs 里的作品，例如 { "id": "05" }；
// 也可以把字段写全（title / description / href / cover / theme / tools / members …），
// 写了的字段会覆盖同名作品字段，因此能单独给首页配一条文案或换一张封面。
// 引用不到作品又没有 title 的卡片会被丢掉（构建时打印警告），避免出现空卡片。
import { readFileSync } from 'node:fs';
import { projects } from '../content/site.mjs';
import { esc } from './components.mjs';
import { projectCard } from './projects.mjs';

const TONES = ['blue', 'orange', 'mint', 'sand'];
const DEFAULT_SCROLL = {
  perView: { wide: 3, medium: 2, narrow: 1 },
  gap: 22,
  snap: true,
  arrows: true,
  hint: '',
  autoScroll: { speed: 30 },
};

// 构建期只读一次；卡片与作品数据的合并仍按调用时的 projects 现算，测试里替换数据也能生效。
const rawJson = name => {
  let text;
  try {
    text = readFileSync(new URL(`../content/${name}`, import.meta.url), 'utf8');
  } catch {
    console.warn(`[home-showcase] 缺少 content/${name}，使用默认值。`);
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`content/${name} 不是合法 JSON：${error.message}`);
  }
};

const cardsJson = rawJson('home-showcase.json');
const scrollJson = rawJson('home-showcase.scroll.json');

const positive = (value, fallback) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback);

export function scrollConfig() {
  const perView = scrollJson.perView && typeof scrollJson.perView === 'object' ? scrollJson.perView : {};
  const auto = scrollJson.autoScroll && typeof scrollJson.autoScroll === 'object' ? scrollJson.autoScroll : {};
  const autoScroll = {
    enabled: auto.enabled === true,
    // 每秒滚多少像素；上限 200 是"再快就看不清卡片了"的经验值
    speed: Math.min(positive(auto.speed, DEFAULT_SCROLL.autoScroll.speed), 200),
    pauseOnHover: auto.pauseOnHover !== false,
    loop: auto.loop !== false,
  };
  // 吸附和持续自动滚动会互相拉扯（每帧都被吸回对齐点），自动滚动优先。
  const snap = scrollJson.snap === true;
  if (snap && autoScroll.enabled) console.warn('[home-showcase] scroll 配置里 snap 与 autoScroll 同时为 true，已按自动滚动处理（关闭吸附）。');
  return {
    perView: {
      wide: positive(perView.wide, DEFAULT_SCROLL.perView.wide),
      medium: positive(perView.medium, DEFAULT_SCROLL.perView.medium),
      narrow: positive(perView.narrow, DEFAULT_SCROLL.perView.narrow),
    },
    gap: positive(scrollJson.gap, DEFAULT_SCROLL.gap),
    snap: snap && !autoScroll.enabled,
    arrows: scrollJson.arrows !== false,
    hint: typeof scrollJson.hint === 'string' ? scrollJson.hint.trim() : DEFAULT_SCROLL.hint,
    autoScroll,
  };
}

// 合并成 projectCard() 认得的数据形状；id 去重，保证页面里的 id 属性唯一。
export function showcaseCards() {
  const list = Array.isArray(cardsJson.cards) ? cardsJson.cards : [];
  const seen = new Set();
  return list.map((card, index) => {
    const source = card && typeof card === 'object' ? card : {};
    const base = source.id ? projects.find(item => item.id === String(source.id)) : null;
    const merged = { ...(base || {}), ...source };
    if (!String(merged.title || '').trim()) {
      console.warn(`[home-showcase] 第 ${index + 1} 张卡片既没有 id 也没有 title，已跳过。`);
      return null;
    }
    const id = String(merged.id || index + 1).padStart(2, '0');
    if (seen.has(id)) {
      console.warn(`[home-showcase] 卡片 id 重复：${id}，已跳过。`);
      return null;
    }
    seen.add(id);
    return { ...merged, id, tone: TONES.includes(merged.tone) ? merged.tone : TONES[index % TONES.length] };
  }).filter(Boolean);
}

const arrowIcon = direction => `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="${direction === 'prev' ? 'M17 10H4m5-5-5 5 5 5' : 'M3 10h13m-5-5 5 5-5 5'}"/></svg>`;

// 卡片为空时返回 null，调用方可以退回原来的作品档案引导块。
export function homeShowcase() {
  const cards = showcaseCards();
  if (!cards.length) return null;
  const config = scrollConfig();
  const auto = config.autoScroll;
  // 自动滚动需要再渲染一组副本卡片：滚过一整组后把位置减去组宽，画面完全对得上，
  // 所以看不到"倒带"。副本不带 id、不进无障碍树、不参与 Tab（见 projectCard 的 clone）。
  const loop = auto.enabled && auto.loop;
  const items = [
    ...cards.map(card => projectCard(card, card.tone)),
    ...(loop ? cards.map(card => projectCard(card, card.tone, { clone: true })) : []),
  ].join('');
  const style = `--per-wide:${config.perView.wide};--per-medium:${config.perView.medium};--per-narrow:${config.perView.narrow};--card-gap:${config.gap}px`;
  const scrollerAttrs = [
    'data-projects-scroller',
    auto.enabled ? `data-autoscroll="${auto.speed}"` : '',
    auto.enabled && auto.pauseOnHover ? 'data-pause-on-hover' : '',
    loop ? 'data-loop' : '',
  ].filter(Boolean).join(' ');
  const trackAttrs = [
    'data-projects-track',
    config.snap ? 'data-snap' : '',
    'tabindex="0"',
    'role="region"',
    'aria-label="社区作品，可横向滚动浏览"',
  ].filter(Boolean).join(' ');
  const hint = config.hint ? `<p class="scroller-hint mono">${esc(config.hint)}</p>` : '';
  const controls = config.arrows
    ? `<div class="scroller-controls"><button type="button" class="scroller-arrow" data-scroll-prev aria-label="向左浏览作品">${arrowIcon('prev')}</button><button type="button" class="scroller-arrow" data-scroll-next aria-label="向右浏览作品">${arrowIcon('next')}</button></div>`
    : '';
  const foot = hint || controls ? `<div class="scroller-foot">${hint}${controls}</div>` : '';
  return `<div class="projects-scroller" ${scrollerAttrs} style="${style}"><div class="projects-grid projects-track" ${trackAttrs}>${items}</div>${foot}</div>`;
}
