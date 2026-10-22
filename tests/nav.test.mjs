import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { header, footer } from '../src/components.mjs';
import { createDocument, createWindow, parse, runBase, toFakeNodes, canonical, findFirst } from './helpers/fake-dom.mjs';

// base.js 现在只做交互。这个文件盯两件事：
//   1. 导航只有服务端一次渲染 —— base.js 跑完后 nav 的 DOM 必须一个字节都没变；
//   2. 别把「第二份导航数据 / 渲染器」加回来（那是刚删掉的那套）。
const baseSource = readFileSync(new URL('../public/base.js', import.meta.url), 'utf8');

function loadBase({ page = '' } = {}) {
  const document = createDocument();
  document.body.setAttribute('data-page', page);
  document.body.append(toFakeNodes(parse(header(page) + footer(page)), document));
  const window = createWindow(document);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = runBase(baseSource, document, window);
  return { api, document, window };
}

const slotOf = (document, name) => {
  const slot = findFirst(document.body, `[data-nav="${name}"]`);
  assert.ok(slot, `页面里应该有 data-nav="${name}" 槽位`);
  return slot;
};

const slotHtml = (document, name) => canonical(parse(slotOf(document, name).serialize()).children[0]);

test('base.js 只挂交互：接口里没有导航渲染器', () => {
  const { api } = loadBase({ page: 'projects' });
  assert.deepEqual(Object.keys(api).sort(), ['active', 'backToTop', 'mount']);
  assert.equal(typeof api.mount, 'function');
  assert.equal(typeof api.backToTop, 'function');
  assert.equal(typeof api.active, 'function');
});

test('导航没有第二份数据源：base.js 里不该再有链接表或渲染器', () => {
  // 注释里提到这些名字是解释「删掉了什么」，所以要先去注释再查。
  const code = baseSource.replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['NAV_LINKS', 'nav-destination', 'nav-search-label', 'replaceChildren', 'createElementNS']) {
    assert.equal(code.includes(forbidden), false, `base.js 里不该再出现 ${forbidden}（导航只在服务端渲染一次）`);
  }
});

test('mount 不改动服务端渲染好的导航：节点、结构都不变', () => {
  const { api, document } = loadBase({ page: 'projects' });
  const slots = ['desktop', 'mobile', 'footer-bottom'];
  const before = slots.map(name => ({ name, html: slotHtml(document, name), first: slotOf(document, name).children[0] }));

  api.mount();
  api.mount();

  for (const { name, html, first } of before) {
    assert.equal(slotHtml(document, name), html, `${name} 槽位的 HTML 被客户端改动了`);
    assert.equal(slotOf(document, name).children[0], first, `${name} 槽位里的节点被替换了（不该重建）`);
  }
});

test('高亮由服务端给的 aria-current 决定，桌面与手机各标一次', () => {
  const { document } = loadBase({ page: 'projects' });
  const marked = document.querySelectorAll('[aria-current="page"]');
  assert.equal(marked.length, 2);
  assert.ok(marked.every(node => node.getAttribute('href') === '/projects/'));
});

test('data-page 决定 active()：首页缺省为 home', () => {
  assert.equal(loadBase({ page: 'projects' }).api.active(), 'projects');
  assert.equal(loadBase({ page: 'minicamp' }).api.active(), 'minicamp');
  assert.equal(loadBase({ page: '' }).api.active(), 'home');
});

test('页脚底部保持空白：base.js 不再往槽位里渲染', () => {
  const { api, document } = loadBase({ page: 'projects' });
  const slot = slotOf(document, 'footer-bottom');
  assert.equal(slot.children.length, 1, '服务端给的是一个空容器');
  assert.equal(slot.children[0].getAttribute('class'), 'footer-bottom');
  assert.equal(slot.children[0].children.length, 0);
  api.mount();
  assert.equal(slot.children.length, 1, 'mount 之后仍然只有一个空容器');
  assert.equal(slot.children[0].children.length, 0, '页脚底部应留空');
});

test('回到顶部浮窗：由 base.js 生成，minicamp 与社区页不生成', () => {
  const { document: page } = loadBase({ page: 'projects' });
  const button = findFirst(page.body, '[data-back-to-top]');
  assert.ok(button, '普通页面应该生成回到顶部浮窗');
  assert.equal(button.getAttribute('class'), 'back-to-top');
  assert.equal(button.getAttribute('aria-label'), '回到顶部');
  assert.equal(button.hidden, true, '初始应隐藏，滚动后再显示');
  assert.equal(button.getAttribute('data-visible'), null);
  assert.equal(button.children[0].text, '↑');

  for (const name of ['minicamp', 'community']) {
    const { document } = loadBase({ page: name });
    assert.equal(findFirst(document.body, '[data-back-to-top]'), null, `${name} 页不应有回到顶部浮窗`);
  }
});
