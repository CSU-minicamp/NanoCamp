import test from 'node:test';
import assert from 'node:assert/strict';

import {indexablePaths, noindexPaths, routePaths} from '../src/pages.mjs';
import {dynamicIndexable, isIndexable, isNoindex} from '../src/seo.mjs';

// 收录规则是**白名单**：不在这里点名的地址一律 noindex。
// 这些断言的意义是「新增页面忘了想清楚」时能立刻炸掉，而不是等搜索引擎抓进去。

test('白名单只有三种动态形态：论坛列表、帖子详情、作者页', () => {
  for(const route of ['/forum/', '/forum/topics/24/', '/forum/users/195/'])
    assert.equal(isIndexable(route), true, route + ' 应当可收录');
  assert.equal(dynamicIndexable.length, 3);
});

test('其余动态页一律默认 noindex', () => {
  const shouldNotIndex = [
    '/forum/messages/', '/forum/messages/conversations/12/', '/forum/messages/new/',
    '/forum/new/', '/forum/me/', '/forum/notifications/',
    '/forum/topics/24/edit/', '/forum/topics/0195/', '/forum/users/0195/',
    '/forum/members/', '/forum/mentions/',   // 子串误伤的老写法会漏掉这类地址
    '/profile/', '/profile/force/', '/user/195/'
  ];
  for(const route of shouldNotIndex)
    assert.equal(isNoindex(route), true, route + ' 不该被收录');
});

test('静态页的结论与 pages.mjs 的声明完全一致', () => {
  for(const route of routePaths)
    assert.equal(isIndexable(route), indexablePaths.includes(route), route);
  assert.ok(noindexPaths.length > 0, '至少有登录页一类的 noindex 页');
});
