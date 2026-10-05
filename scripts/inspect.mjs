// 页面几何自检：把关键元素的实测坐标打印到终端。
//
// 为什么需要它：这台机器上 Chrome 的主进程 IPC 走命名管道，而 DSH 的 Windows
// 受限令牌沙箱禁止跨进程打开命名管道，因此 Chrome 只能靠提权启动，且无法用
// DevTools 协议驱动真实滚动。可行且轻量的办法是让页面自己测量、把结果渲染成
// 文本，再用 headless 截图取回。本脚本把这套流程固定下来，避免每次手写临时页面。
//
// 用法：
//   node scripts/inspect.mjs                # 默认检查首页
//   node scripts/inspect.mjs /projects/     # 指定路由
//
// 需要预览服务在跑（npm start 或 npm run dev）。
// 输出：终端摘要 + verify/inspect-<name>.png（文本形式的测量结果截图）。
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'verify');
const port = Number(process.env.PORT || 4187);
const route = process.argv[2] || '/';
const name = route.replace(/[^\w]+/g, '') || 'home';
const probeName = '__inspect.html';
const shot = path.join(outDir, `inspect-${name}.png`);

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROME_CANDIDATES.find(existsSync);
if (!chrome) {
  console.error('找不到 Chrome / Edge 可执行文件，无法截图。');
  process.exit(1);
}

const probe = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:13px/1.7 Consolas,monospace;margin:0;padding:12px;background:#fff}
pre{white-space:pre-wrap;margin:0}
iframe{width:1440px;height:600px;border:1px solid #ccc;margin-top:6px}
</style></head><body><pre id="out">measuring…</pre>
<iframe id="f" src="${route}"></iframe>
<script>
const f = document.getElementById('f');
const box = el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
const cs = (el, p) => getComputedStyle(el).getPropertyValue(p).trim();
const css = (el, pseudo, p) => getComputedStyle(el, pseudo).getPropertyValue(p).trim();
const L = [];
const check = (label, value) => L.push(label.padEnd(38) + value);
f.addEventListener('load', () => setTimeout(() => {
  const d = f.contentDocument, w = f.contentWindow;
  L.push('路由 ${route}  视口 ' + w.innerWidth + 'x' + w.innerHeight);
  L.push('='.repeat(64));

  L.push('[社区行]');
  const row = d.querySelector('.community-row');
  if (row) {
    const label = row.querySelector('.row-label'), action = row.querySelector('.row-action');
    const bar = w.getComputedStyle(row, '::before');
    check('  row box', box(row).join(', '));
    check('  row padding', cs(row, 'padding'));
    check('  row->label 左距', (box(label)[0] - box(row)[0]) + 'px');
    check('  色条 left/transform', bar.left + ' / ' + bar.transform);
    check('  色条左移后 x', (box(row)[0] + parseFloat(bar.left || 0) - 12) + 'px  (label 在 ' + box(label)[0] + 'px)');
    check('  row右->action右', (box(row)[2] - box(action)[2]) + 'px');
  } else L.push('  (本页无)');

  L.push('');
  L.push('[主导航下划线]');
  const navA = d.querySelector('.desktop-nav > a:not(.nav-search)');
  const header = d.querySelector('.site-header');
  if (navA) {
    const range = d.createRange(); range.selectNodeContents(navA);
    const tr = range.getBoundingClientRect();
    const after = w.getComputedStyle(navA, '::after');
    const linkBox = box(navA);
    check('  header box', header ? box(header).join(', ') : '-');
    check('  link box', linkBox.join(', '));
    check('  文字底', Math.round(tr.bottom) + 'px');
    check('  ::after bottom/height', after.bottom + ' / ' + after.height);
    check('  下划线 y', (linkBox[3] - parseFloat(after.bottom || 0) - parseFloat(after.height || 0)) + 'px  (应在文字底之下)');
    check('  下划线是否穿过文字', (linkBox[3] - parseFloat(after.bottom || 0)) > tr.bottom ? '否（正确）' : '是（错位）');
  } else L.push('  (本页无桌面导航)');

  L.push('');
  L.push('[「+」旋转]');
  const plus = d.querySelector('.button-plus');
  if (plus) {
    check('  .button-plus transform', css(plus, null, 'transform'));
    check('  transition', css(plus, null, 'transition'));
  } else L.push('  (本页无)');

  L.push('');
  L.push('[返回顶部浮窗]');
  const fab = d.querySelector('[data-back-to-top]');
  if (fab) {
    check('  position / opacity', css(fab, null, 'position') + ' / ' + css(fab, null, 'opacity'));
    check('  size', box(fab)[2] - box(fab)[0] + 'x' + (box(fab)[3] - box(fab)[1]));
    check('  可见性规则', d.styleSheets ? '已加载' : '-');
  } else L.push('  (无)');

  L.push('');
  L.push('[交互层]');
  check('  interactions.css', [...d.styleSheets].some(s => s.href && s.href.endsWith('/interactions.css')) ? '已加载' : '缺失');
  const joinBtns = [...d.querySelectorAll('.join-paper [data-join], .join-paper .join-fallback')];
  check('  加入区弹窗按钮', joinBtns.map(b => b.tagName.toLowerCase() + ':' + css(b, null, 'display')).join(' | ') || '(无)');

  document.getElementById('out').textContent = L.join('\\n');
}, 2600));
</script></body></html>`;

mkdirSync(outDir, { recursive: true });
const probePath = path.join(dist, probeName);
writeFileSync(probePath, probe, 'utf8');

try {
  const profile = path.join(outDir, 'chrome-profile');
  const res = spawnSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${profile}`, '--hide-scrollbars',
    '--window-size=1500,1400', '--virtual-time-budget=18000',
    `--screenshot=${shot}`, `http://127.0.0.1:${port}/${probeName}`,
  ], { stdio: 'ignore' });
  if (res.error) throw res.error;
  console.log(`测量完成（截图记录）: ${path.relative(root, shot)}`);
  console.log('提示：该截图是页面自测文本，直接打开即可核对数值。');
} finally {
  rmSync(probePath, { force: true });
}
