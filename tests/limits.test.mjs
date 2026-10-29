import test, {after} from 'node:test';
import assert from 'node:assert/strict';

import {handleRequest} from '../backend/app.mjs';
import {isId, idOf, isStaff, memberType, pageOf} from '../backend/forum/base.mjs';
import {closePool} from '../backend/db.mjs';
import {renderProfileForce} from '../src/profile.mjs';
import {NICKNAME_FORBIDDEN_SOURCE, nicknameForbidden} from '../common/nickname.mjs';

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

test('pageOf 只判形状：不钳位，也没有「最大页数」', () => {
  assert.equal(pageOf(undefined), 1, '没给参数');
  assert.equal(pageOf(''), 1, '空串');
  assert.equal(pageOf(1), 1, '数字类型也认');
  assert.equal(pageOf('1'), 1);
  // 以前这里卡在 MAX_PAGE=500；上限删掉后，大页码只是「不存在的页」，由 ensurePage 判 404。
  assert.equal(pageOf('501'), 501);
  assert.equal(pageOf('999999'), 999999);
  // 剩下的是形状：不是页码的东西，以及位数多到 (page-1)*每页 会越过安全整数。
  for(const bad of ['0', '-1', 'abc', '1.5', '0195', '1e3', ' 1', '1234567890'])
    assert.throws(() => pageOf(bad), error => error.code === 'not_found', bad);
});

test('身份行只看 expired_at：NULL 是永久，过期就当没这一行', () => {
  assert.equal(memberType(null), 'member', '没有行 = 完全普通的成员');
  assert.equal(memberType({type: 'ban', expired_at: null}), 'ban', '永久禁言');
  assert.equal(memberType({type: 'ban', expired_at: new Date(Date.now() - 1000)}), 'member', '禁言已到期');
  assert.equal(memberType({type: 'moderator', expired_at: new Date(Date.now() + 60000)}), 'moderator', '版务在任');
  assert.equal(memberType({type: 'moderator', expired_at: new Date(Date.now() - 1000)}), 'member', '版务已卸任');
  assert.equal(memberType({type: 'mute', expired_at: null}), 'mute', '永久禁言');
  assert.equal(isStaff({type: 'admin', expired_at: null}), true);
  assert.equal(isStaff({type: 'ban', expired_at: null}), false, '被封的人不算版务');
  assert.equal(isStaff({type: 'mute', expired_at: null}), false, '禁言的人不算版务');
  assert.equal(isStaff({type: 'moderator', expired_at: new Date(Date.now() - 1000)}), false, '过期的版务不算版务');
});

test('昵称禁用字符集只有一份：后端判定与浏览器端重建等价', () => {
  // 后端用 nicknameForbidden()，浏览器端只拿到 source（模板渲染进 data-nickname-forbidden）。
  for(const bad of ['林/知远', 'a\\b', 'a\u0000b', 'a\u200bb', 'a\u202eb', 'a\u2028b', 'a\ufeffb'])
    assert.equal(nicknameForbidden(bad), true, JSON.stringify(bad));
  for(const good of ['林知远', 'test', 'emoji🙂', 'a b', '名字·带点'])
    assert.equal(nicknameForbidden(good), false, good);
  const rebuilt = new RegExp(NICKNAME_FORBIDDEN_SOURCE, 'u');
  assert.equal(rebuilt.source, NICKNAME_FORBIDDEN_SOURCE);
  assert.equal(rebuilt.test('a\u200bb'), true);
  assert.equal(rebuilt.test('林知远'), false);
});
test('首次资料页的昵称输入带同一份禁用规则（值来自 common/nickname.mjs）', () => {
  const html = renderProfileForce(['password', 'nickname'], {id: 1, nickname: '', bio: ''});
  assert.ok(html.includes(`data-nickname-forbidden="${NICKNAME_FORBIDDEN_SOURCE}"`), '属性值必须与 common 完全一致');
});
test('列表页的越界页码是 404，不返回最后一页', async () => {
  for(const url of ['/forum/?page=999', '/forum/?page=0', '/forum/?page=abc', '/forum/?page=999999999'])
    assert.equal((await get(url)).status, 404, url);
  assert.equal((await get('/forum/')).status, 200);
});
