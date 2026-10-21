// 首页作品区的数据来源：读 content/home-showcase.json，页面本身仍是静态 HTML。
//（横向滚动的旧实现已随首页改版移除，这里只保留卡片数据。）
//
// 卡片可以只写 id 复用 content/site.mjs 里的作品，例如 { "id": "05" }；
// 也可以把字段写全（title / description / href / cover / theme / tools / members …），
// 写了的字段会覆盖同名作品字段，因此能单独给首页配一条文案或换一张封面。
// 引用不到作品又没有 title 的卡片会被丢掉（构建时打印警告），避免出现空卡片。
import { readFileSync } from 'node:fs';
import { projects } from '../content/site.mjs';

const TONES = ['blue', 'orange', 'mint', 'sand'];

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
