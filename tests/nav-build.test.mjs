import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { handleRequest, routeInfo } from '../backend/app.mjs';
import { createDocument, parse, canonical, runBase, toFakeNodes, findFirst } from './helpers/fake-dom.mjs';

// 这个文件测的是「站点呈现给用户的 HTML」的导航结构。
// 以前它读 dist/ 的构建产物；dist 正在被去掉，测试改成只走请求期渲染（backend/app.mjs），
// 不再依赖任何构建产物。因此下面只覆盖「已经迁移到请求期渲染」的路由 ——
// 还没迁移的路由由 handleRequest 返回 404，不在这里断言。
const root = fileURLToPath(new URL('../', import.meta.url));
const baseSource = readFileSync(path.join(root, 'public/base.js'), 'utf8');

const served = new Map();
for (const route of routeInfo.migrated) {
  const response = await handleRequest({method: 'GET', url: route, headers: {}});
  assert.equal(response.status, 200, route + ' 已迁移，应当返回 200');
  served.set(route, response.body.toString('utf8'));
}
const html = route => {
  const value = served.get(route);
  assert.ok(value, route + ' 不在已迁移路由里，这个用例的前提不成立');
  return value;
};
// /intro/ 是首页 iframe 嵌入的纯海报页：自带 noindex，没有站点页头、页脚与 base.js，
// 所以不参与下面这些「导航骨架」断言。
const specialPages = new Set(['/intro/']);
const routeList = [...served.keys()].filter(route => !specialPages.has(route));

test('准备：已迁移的路由都能渲染出导航', () => {
  assert.ok(routeList.length > 0, '至少应该有一个已迁移路由');
  for (const route of routeList) assert.match(html(route), /site-header/, route + ' 应当有站点页头');
});

// 把渲染结果的 <header> 放进最小 DOM，再执行 base.js，
// 验证「替换」在原节点上原地发生，且替换前后结构完全一致（不会造成视觉跳动）。
function hydrateHeader(source, slotNames) {
  const headerHTML = /<a class="skip-link"[\s\S]*?<\/header>/.exec(source)?.[0];
  assert.ok(headerHTML, '渲染结果里应该有 site-header');
  const page = /<body[^>]*\sdata-page="([^"]*)"/.exec(source)?.[1] || '';
  const document = createDocument();
  document.body.setAttribute('data-page', page);
  document.body.append(toFakeNodes(parse(headerHTML), document));

  const before = slotNames.map(name => {
    const slot = findFirst(document.body, `[data-nav="${name}"]`);
    assert.ok(slot, `渲染结果里应该有 data-nav="${name}" 槽位`);
    return { slot, html: canonical(parse(slot.serialize()).children[0]) };
  });
  assert.ok(before.every(item => item.slot.children.length > 0), '渲染出的 nav 应该是完整的，而不是空槽位');

  const api = runBase(baseSource, document);
  return { before, api, document, page };
}

test('用渲染结果替换导航：结构不变，且不产生重复节点', () => {
  for (const route of ['/', '/minicamp/', '/community/', '/resources/', '/about/']) {
    const { before, document } = hydrateHeader(html(route), ['desktop', 'mobile']);
    for (const { slot, html: expected } of before) {
      assert.equal(
        canonical(parse(slot.serialize()).children[0]),
        expected,
        `${route} 的 ${slot.getAttribute('data-nav')} 导航在 base.js 接管后应与渲染期一致`
      );
    }
    const navs = document.body.querySelectorAll('nav');
    assert.equal(navs.length, 2, `${route} 应该只有桌面与手机两个 nav`);
    assert.equal(document.body.querySelectorAll('[data-nav="desktop"]').length, 1, `${route} 不应重复渲染桌面导航`);
  }
});

test('当前项标记与页面一致（无 JS 也正确）', () => {
  const cases = [
    ['/', '/', 2],
    ['/about/', '/about/', 0],
    ['/partners/', '/partners/', 2],
    ['/resources/from-idea-to-demo/', '/resources/', 0],
  ];
  for (const [route, expectedHref, expectedCount] of cases) {
    const marked = [...html(route).matchAll(/<a href="([^"]+)" aria-current="page"/g)].map(match => match[1]);
    // 桌面与手机两个 nav 各标记一次，且都指向该页所属的导航项。
    assert.deepEqual(marked, Array(expectedCount).fill(expectedHref), `${route} 的当前项标记不正确`);
  }
});

test('每个已迁移页面都引入了 base.js（先于 app.js）', () => {
  for (const route of routeList) {
    const source = html(route);
    const base = source.indexOf('<script defer src="/base.js"></script>');
    const app = source.indexOf('<script defer src="/app.js"></script>');
    assert.ok(base > -1, `${route} 缺少 base.js`);
    assert.ok(app > base, `${route} 里 base.js 应在 app.js 之前加载`);
  }
});

test('页脚与浮窗：HTML 无按钮残留，浮窗由 base.js 生成', () => {
  const reference = /<footer[\s\S]*?<\/footer>/.exec(html('/minicamp/'))[0];
  for (const route of routeList) {
    const source = html(route);
    const footer = /<footer[\s\S]*?<\/footer>/.exec(source)[0];
    for (const forbidden of ['footer-tools', 'data-back-to-top', '回到顶部', 'data-site-motion-toggle', 'motion-levels']) {
      assert.equal(footer.includes(forbidden), false, `${route} 的页脚残留了已移除的 ${forbidden}`);
    }
    const slot = /<div data-nav="footer-bottom">/.test(source);
    assert.equal((source.match(/id="join-heading"/g) || []).length, 1, `${route} 的共用加入区应只出现一次（/search/ 例外，但它还没迁移）`);
    assert.equal(footer, reference, `${route} 应使用 minicamp 同款页脚`);
    assert.ok(slot, `${route} 应该有页脚底部槽位`);
    assert.match(footer, /一个属于学生创造者的社区。/, `${route} 的署名应写死在 HTML 里`);
  }
});

test('base.js 接管页脚底部：HTML 与客户端渲染一致，并补上浮窗', () => {
  for (const route of ['/minicamp/', '/about/']) {
    const source = html(route);
    const page = /<body[^>]*\sdata-page="([^"]*)"/.exec(source)?.[1] || '';
    const footerHTML = /<footer[\s\S]*?<\/footer>/.exec(source)?.[0];
    assert.ok(footerHTML, `${route} 渲染结果里应该有 footer`);

    const document = createDocument();
    document.body.setAttribute('data-page', page);
    document.body.append(toFakeNodes(parse(footerHTML), document));
    const slot = findFirst(document.body, '[data-nav="footer-bottom"]');
    const before = canonical(parse(slot.outerHTML).children[0]);
    assert.ok(slot.children.length > 0, `${route} 的页脚底部应该是渲染好的，而不是空槽位`);

    runBase(baseSource, document);
    assert.equal(canonical(parse(slot.outerHTML).children[0]), before, `${route} 页脚底部替换后结构应完全一致`);

    const fab = findFirst(document.body, '[data-back-to-top]');
    if (route === '/minicamp/') assert.equal(fab, null, 'minicamp 页不应生成浮窗');
    else assert.ok(fab, `${route} 应由 base.js 生成回到顶部浮窗`);
  }
});

test('侧边栏分享按钮仍然可用（页脚按钮已移除，触发点只在侧边栏）', () => {
  const withShare = html('/resources/from-idea-to-demo/');
  assert.equal((withShare.match(/data-share-page/g) || []).length, 1, '指南页应保留一个侧边栏分享按钮');
  assert.ok(withShare.includes('data-share-status') && withShare.includes('data-share-fallback'), '指南页应保留分享状态区与兜底输入');
  for (const route of ['/', '/activities/', '/minicamp/', '/community/']) {
    assert.equal(html(route).includes('data-share-page'), false, `${route} 不应有页面级分享按钮`);
  }
});

test('base.css 被引入，且排在皮肤文件之前', () => {
  for (const route of routeList) {
    const source = html(route);
    const base = source.indexOf('href="/base.css"');
    assert.ok(base > -1, `${route} 缺少 base.css`);
    assert.ok(source.indexOf('href="/styles.css"') < base, `${route} 里 base.css 应在 styles.css 之后`);
    for (const later of ['/details.css', '/discovery.css', '/collage.css']) {
      assert.ok(source.indexOf(`href="${later}"`) > base, `${route} 里 base.css 应在 ${later} 之前`);
    }
  }
});
