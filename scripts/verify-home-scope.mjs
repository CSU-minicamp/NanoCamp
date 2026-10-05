// 首页隔离自检：确认改动只落在首页，其他页面与还原后的共享行为一致。
//
// 用法：node scripts/verify-home-scope.mjs   （需要 npm start / npm run dev 在跑）
// 会启动一次 headless Chrome，在各页面的 iframe 里读取实际计算样式与 DOM，
// 把结果渲染成文本后截图到 verify/scope-<page>.png。
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'verify');
const port = Number(process.env.PORT || 4187);

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROME_CANDIDATES.find(existsSync);
if (!chrome) { console.error('找不到 Chrome / Edge。'); process.exit(1); }

// 每页要检查的项：首页应该"有"，其他页面应该"没有"或被还原
const PAGES = ['/', '/activities/', '/minicamp/', '/projects/', '/community/', '/404.html'];

const probe = (routes) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:12.5px/1.65 Consolas,monospace;margin:0;padding:12px;background:#fff}
pre{white-space:pre-wrap;margin:0}
iframe{width:1400px;height:400px;border:1px solid #ccc;margin:6px 0}
</style></head><body><pre id="out">measuring…</pre><div id="frames"></div>
<script>
const routes = ${JSON.stringify(routes)};
const L = [];
const frames = document.getElementById('frames');
const results = {};
let pending = routes.length;
const done = () => { if (--pending === 0) finish(); };

routes.forEach(route => {
  const f = document.createElement('iframe');
  f.src = route;
  f.addEventListener('load', () => setTimeout(() => {
    const d = f.contentDocument, w = f.contentWindow;
    const page = d.body.dataset.page || '(none)';
    const cs = (el, p) => el ? w.getComputedStyle(el).getPropertyValue(p).trim() : '-';
    const has = sel => !!d.querySelector(sel);
    const count = sel => d.querySelectorAll(sel).length;
    const r = {
      route, page,
      interactionsLoaded: [...d.styleSheets].some(s => s.href && s.href.endsWith('/interactions.css')),
      // 首页专属
      hero: has('[data-brand-hero]'),
      heroFloat: (cs(d.querySelector('.b-sheet-lilac'), 'animation-name') || '').includes('float-soft'),
      homeJoin: !!d.querySelector('.join-section .join-inner .join-paper'),
      // 只应在首页生效的交互（其他页必须为默认值）
      navAfterContent: d.querySelector('.desktop-nav > a:not(.nav-search)')
        ? w.getComputedStyle(d.querySelector('.desktop-nav > a:not(.nav-search)'), '::after').content : '-',
      buttonAfterDisplay: d.querySelector('.button')
        ? w.getComputedStyle(d.querySelector('.button'), '::after').display : '-',
      footerNavAfterContent: d.querySelector('.footer-top nav a')
        ? w.getComputedStyle(d.querySelector('.footer-top nav a'), '::after').transform : '-',
      // 共享件（还原后应全站都在）
      motionToggle: count('[data-site-motion-toggle]'),
      shareButton: count('[data-share-page]'),
      readingProgress: count('[data-reading-progress]'),
      joinFallbackDisplay: cs(d.querySelector('.header-actions .join-fallback'), 'display'),
      plusRotation: cs(d.querySelector('.button-plus'), 'transform'),
    };
    results[route] = r;
    done();
  }, 1600));
  frames.append(f);
});

function finish() {
  const home = results['/'];
  L.push('首页隔离自检 —— 期望：交互与文案只在 "/"，共享件在每页都在');
  L.push('='.repeat(96));
  L.push('');
  const cols = ['route','page','hero','heroFloat','homeJoin','int.css','nav::after','btn::after','motionTgl','share','readProg','+rot'];
  L.push(cols.map(c => c.padEnd(11)).join(''));
  L.push('-'.repeat(96));
  Object.values(results).forEach(r => {
    L.push([
      r.route, r.page,
      r.hero ? 'yes' : '-', r.heroFloat ? 'yes' : '-', r.homeJoin ? 'yes' : '-',
      r.interactionsLoaded ? 'yes' : '-',
      r.navAfterContent === '""' ? 'empty' : (r.navAfterContent === 'none' ? 'none' : '?'),
      r.buttonAfterDisplay, r.motionToggle, r.shareButton, r.readingProgress,
      r.plusRotation === 'none' ? 'none' : r.plusRotation,
    ].map(v => String(v).padEnd(11)).join(''));
  });
  L.push('');
  L.push('判定：');
  L.push('  * nav::after 应为 empty（无下划线伪元素）→ 说明交互层没跑到该页');
  L.push('  * btn::after 应为 none（collage.css 的 display:none 生效，未被交互层覆盖）');
  L.push('  * 首页 int.css=yes，其他页也加载但规则被 body[data-page=home] 挡掉');
  L.push('  * motionTgl / share / readProg 每页都应 >=1（共享件已还原）');
  document.getElementById('out').textContent = L.join('\\n');
}
</script></body></html>`;

mkdirSync(outDir, { recursive: true });
const probePath = path.join(dist, '__scope.html');
writeFileSync(probePath, probe(PAGES), 'utf8');
const shot = path.join(outDir, 'scope.png');

try {
  spawnSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${path.join(outDir, 'scope-profile')}`,
    '--hide-scrollbars', '--window-size=1500,900', '--virtual-time-budget=25000',
    `--screenshot=${shot}`, `http://127.0.0.1:${port}/__scope.html`,
  ], { stdio: 'ignore' });
  console.log(`结果截图: ${path.relative(root, shot)}`);
} finally {
  rmSync(probePath, { force: true });
}
