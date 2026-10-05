import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { routePaths } from '../src/pages.mjs';
import { createDocument, parse, canonical, runBase, toFakeNodes, findFirst } from './helpers/fake-dom.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseSource = readFileSync(path.join(root, 'public/base.js'), 'utf8');
const dist = path.join(root, 'dist');

// 这些断言跑在真实构建产物上，先确认 dist 存在，避免报出难懂的 ENOENT。
test('准备：dist 已构建', () => {
  try {
    readFileSync(path.join(dist, 'index.html'));
  } catch {
    assert.fail('缺少 dist/index.html，请先执行 npm run build 再运行测试');
  }
});

// 把静态产物的 <header> 放进最小 DOM，再执行 base.js，
// 验证「替换」在原节点上原地发生，且替换前后结构完全一致（不会造成视觉跳动）。
function hydrateHeader(html, slotNames) {
  const headerHTML = /<a class="skip-link"[\s\S]*?<\/header>/.exec(html)?.[0];
  assert.ok(headerHTML, '构建产物里应该有 site-header');
  const page = /<body[^>]*\sdata-page="([^"]*)"/.exec(html)?.[1] || '';
  const document = createDocument();
  document.body.setAttribute('data-page', page);
  document.body.append(toFakeNodes(parse(headerHTML), document));

  const before = slotNames.map(name => {
    const slot = findFirst(document.body, `[data-nav="${name}"]`);
    assert.ok(slot, `构建产物里应该有 data-nav="${name}" 槽位`);
    return { slot, html: canonical(parse(slot.serialize()).children[0]) };
  });
  assert.ok(before.every(item => item.slot.children.length > 0), '构建期 nav 应该是渲染好的，而不是空槽位');

  const api = runBase(baseSource, document);
  return { before, api, document, page };
}

test('用构建产物替换导航：结构不变，且不产生重复节点', () => {
  for (const route of ['/', '/minicamp/', '/projects/', '/community/', '/resources/', '/search/']) {
    const file = path.join(dist, route, 'index.html');
    const html = readFileSync(file, 'utf8');
    const { before, document } = hydrateHeader(html, ['desktop', 'mobile']);
    for (const { slot, html: expected } of before) {
      assert.equal(
        canonical(parse(slot.serialize()).children[0]),
        expected,
        `${route} 的 ${slot.getAttribute('data-nav')} 导航在 base.js 接管后应与构建期一致`
      );
    }
    const navs = document.body.querySelectorAll('nav');
    assert.equal(navs.length, 2, `${route} 应该只有桌面与手机两个 nav`);
    assert.equal(document.body.querySelectorAll('[data-nav="desktop"]').length, 1, `${route} 不应重复渲染桌面导航`);
  }
});

test('构建产物的当前项与页面一致（无 JS 也正确）', () => {
  const cases = [
    ['/projects/', '/projects/', 2],
    ['/resources/from-idea-to-demo/', '/resources/', 2],
    ['/projects/memodot/', '/projects/', 2],
    ['/about/', '/about/', 2]
  ];
  for (const [route, expectedHref, expectedCount] of cases) {
    const html = readFileSync(path.join(dist, route, 'index.html'), 'utf8');
    const marked = [...html.matchAll(/<a href="([^"]+)" aria-current="page"/g)].map(match => match[1]);
    // 桌面与手机两个 nav 各标记一次，且都指向该页所属的导航项。
    assert.deepEqual(marked, Array(expectedCount).fill(expectedHref), `${route} 的静态 HTML 当前项标记不正确`);
  }
});

test('每个构建页面都引入了 base.js（先于 app.js）', () => {
  for (const route of routePaths) {
    const html = readFileSync(path.join(dist, route, 'index.html'), 'utf8');
    const base = html.indexOf('<script defer src="/base.js"></script>');
    const app = html.indexOf('<script defer src="/app.js"></script>');
    assert.ok(base > -1, `${route} 缺少 base.js`);
    assert.ok(app > base, `${route} 里 base.js 应在 app.js 之前加载`);
  }
});
