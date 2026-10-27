// 头像的业务：表结构 + 字节存储 + 图片处理（HTTP 边界在 ./routes.mjs）。
//
// 为什么这三件事合成一个文件：它们只有一起改才说得通 —— 换存储驱动要动表里的 storage_key、
// 换压缩参数要动 etag、换驱动还要对上 content-type。拆开时改一处总要翻另外两处。
// HTTP 则单独一层（照 forum/routes.mjs 的样子）：它只认状态码和头，不参与上面这些取舍，
// 也不需要知道 sharp 怎么压、字节存在哪儿。
//
// 读之前先记住四条：
//   1. **先写字节、再发布引用**：新图落盘成功后才更新 user_avatars，失败时旧头像还在；
//      旧字节要等事务提交之后才删，否则回滚了就只剩一条指向空对象的记录。
//   2. **对外地址只有一种** `/api/users/<id>/avatar`，它要么 302 到默认图、要么直接吐图片字节。
//      换存储驱动（mysql → 对象存储）时对外地址不变，前端不用动。
//   3. 写操作限流 5 次/分钟，记在 `rate_events(kind='avatar_write')` 里；清掉头像也算一次写。
//   4. 存储键是服务端生成的 UUID，**不是路径**，所以不存在用户可控的路径拼接。
import sharp from 'sharp';
import {createHash, randomUUID} from 'node:crypto';

import {execute, select, transaction} from '../db.mjs';
import {loadConfig} from '../config.mjs';
import {AVATAR_MAX_BYTES} from '../../common/limits.mjs';

/** 单张头像的原始上传上限（定义在 common/limits.mjs，表单也会把它渲染进 HTML 供前端预检）。 */
export {AVATAR_MAX_BYTES};
/** 没设过头像时对外跳转的默认图。 */
export const DEFAULT_AVATAR_URL = '/images/default-account-avatar.png';

/**
 * 头像相关的失败原因。状态码跟着一起带，接口层直接用它回 HTTP。
 */
export class AvatarError extends Error{
  /**
   * @param {string} code 错误码（会原样返回给前端）。
   * @param {number} status 对应的 HTTP 状态码。
   */
  constructor(code, status){
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * 抛一个 AvatarError。写成函数是为了让业务代码一行一个 if，不用每次 `throw new ...`。
 * @param {string} code 错误码。
 * @param {number} status HTTP 状态码。
 * @returns {never} 一定抛出。
 */
const fail = (code, status) => { throw new AvatarError(code, status); };

/** 某个用户的头像地址：全站唯一的读图入口。 */
export const avatarUrl = id => `/api/users/${id}/avatar`;

/**
 * 解析 URL 里的用户编号：只收正整数，其余一律按「查无此人」处理。
 * @param {string|number} value 待解析的值。
 * @returns {number} 用户编号。
 */
const idOf = value => {
  if(!/^[1-9]\d{0,14}$/.test(String(value)))
    fail('not_found', 404);
  return Number(value);
};

// ======================= 表结构 =======================

/**
 * 两张表：`avatar_blobs` 放字节，`user_avatars` 放引用与元信息。
 *
 * 分开的理由是以后换存储：`storage_driver` + `storage_key` 指向真正存放字节的地方，
 * mysql 只是其中一种驱动（见下面的存储适配器）。
 */
export const avatarSchema = [
  `CREATE TABLE IF NOT EXISTS avatar_blobs (storage_key VARCHAR(80) PRIMARY KEY,content MEDIUMBLOB NOT NULL) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS user_avatars (user_id BIGINT UNSIGNED PRIMARY KEY,storage_driver VARCHAR(32) NOT NULL,storage_key VARCHAR(80) NOT NULL,content_type VARCHAR(32) NOT NULL,byte_size INT UNSIGNED NOT NULL,width SMALLINT UNSIGNED NOT NULL,height SMALLINT UNSIGNED NOT NULL,etag CHAR(64) NOT NULL,updated_at DATETIME NOT NULL,UNIQUE KEY uniq_avatar_object(storage_driver,storage_key),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`
];

/**
 * 建表。可反复执行（全部 IF NOT EXISTS）。
 *
 * DDL 在 MySQL 里会隐式提交，所以拿一把具名咨询锁把并发部署串起来 —— 两个实例同时启动时只有一个在跑。
 * @returns {Promise<void>} 无。
 */
export async function migrateAvatars(){
  await transaction(async c => {
    const [[lock]] = await c.query("SELECT GET_LOCK('nanocamp_avatar_schema',15) AS ok");
    if(!lock.ok)
      throw Error('Avatar schema migration locked');
    try{
      for(const sql of avatarSchema)
        await c.query(sql);
    }
    finally{
      await c.query("SELECT RELEASE_LOCK('nanocamp_avatar_schema')");
    }
  });
}

// ======================= 存储适配器 =======================

/**
 * 字节存储只有三个动作：写、读、删。键由服务端生成，适配器**不该**把它当路径拼。
 * 现在只有 mysql 一种；以后接对象存储时用 registerAvatarStore 注册，旧数据留在 mysql 里逐步迁移。
 */
const stores = new Map([['mysql', {
  async put({key, bytes}){
    await execute('INSERT INTO avatar_blobs(storage_key,content) VALUES (?,?)', [key, bytes]);
  },
  async get(key){
    const [row] = await select('SELECT content FROM avatar_blobs WHERE storage_key=?', [key]);
    return row?.content || null;
  },
  async delete(key){
    await execute('DELETE FROM avatar_blobs WHERE storage_key=?', [key]);
  }
}]]);

/**
 * 注册一种存储适配器。
 * @param {string} name 驱动名（小写字母开头，最多 32 位）。
 * @param {{put: Function, get: Function, delete: Function}} adapter 适配器。
 * @returns {void}
 */
export function registerAvatarStore(name, adapter){
  if(!/^[a-z][a-z0-9_-]{0,31}$/.test(name) || stores.has(name) || !['put', 'get', 'delete'].every(key => typeof adapter?.[key] === 'function'))
    throw Error('Invalid or duplicate avatar storage adapter');
  stores.set(name, adapter);
}

/**
 * 取一个已注册的适配器。
 * @param {string} name 驱动名。
 * @returns {{put: Function, get: Function, delete: Function}} 适配器。
 */
export function avatarStore(name){
  const store = stores.get(name);
  if(!store)
    throw Error(`Avatar storage adapter is not registered: ${name}`);
  return store;
}

// ======================= 业务 =======================

/**
 * 取某个用户的头像元信息（没有就返回 null）。
 * @param {string|number} id 用户编号。
 * @returns {Promise<object|null>} user_avatars 的一行。
 */
export async function avatarMetadata(id){
  id = idOf(id);
  const [user] = await select('SELECT id FROM users WHERE id=?', [id]);
  if(!user)
    fail('not_found', 404);
  const [meta] = await select('SELECT * FROM user_avatars WHERE user_id=?', [id]);
  return meta || null;
}

/**
 * 拼成接口返回的形状。没设过头像时给"默认头像"那一套值，前端不用判断 null。
 * @param {string|number} id 用户编号。
 * @param {object|null} meta 头像元信息。
 * @returns {object} 对外的头像描述。
 */
export function avatarResult(id, meta){
  return {
    url: avatarUrl(id),
    isDefault: !meta,
    version: meta?.etag || null,
    contentType: meta?.content_type || 'image/png',
    width: meta?.width || 256,
    height: meta?.height || 256,
    size: meta?.byte_size || null,
    updatedAt: meta?.updated_at || null
  };
}

/**
 * 删一段字节。删不掉只记日志：此时引用已经不在，最多留一段孤儿数据，不该让整个请求失败。
 * @param {string} driver 存储驱动。
 * @param {string} key 存储键。
 * @returns {Promise<void>} 无。
 */
async function clean(driver, key){
  try{
    await avatarStore(driver).delete(key);
  }
  catch(error){
    console.error('[avatar:cleanup]', driver, key, error.code || '', error.message);
  }
}

/**
 * 先锁住用户行：并发换头像时把同一个人的写请求串起来，限流计数才准。
 * @param {object} c 事务连接。
 * @param {number} id 用户编号。
 * @returns {Promise<void>} 无。
 */
async function lockedUser(c, id){
  const [[user]] = await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [id]);
  if(!user)
    fail('unauthenticated', 401);
}

/**
 * 写操作限流：一分钟 5 次。超了直接 429，连图片解码都不做。
 * @param {object} c 事务连接。
 * @param {number} id 用户编号。
 * @returns {Promise<void>} 无。
 */
async function rate(c, id){
  const subject = String(id);
  const [[row]] = await c.execute("SELECT COUNT(*) AS n FROM rate_events WHERE kind='avatar_write' AND subject=? AND at>?", [subject, new Date(Date.now() - 60000)]);
  if(row.n >= 5)
    fail('rate_limited', 429);
  await c.execute("INSERT INTO rate_events(kind,subject,at) VALUES ('avatar_write',?,?)", [subject, new Date()]);
}

/**
 * 换头像：校验 → 解码重编码 → 写字节 → 发布引用 → 删旧字节。
 *
 * 顺序是刻意的（见文件头第 1 条）：任何一步失败，用户原来的头像都还完好。
 * 重编码只接受 png / jpeg / webp 的**单帧**图片，动图会被拒掉，避免把 GIF 的每一帧都塞进存储。
 * @param {string|number} userId 用户编号（来自会话，不读请求体）。
 * @param {Buffer} input 原始字节。
 * @param {string} contentType 请求的 Content-Type。
 * @returns {Promise<object>} 新的头像描述（同 avatarResult）。
 */
export async function replaceAvatar(userId, input, contentType){
  userId = idOf(userId);
  if(!Buffer.isBuffer(input) || !input.length)
    fail('invalid_image', 422);
  if(input.length > AVATAR_MAX_BYTES)
    fail('avatar_too_large', 413);
  const expected = {'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp'}[String(contentType).split(';')[0].trim().toLowerCase()];
  if(!expected)
    fail('unsupported_image_type', 415);
  let bytes;
  try{
    const image = sharp(input, {limitInputPixels: 16 * 1024 * 1024, failOn: 'warning'});
    const meta = await image.metadata();
    // 声明是 png 但内容是 jpeg（或反过来）时也拒绝：让 Content-Type 与真实格式对得上。
    if(meta.format !== expected || (meta.pages || 1) > 1)
      fail('invalid_image', 422);
    bytes = await image.rotate().resize(256, 256, {fit: 'cover'}).webp({quality: 85}).toBuffer();
  }
  catch(error){
    if(error instanceof AvatarError)
      throw error;
    fail('invalid_image', 422);
  }
  const driver = loadConfig().avatarStorage?.driver || 'mysql';
  const store = avatarStore(driver);
  const key = randomUUID();
  const meta = {storage_driver: driver, storage_key: key, content_type: 'image/webp', byte_size: bytes.length, width: 256, height: 256, etag: createHash('sha256').update(bytes).digest('hex'), updated_at: new Date()};
  try{
    await store.put({key, bytes, contentType: meta.content_type});
  }
  catch(error){
    await clean(driver, key);
    throw error;
  }
  let old;
  try{
    await transaction(async c => {
      await lockedUser(c, userId);
      await rate(c, userId);
      const [[current]] = await c.execute('SELECT * FROM user_avatars WHERE user_id=? FOR UPDATE', [userId]);
      old = current;
      await c.execute(
        'INSERT INTO user_avatars(user_id,storage_driver,storage_key,content_type,byte_size,width,height,etag,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE storage_driver=VALUES(storage_driver),storage_key=VALUES(storage_key),content_type=VALUES(content_type),byte_size=VALUES(byte_size),width=VALUES(width),height=VALUES(height),etag=VALUES(etag),updated_at=VALUES(updated_at)',
        [userId, driver, key, meta.content_type, meta.byte_size, 256, 256, meta.etag, meta.updated_at]
      );
    });
  }
  catch(error){
    await clean(driver, key);
    throw error;
  }
  // 事务提交之后才删旧图：回滚时它还得在。
  if(old)
    await clean(old.storage_driver, old.storage_key);
  return avatarResult(userId, meta);
}

/**
 * 清掉头像（回到默认图）。同样先记一次写限流，再删引用，最后删字节。
 * @param {string|number} userId 用户编号。
 * @returns {Promise<object>} 默认头像的描述。
 */
export async function removeAvatar(userId){
  userId = idOf(userId);
  let old;
  await transaction(async c => {
    await lockedUser(c, userId);
    await rate(c, userId);
    const [[row]] = await c.execute('SELECT * FROM user_avatars WHERE user_id=? FOR UPDATE', [userId]);
    old = row;
    await c.execute('DELETE FROM user_avatars WHERE user_id=?', [userId]);
  });
  if(old)
    await clean(old.storage_driver, old.storage_key);
  return avatarResult(userId, null);
}

/**
 * 读头像字节。
 *
 * 可能撞上"引用已经换了、字节刚被删"的那一瞬间，所以最多重读一次；
 * 两次都拿不到才 503 —— 那说明存储真的有问题，不该伪装成 404（默认图会掩盖真实故障）。
 * @param {string|number} id 用户编号。
 * @returns {Promise<{meta: object, bytes: Buffer}|null>} 元信息与字节；没设过头像时 null。
 */
export async function readAvatar(id){
  for(let attempt = 0; attempt < 2; attempt++){
    const meta = await avatarMetadata(id);
    if(!meta)
      return null;
    const bytes = await avatarStore(meta.storage_driver).get(meta.storage_key);
    if(bytes)
      return {meta, bytes};
  }
  fail('avatar_unavailable', 503);
}
