import test, {after} from 'node:test';
import assert from 'node:assert/strict';

import {handleRequest} from '../backend/app.mjs';
import {isId, idOf, pageOf, MAX_PAGE} from '../backend/forum/base.mjs';
import {closePool} from '../backend/db.mjs';

// 这个文件会碰一次数据库（/forum/ 的 200 那条），跑完必须收池，否则进程不退出。
after(async () => { await closePool(); });

// 这些是「口径」类规则：不碰数据库，纯函数与路由层就能钉住。
const get = url => handleRequest({method: 'GET', url, headers: {}});

test('id 只有一种形状：1–15 位、不以 0 开头', () => {
  for(const good of ['1', '195', '999999999999999'])
    assert.equal(isId(good), true, good);
  for(const bad of ['0', '0195', '-1', '1.5', 'abc', '', '9999999999999999'])
    assert.equal(isId(bad), false, bad);
  assert.equal(idOf('195'), 195);
  for(const bad of ['0', '0195', '9999999999999999'])
    assert.throws(() => idOf(bad), error => error.code === 'not_found', bad);
});

test('/user/<编号>：前导零与超长编号都是 404，不是「同一个人的另一个地址」', async () => {
  for(const url of ['/user/0195/', '/user/0/', '/user/9999999999999999/'])
    assert.equal((await get(url)).status, 404, url);
  // 少斜杠仍然是 301，补完斜杠才判编号
  assert.equal((await get('/user/195')).status, 301);
});

test('pageOf 不钳位：缺省才是第 1 页，其余越界一律 404', () => {
  assert.equal(pageOf(undefined), 1, '没给参数');
  assert.equal(pageOf(''), 1, '空串');
  assert.equal(pageOf(1), 1, '数字类型也认');
  assert.equal(pageOf('1'), 1);
  assert.equal(pageOf(String(MAX_PAGE)), MAX_PAGE);
  for(const bad of ['0', '-1', 'abc', '1.5', '0195', '501', '999', '99999'])
    assert.throws(() => pageOf(bad), error => error.code === 'not_found', bad);
});

test('列表页的越界页码是 404，不再返回第 500 页', async () => {
  for(const url of ['/forum/?page=999', '/forum/?page=0', '/forum/?page=abc'])
    assert.equal((await get(url)).status, 404, url);
  assert.equal((await get('/forum/')).status, 200);
});
