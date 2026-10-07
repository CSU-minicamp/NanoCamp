// 作品默认封面：以品牌名「nanocamp」的字形为骨架做二创，按作品 ID 确定性生成 SVG。
// 同一作品每次渲染结果一致；无 Logo 时降级为纯字形的 NC 演绎。
// 对外只暴露三个入口：projectCover（内联 SVG）、projectCoverDataUri（img/CSS 场景）、coverRatios。
import { site } from '../content/site.mjs';

// 品牌色板：取自站点既有色系，ink 与底色保证足够对比（深色文字 + 浅色底）。
const PALETTES = [
  { key: 'blue', from: '#eaf2ff', to: '#c8dffb', ink: '#1b4f9c', accent: '#245fd6', grid: '#245fd6', chip: '#d8e8ff' },
  { key: 'mint', from: '#e8f7ef', to: '#c6ebd9', ink: '#1c6a51', accent: '#2f9d78', grid: '#2f9d78', chip: '#d4f0e2' },
  { key: 'sand', from: '#fdf3e5', to: '#f6e0bf', ink: '#8a5320', accent: '#e0913a', grid: '#e0913a', chip: '#fae6c4' },
  { key: 'lilac', from: '#f1edfc', to: '#dbd2f6', ink: '#4a3787', accent: '#6d55c9', grid: '#6d55c9', chip: '#e3dcf8' },
  { key: 'sky', from: '#e9f7fb', to: '#c6e7f2', ink: '#1c5a6e', accent: '#2b90ad', grid: '#2b90ad', chip: '#d5eef6' },
  { key: 'rose', from: '#fdf0f2', to: '#f6d8dd', ink: '#8c3a48', accent: '#cf6274', grid: '#cf6274', chip: '#fadfe3' },
];

const RATIOS = { '1:1': [640, 640], '4:3': [640, 480], '3:2': [640, 427], '16:9': [640, 360], '2:1': [640, 320] };

// FNV-1a：稳定的确定性哈希，仅依赖输入内容。
function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (const char of String(input)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const xml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const clampText = (value, max) => { const text = String(value ?? '').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

// 字号按画布尺寸收敛，保证 1:1 与 16:9 下都既饱满又不出界。
function typography(width, height) {
  const twoLine = height >= 460;
  if (twoLine) {
    const size = Math.min(width * 0.175, height * 0.235);
    return { twoLine: true, size, leading: size * 0.9, lines: ['nano', 'camp'] };
  }
  const size = Math.min(width * 0.128, height * 0.44);
  return { twoLine: false, size, leading: size, lines: ['nanocamp'] };
}

// Logo 徽章：圆形裁切 + 品牌色底衬 + 同心细环，落在画面一角并与字形层叠，
// 避免「居中贴图」；缺失 Logo 时用 NC 字母演绎同一个圆形徽章，视觉语言一致。
function logoBadge({ uid, width, height, logo, palette, hash }) {
  const size = Math.min(width, height) * 0.42;
  const r = size * 0.5;
  const corner = (hash >>> 17) % 2 === 0;
  const cx = corner ? width - size * 0.34 : width - size * 0.30;
  const cy = corner ? height - size * 0.30 : size * 0.44;
  const ring = `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 1.16).toFixed(1)}" fill="none" stroke="${palette.accent}" stroke-width="1.5" opacity=".35"/>`;
  const disc = `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${palette.chip}" opacity=".9"/>`;
  const mark = logo
    ? `<image href="${xml(logo)}" x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" clip-path="url(#${uid}-clip)" preserveAspectRatio="xMidYMid slice" style="mix-blend-mode:multiply" opacity=".92"/>`
    : `<text x="${cx.toFixed(1)}" y="${(cy + r * 0.34).toFixed(1)}" text-anchor="middle" font-size="${(r * 0.52).toFixed(1)}" fill="${palette.ink}" opacity=".85">NC</text>`;
  const clip = `<clipPath id="${uid}-clip"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"/></clipPath>`;
  return { clip, art: `<g aria-hidden="true">${ring}${disc}${mark}</g>` };
}

// instance 只用于隔离同一作品在同一页面被渲染多次（如首页无缝循环的克隆卡片）时的 DOM id，
// 不改变配色与版式，因此同一 (id, instance) 组合的渲染结果仍然稳定可复现。
export function projectCover({ id = '', title = '', ratio = '4:3', logo = site.symbol, style = 0, instance = 0 } = {}) {
  const [width, height] = RATIOS[ratio] || RATIOS['4:3'];
  const hash = fnv1a(`nanocamp|${id}|${title}|${style}`);
  const palette = PALETTES[hash % PALETTES.length];
  const variant = (hash >>> 5) % 4;
  const gridSize = 20 + ((hash >>> 9) % 3) * 10;
  const uid = `cover-${(hash >>> 0).toString(36)}-${String(id).replace(/[^a-z0-9]+/gi, '') || 'x'}${instance ? `-i${instance}` : ''}`;
  const type = typography(width, height);
  const pad = Math.round(width * 0.088);
  const echoX = variant % 2 === 0 ? 10 + variant * 3 : -(8 + variant * 3);
  const echoY = -(7 + variant * 2);
  const badge = logoBadge({ uid, width, height, logo, palette, hash });

  // 主文字基线：两行时整体垂直居中略偏下，单行时居中偏下。
  const startY = type.twoLine ? height * 0.5 + type.leading * 0.1 : height * 0.58;
  const lineNodes = type.lines.map((line, index) => {
    const y = startY + index * type.leading;
    const outline = type.twoLine ? index === 1 : false;
    const shared = `x="${pad}" y="${y.toFixed(1)}" font-size="${type.size.toFixed(1)}"`;
    const echo = `<text ${shared} fill="${palette.accent}" opacity=".3" transform="translate(${echoX} ${echoY})">${xml(line)}</text>`;
    const main = outline
      ? `<text ${shared} fill="none" stroke="${palette.ink}" stroke-width="${(type.size * 0.022).toFixed(2)}">${xml(line)}</text>`
      : `<text ${shared} fill="${palette.ink}">${xml(line)}</text>`;
    return echo + main;
  }).join('');

  const captionText = clampText(title, 22) || 'NANOCAMP / MINICAMP';
  const glyphCount = 3 + ((hash >>> 13) % 3);
  const dots = Array.from({ length: glyphCount }, (_, index) => {
    const cx = width - pad - index * (gridSize * 0.9) - gridSize * 0.4;
    const cy = pad + gridSize * 0.4;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(gridSize * 0.12).toFixed(1)}" fill="${palette.accent}" opacity="${(0.5 - index * 0.12).toFixed(2)}"/>`;
  }).join('');

  // 双描边：外圈深色（浅色背景下可辨）+ 内圈浅色（深色背景下可辨）。
  const frame = `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" fill="none" stroke="#172b36" stroke-opacity=".14" stroke-width="1.5"/><rect x="2.5" y="2.5" width="${width - 5}" height="${height - 5}" fill="none" stroke="#ffffff" stroke-opacity=".38" stroke-width="1"/>`;
  const label = `作品封面：${xml(clampText(title, 40) || '未命名作品')}｜NanoCamp 品牌默认封面（${palette.key} 样式）`;

  return `<svg class="project-cover" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" role="img" aria-labelledby="${uid}-title" focusable="false" xmlns="http://www.w3.org/2000/svg"><title id="${uid}-title">${label}</title><defs><linearGradient id="${uid}-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.from}"/><stop offset="1" stop-color="${palette.to}"/></linearGradient><pattern id="${uid}-grid" width="${gridSize}" height="${gridSize}" patternUnits="userSpaceOnUse"><path d="M${gridSize} 0H0V${gridSize}" fill="none" stroke="${palette.grid}" stroke-width="1" opacity=".14"/></pattern>${badge.clip}</defs><rect width="${width}" height="${height}" fill="url(#${uid}-bg)"/><rect width="${width}" height="${height}" fill="url(#${uid}-grid)"/><path d="${variant % 2 === 0 ? `M0 ${(height * 0.68).toFixed(1)}L${width} ${(height * 0.46).toFixed(1)}V${height}H0Z` : `M0 ${(height * 0.5).toFixed(1)}L${width} ${(height * 0.72).toFixed(1)}V${height}H0Z`}" fill="${palette.accent}" opacity=".13"/>${dots}<circle cx="${(width * 0.82).toFixed(1)}" cy="${(height * 0.18).toFixed(1)}" r="${(Math.min(width, height) * 0.16).toFixed(1)}" fill="none" stroke="${palette.accent}" stroke-width="2" opacity=".28"/>${badge.art}${lineNodes}<g aria-hidden="true"><path d="M${pad} ${(height - pad * 0.72).toFixed(1)}H${(pad + Math.min(width * 0.34, 200)).toFixed(1)}" stroke="${palette.ink}" stroke-width="1.5" opacity=".45"/></g><text x="${pad}" y="${(height - pad * 0.32).toFixed(1)}" font-size="${(Math.max(15, Math.min(width, height) * 0.036)).toFixed(1)}" fill="${palette.ink}" opacity=".72" style="font-family:NanoLatin,'Microsoft YaHei',sans-serif">${xml(captionText)}</text>${frame}</svg>`;
}

// 需要 <img>/CSS 背景时使用的 data URI 版本：不引用外部 Logo，只用字形演绎（外部资源在 img 内不可用）。
export function projectCoverDataUri(options = {}) {
  const svg = projectCover({ ...options, logo: '' });
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const coverRatios = Object.keys(RATIOS);
