import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { handleRequest } from '../backend/app.mjs';
import { routePaths } from '../src/pages.mjs';
import { createDocument, parse, canonical, runBase, toFakeNodes, findFirst } from './helpers/fake-dom.mjs';

// 这个文件测的是「站点呈现给用户的 HTML」的导航结构。
// 以前它读 dist/ 的构建产物；dist 已被去掉，现在全部走请求期渲染（backend/app.mjs）。
const root = fileURLToPath(new URL('../', import.meta.url));
const baseSource = readFileSync(path.join(root, 'public/base.js'), 'utf8');

// /intro/ 是首页 iframe 嵌入的纯海报页：自带 noindex，没有站点页头、页脚与 base.js，
// 所以不参与下面这些「导航骨架」断言。它也不在 routePaths 里。
const specialPages = new Set(['/intro/']);
const served = new Map();
for (const route of routePaths) {
  const response = await handleRequest({method: 'GET', url: route, headers: {}});
  assert.equal(response.status, 200, route + ' 应当返回 200');
  served.set(route, response.body.toString('utf8'));
}
for (const route of specialPages) {
  const response = await handleRequest({method: 'GET', url: route, headers: {}});
  assert.equal(response.status, 200, route + ' 应当返回 200');
  served.set(route, response.body.toString('utf8'));
}
const html = route => {
  const value = served.get(route);
  assert.ok(value, route + ' 不在已渲染路由里，这个用例的前提不成立');
  return value;
};
const routeList = [...served.keys()].filter(route => !specialPages.has(route));

test('准备：已迁移的路由都能渲染出导航', () => {
  assert.ok(routeList.length > 0, '至少应该有一个已迁移路由');
  for (const route of routeList) assert.match(html(route), /site-header/, route + ' 应当有站点页头');
});

// 把渲染结果的 <header> 与 <footer> 放进最小 DOM，再执行 base.js。
// 判据是「HTML 里就位、跑完 base.js 之后一个字节都没变」——
// 导航只剩服务端这一次渲染，客户端任何改动都算回退。
function hydrate(source) {
  const headerHTML = /<a class="skip-link"[\s\S]*?<\/header>/.exec(source)?.[0];
  assert.ok(headerHTML, '渲染结果里应该有 site-header');
  const footerHTML = /<footer[\s\S]*?<\/footer>/.exec(source)?.[0];
  assert.ok(footerHTML, '渲染结果里应该有 footer');
  const page = /<body[^>]*\sdata-page="([^"]*)"/.exec(source)?.[1] || '';
  const document = createDocument();
  document.body.setAttribute('data-page', page);
  document.body.append(toFakeNodes(parse(headerHTML + footerHTML), document));
  return { document, page };
}

test('导航在 HTML 里就位，base.js 跑起来后不再重建它', () => {
  for (const route of ['/', '/minicamp/', '/community/', '/resources/', '/about/']) {
    const { document } = hydrate(html(route));
    const slots = ['desktop', 'mobile'].map(name => {
      const slot = findFirst(document.body, `[data-nav="${name}"]`);
      assert.ok(slot, `${route} 应该有 data-nav="${name}" 槽位`);
      assert.ok(slot.children.length > 0, `${route} 的 ${name} 导航应该是渲染好的，而不是空槽位`);
      return { name, slot, html: canonical(parse(slot.serialize()).children[0]) };
    });

    runBase(baseSource, document);

    for (const { name, slot, html: expected } of slots) {
      assert.equal(
        canonical(parse(slot.serialize()).children[0]),
        expected,
        `${route} 的 ${name} 导航在 base.js 跑完后被改动了`
      );
    }
    // 页脚里还有一个 nav（页脚导航），所以只数 <header> 里的。
    const siteHeader = findFirst(document.body, '.site-header');
    assert.equal(siteHeader.querySelectorAll('nav').length, 2, `${route} 应该只有桌面与手机两个 nav`);
    assert.equal(document.body.querySelectorAll('[data-nav="desktop"]').length, 1, `${route} 不应出现第二份桌面导航`);
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
    // 搜索页没有共用加入区，页脚也与其它页面不同，这两项对它单独放宽。
    assert.equal((source.match(/id="join-heading"/g) || []).length, route === '/search/' ? 0 : 1, `${route} 的共用加入区应只出现一次，搜索页除外`);
    if (route !== '/search/')
      assert.equal(footer, reference, `${route} 应使用 minicamp 同款页脚`);
    assert.ok(slot, `${route} 应该有页脚底部槽位`);
    assert.match(footer, /Meet\. Build\./, `${route} 的页脚内容应写死在 HTML 里`);
    assert.equal(footer.includes('footer-signoff'), false, `${route} 的页脚署名块应已移除`);
  }
});

test('页脚底部在 HTML 里就是空的，base.js 只补浮窗、不往里放东西', () => {
  for (const route of ['/minicamp/', '/about/']) {
    const { document } = hydrate(html(route));
    const slot = findFirst(document.body, '[data-nav="footer-bottom"]');
    assert.ok(slot, `${route} 应该有页脚底部槽位`);
    const before = canonical(parse(slot.outerHTML).children[0]);
    assert.ok(slot.children.length > 0, `${route} 的页脚底部应该是渲染好的空容器，而不是空槽位`);
    assert.equal(slot.children[0].children.length, 0, `${route} 的页脚底部应留空`);

    runBase(baseSource, document);
    assert.equal(canonical(parse(slot.outerHTML).children[0]), before, `${route} 页脚底部不该被客户端改动`);

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
