import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { header } from '../src/components.mjs';
import { createDocument, parse, canonical, runBase, FakeNode } from './helpers/fake-dom.mjs';

const baseSource = readFileSync(new URL('../public/base.js', import.meta.url), 'utf8');

function loadBase({ page = '' } = {}) {
  const document = createDocument();
  if (page) document.body.setAttribute('data-page', page);

  // 复刻 components.mjs 的 header 结构：nav 槽位（属性也与模板一致）+ 菜单按钮。
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

  const api = runBase(baseSource, document);
  return { api, document, toggle, mobile };
}

function headerSlot(active, slot, attributes) {
  const pattern = new RegExp(`<nav[^>]*data-nav="${slot}"[^>]*>([\\s\\S]*?)</nav>`);
  const match = pattern.exec(header(active));
  assert.ok(match, `header("${active}") 里应该有 data-nav="${slot}" 槽位`);
  return canonical(parse(`<nav${attributes}>${match[1]}</nav>`).children[0]);
}

function slotOf(document, name) {
  const slot = document.querySelector(`[data-nav="${name}"]`);
  assert.ok(slot, `base.js 应该渲染 data-nav="${name}" 槽位`);
  return slot;
}

function renderedSlot(document, name) {
  return canonical(parse(slotOf(document, name).serialize()).children[0]);
}

// --- 数据与渲染结果必须和构建期输出一致 ---

test('base.js 暴露统一渲染入口', () => {
  const { api } = loadBase();
  assert.ok(api, 'window.NanoCampBase 应该存在');
  assert.deepEqual(Object.keys(api.nav).sort(), ['desktop', 'footer', 'mobile']);
  assert.equal(typeof api.mount, 'function');
  assert.equal(api.links.length, 9);
});

test('构建期 nav 与 base.js 的渲染逐节点一致', () => {
  assert.equal(canonical(parse('<span class="x"></span>')), '<#root><span class="x"></span></#root>', '规范化函数自身应可用');
  const attributes = {
    desktop: ' aria-label="主导航" class="desktop-nav" data-nav="desktop"',
    mobile: ' aria-label="手机导航" class="mobile-nav" data-nav="mobile" hidden id="mobile-nav"'
  };
  for (const active of ['', 'minicamp', 'projects', 'resources', 'search']) {
    for (const slot of ['desktop', 'mobile']) {
      assert.equal(
        headerSlot(active, slot, attributes[slot]),
        renderedSlot(loadBase({ page: active }).document, slot),
        `data-page="${active}" 的 ${slot} 导航：构建期输出应与 base.js 渲染一致`
      );
    }
  }
});

test('桌面导航：4 个常显项 + 原生 details「更多」', () => {
  const { document } = loadBase({ page: 'projects' });
  const links = slotOf(document, 'desktop').children;
  assert.deepEqual(links.map(node => node.getAttribute('href')), [
    '/minicamp/', '/activities/', '/projects/', '/community/', null
  ]);
  const details = links[4];
  assert.equal(details.nodeName, 'details');
  assert.equal(details.getAttribute('class'), 'nav-more');
  const panel = details.children[1];
  assert.equal(panel.getAttribute('class'), 'nav-more-panel');
  assert.deepEqual(panel.children.map(node => node.text), ['共创资源', '交流合作', '关于社区', '']);
  assert.equal(links[2].getAttribute('aria-current'), 'page');
  assert.equal(links[0].getAttribute('aria-current'), null);
});

test('手机导航：全部 8 项，搜索项带图标与快捷键钩子', () => {
  const { document } = loadBase({ page: 'search' });
  const links = slotOf(document, 'mobile').children;
  assert.equal(links.length, 8);
  const search = links[7];
  assert.equal(search.text, '');
  assert.equal(search.getAttribute('class'), 'nav-search');
  assert.equal(search.getAttribute('aria-label'), '站内搜索');
  assert.equal(search.getAttribute('data-search-shortcut'), '');
  assert.equal(search.getAttribute('aria-current'), 'page');
  assert.deepEqual(search.children.map(node => node.nodeName), ['svg', 'span']);
  assert.equal(search.children[1].text, '搜索');
});

test('data-page 决定当前项，未知页面不高亮任何链接', () => {
  const marked = page => loadBase({ page })
    .document.querySelector('[data-nav="desktop"]').children
    .map(node => node.getAttribute('aria-current'))
    .filter(Boolean).length;
  assert.equal(marked('projects'), 1);
  assert.equal(marked('home'), 0);
  assert.equal(marked('missing'), 0);
});

test('mount 替换槽位内原有的构建期内容', () => {
  const { api, document } = loadBase({ page: 'activities' });
  const slot = slotOf(document, 'desktop');
  slot.replaceChildren(new FakeNode('a'));
  api.mount();
  assert.deepEqual(
    slot.children.map(node => node.getAttribute('href')),
    ['/minicamp/', '/activities/', '/projects/', '/community/', null]
  );
  assert.equal(slot.children[1].getAttribute('aria-current'), 'page');
});

test('页脚渲染器已就绪，但暂未接管页脚槽位', () => {
  const { api, document } = loadBase({ page: 'about' });
  assert.deepEqual(
    api.nav.footer().children.map(node => node.getAttribute('href')),
    ['/minicamp/', '/activities/', '/projects/', '/resources/', '/community/', '/partners/', '/about/', '/search/', '/faq/']
  );
  assert.equal(document.querySelector('[data-nav="footer"]'), null);
});
