import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { header, footer } from '../src/components.mjs';
import { createDocument, parse, canonical, runBase, FakeNode, findFirst } from './helpers/fake-dom.mjs';

const baseSource = readFileSync(new URL('../public/base.js', import.meta.url), 'utf8');

function loadBase({ page = '' } = {}) {
  const document = createDocument();
  if (page) document.body.setAttribute('data-page', page);

  // 复刻 components.mjs 的结构：nav 槽位（属性也与模板一致）+ 菜单按钮 + 页脚槽位。
  const element = (name, attributes = {}) => {
    const node = document.createElement(name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  };
  const headerNode = element('header', { class: 'site-header' });
  const inner = element('div', { class: 'header-inner' });
  const desktop = element('nav', { class: 'desktop-nav', 'aria-label': '主导航', 'data-nav': 'desktop' });
  const actions = element('div', { class: 'header-actions' });
  const toggle = element('button', { 'data-menu-toggle': '', 'aria-expanded': 'false' });
  const mobile = element('nav', { id: 'mobile-nav', class: 'mobile-nav', 'aria-label': '手机导航', 'data-nav': 'mobile' });
  mobile.hidden = true;
  actions.append(toggle);
  inner.append(element('a', { class: 'brand' }), desktop, actions, mobile);
  headerNode.append(inner);
  document.body.append(headerNode);

  const footerNode = element('footer', { class: 'site-footer' });
  footerNode.append(element('div', { 'data-nav': 'footer-bottom' }));
  document.body.append(footerNode);

  const api = runBase(baseSource, document);
  return { api, document, toggle, mobile, footer: footerNode };
}

// 取出 data-nav="<slot>" 槽位内部的 HTML（按标签配对，不是碰到第一个闭合标签就停）。
function slotContent(html, slot) {
  const opening = new RegExp(`<([\\w-]+)[^>]*data-nav="${slot}"[^>]*>`).exec(html);
  assert.ok(opening, `页面里应该有 data-nav="${slot}" 槽位`);
  const tag = opening[1];
  const pattern = new RegExp(`<${tag}\\b[^>]*?/>|<${tag}\\b[^>]*>|</${tag}\\s*>`, 'g');
  pattern.lastIndex = opening.index;
  let depth = 0;
  let match;
  while ((match = pattern.exec(html))) {
    // <input /> 这类自闭合标签不进栈，否则深度永远回不到 0。
    if (match[0].endsWith('/>')) continue;
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(opening.index + opening[0].length, match.index);
  }
  throw new Error(`data-nav="${slot}" 槽位没有闭合`);
}

// 槽位既有 header 里的（nav），也有 footer 里的（footer-bottom），两处都找。
function pageSlotHtml(active, slot, attributes) {
  const tag = slot === 'desktop' || slot === 'mobile' ? 'nav' : 'div';
  const inner = slotContent(header(active) + footer(active), slot);
  return canonical(parse(`<${tag}${attributes}>${inner}</${tag}>`).children[0]);
}

function slotOf(document, name) {
  const slot = document.querySelector(`[data-nav="${name}"]`);
  assert.ok(slot, `base.js 应该渲染 data-nav="${name}" 槽位`);
  return slot;
}

function renderedSlot(document, name) {
  return canonical(parse(slotOf(document, name).outerHTML).children[0]);
}

// --- 数据与渲染结果必须和构建期输出一致 ---

test('base.js 暴露统一渲染入口', () => {
  const { api } = loadBase();
  assert.ok(api, 'window.NanoCampBase 应该存在');
  assert.deepEqual(Object.keys(api.nav).sort(), ['desktop', 'footer', 'footer-bottom', 'mobile']);
  assert.equal(typeof api.mount, 'function');
  assert.equal(typeof api.backToTop, 'function');
  assert.equal(api.links.length, 10);
});

test('构建期输出与 base.js 的渲染逐节点一致', () => {
  assert.equal(canonical(parse('<span class="x"></span>')), '<#root><span class="x"></span></#root>', '规范化函数自身应可用');
  const attributes = {
    desktop: ' aria-label="主导航" class="desktop-nav" data-nav="desktop"',
    mobile: ' aria-label="手机导航" class="mobile-nav" data-nav="mobile" hidden id="mobile-nav"',
    'footer-bottom': ' data-nav="footer-bottom"'
  };
  for (const active of ['', 'home', 'minicamp', 'projects', 'community', 'resources', 'search']) {
    for (const slot of ['desktop', 'mobile', 'footer-bottom']) {
      assert.equal(
        pageSlotHtml(active, slot, attributes[slot]),
        renderedSlot(loadBase({ page: active }).document, slot),
        `data-page="${active}" 的 ${slot}：构建期输出应与 base.js 渲染一致`
      );
    }
  }
});

test('桌面导航：首页在最左侧，合作与搜索直接可达', () => {
  const { document } = loadBase({ page: 'projects' });
  const links = slotOf(document, 'desktop').children;
  assert.deepEqual(links.map(node => node.getAttribute('href')), [
    '/', '/minicamp/', '/activities/', '/projects/', '/community/', '/partners/', '/search/'
  ]);
  assert.equal(findFirst(document.body, '.nav-more'), null);
  assert.equal(links[0].text, '首页');
  assert.equal(links[5].text, '交流合作');
  assert.equal(links[3].getAttribute('aria-current'), 'page');
  assert.equal(links[0].getAttribute('aria-current'), null);
});

test('手机导航：与桌面相同的 7 项，搜索保留图标与快捷键钩子', () => {
  const { document } = loadBase({ page: 'search' });
  const links = slotOf(document, 'mobile').children;
  assert.equal(links.length, 7);
  const search = links[6];
  assert.equal(search.text, '');
  assert.equal(search.getAttribute('class'), 'nav-search');
  assert.equal(search.getAttribute('aria-label'), '站内搜索');
  assert.equal(search.getAttribute('data-search-shortcut'), '');
  assert.equal(search.getAttribute('aria-current'), 'page');
  assert.deepEqual(search.children.map(node => node.nodeName), ['svg', 'span']);
  assert.equal(search.children[1].text, '站内搜索');
});

test('data-page 决定当前项，未知页面不高亮任何链接', () => {
  const marked = page => loadBase({ page })
    .document.querySelector('[data-nav="desktop"]').children
    .map(node => node.getAttribute('aria-current'))
    .filter(Boolean).length;
  assert.equal(marked('projects'), 1);
  assert.equal(marked('home'), 1);
  assert.equal(marked('missing'), 0);
});

test('mount 替换槽位内原有的构建期内容', () => {
  const { api, document } = loadBase({ page: 'activities' });
  const slot = slotOf(document, 'desktop');
  slot.replaceChildren(new FakeNode('a'));
  api.mount();
  assert.deepEqual(
    slot.children.map(node => node.getAttribute('href')),
    ['/', '/minicamp/', '/activities/', '/projects/', '/community/', '/partners/', '/search/']
  );
  assert.equal(slot.children[2].getAttribute('aria-current'), 'page');
});

test('页脚底部只有署名：没有动效开关、分享按钮或分享状态区', () => {
  const standard = loadBase({ page: 'projects' }).document.querySelector('[data-nav="footer-bottom"]');
  const bottom = standard.children[0];
  assert.equal(bottom.getAttribute('class'), 'footer-bottom');
  assert.equal(bottom.children.length, 1, '页脚底部只应有署名');
  const signoff = canonical(parse(bottom.children[0].serialize()).children[0]);
  assert.match(signoff, /class="footer-signoff"/);
  assert.match(signoff, /一个属于学生创造者的社区。/);
  for (const selector of ['[data-site-motion-toggle]', '.motion-levels', '[data-share-page]', '.share-status', '.share-fallback']) {
    assert.equal(findFirst(standard, selector), null, `页脚底部不应再有 ${selector}`);
  }

  const minicamp = loadBase({ page: 'minicamp' }).document.querySelector('[data-nav="footer-bottom"]');
  const minicampBottom = minicamp.children[0];
  assert.equal(minicampBottom.children.length, 1, 'minicamp 页脚底部同样只有署名');
  assert.equal(findFirst(minicampBottom, '.footer-signoff-copy').children.length, 2);
});

test('页脚导航渲染器已就绪，但页脚顶部仍由构建期输出', () => {
  const { api, document } = loadBase({ page: 'about' });
  assert.deepEqual(
    api.nav.footer().children.map(node => node.getAttribute('href')),
    ['/minicamp/', '/activities/', '/projects/', '/resources/', '/community/', '/partners/', '/about/', '/search/', '/faq/']
  );
  assert.equal(findFirst(document.body, '[data-nav="footer"]'), null);
});

test('回到顶部浮窗：由 base.js 生成，minicamp 与社区页不生成', () => {
  const { footer: footerNode } = loadBase({ page: 'projects' });
  const button = footerNode.children.find(node => node.getAttribute && node.getAttribute('data-back-to-top') !== null);
  assert.ok(button, '普通页面应该生成回到顶部浮窗');
  assert.equal(button.getAttribute('class'), 'back-to-top');
  assert.equal(button.getAttribute('aria-label'), '回到顶部');
  assert.equal(button.hidden, true, '初始应隐藏，滚动后再显示');
  assert.equal(button.getAttribute('data-visible'), null);
  assert.equal(button.children[0].text, '↑');

  for (const page of ['minicamp', 'community']) {
    const { footer: node } = loadBase({ page });
    assert.equal(node.querySelector('[data-back-to-top]'), null, `${page} 页不应有回到顶部浮窗`);
  }
});
