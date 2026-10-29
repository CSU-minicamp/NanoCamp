import {test} from 'node:test';
import assert from 'node:assert/strict';

import {select, closePool, dbReady} from '../backend/db.mjs';
import {migrateSchema} from '../backend/schema.mjs';

// 结构类断言：头像的引用与字节分别落在 users 与 avatar_blobs，且迁移可反复执行。
const columnsOf = async table => (await select('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table])).map(row => row.COLUMN_NAME);
const tableExists = async table => (await select('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]))[0].n === 1;

test('头像表结构：引用在 users、字节在 avatar_blobs，迁移幂等', {skip: !dbReady()}, async () => {
  // 跑两遍：第二遍不该报错，也不该重复加列。
  await migrateSchema();
  await migrateSchema();

  const userColumns = await columnsOf('users');
  for (const column of ['avatar_storage_driver', 'avatar_storage_key', 'avatar_etag'])
    assert.ok(userColumns.includes(column), `users 缺列 ${column}`);
  // 时间是对象属性，跟着字节走；users 上不该有它（上一版有过 avatar_updated_at，迁移要清掉）。
  assert.equal(userColumns.includes('avatar_updated_at'), false, 'users 不该再有 avatar_updated_at');

  const keys = (await select("SELECT INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='uniq_users_avatar'"))[0];
  assert.ok(keys, 'users 缺 uniq_users_avatar 索引');
  assert.equal(keys.NON_UNIQUE, 0, 'uniq_users_avatar 必须是唯一索引（同一对象不能两人引用）');

  const blobColumns = await columnsOf('avatar_blobs');
  for (const column of ['content_type', 'created_at'])
    assert.ok(blobColumns.includes(column), `avatar_blobs 缺 ${column}`);
  // 宽高是管线固定的常量，不再存库；类型与时间由对象自己带着。
  for (const column of ['byte_size', 'width', 'height'])
    assert.equal(blobColumns.includes(column), false, `avatar_blobs 不该再有 ${column}`);

  assert.equal(await tableExists('user_avatars'), false, 'user_avatars 迁移后应被删掉');
  await closePool();
});
