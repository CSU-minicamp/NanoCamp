// 论坛图片：上传（sharp 解码 → 缩放 → 转 webp）、读取、存储适配器、过期草稿清理。
//
// 这套管线很少动，但一旦动就要连着改上传、读取与 markdown 白名单，所以自成一处。
// 存储走适配器（registerForumImageStore），测试里换成内存实现，生产用 MySQL 的 blob 表。
// 依赖方向：本文件 → index.mjs（借 write/limit 走同一套限流与成员校验）—— 不允许反向引用。
import sharp from 'sharp';
import {createHash, randomUUID} from 'node:crypto';

import {FORUM_IMAGE_DRAFT_DAYS, FORUM_IMAGE_MAX_BYTES, IMAGE_UPLOAD_PER_HOUR} from '../../common/forum.mjs';
import {checkMember, fail, idOf} from './base.mjs';
import {execute, select, transaction} from '../db.mjs';
import {loadConfig} from '../config.mjs';
import {write, limit} from './index.mjs';

// ======================= 图片 =======================

// 上限（5 MB / 草稿 7 天 / 每小时 20 张）都在 common/forum.mjs：
// main.mjs 要拿同一个数字当请求体上限，模板也要把它渲染进提示文案。

/** 草稿图的截止时间。 */
const draftCutoff = () => new Date(Date.now() - FORUM_IMAGE_DRAFT_DAYS * 86400000);

/**
 * 图片字节存储，与头像那套同构（键是服务端生成的 UUID，不是路径）。
 * 记录上带 storage_driver，所以老的 mysql 对象和以后的云对象可以共存。
 */
const imageStores = new Map([['mysql', {
  async put({key, bytes}){
    await execute('INSERT INTO forum_image_blobs(storage_key,content) VALUES (?,?)', [key, bytes]);
  },
  async get(key){
    const [row] = await select('SELECT content FROM forum_image_blobs WHERE storage_key=?', [key]);
    return row?.content || null;
  },
  async delete(key){
    await execute('DELETE FROM forum_image_blobs WHERE storage_key=?', [key]);
  }
}]]);

/**
 * 注册一种图片存储适配器。
 * @param {string} name 驱动名。
 * @param {{put: Function, get: Function, delete: Function}} adapter 适配器。
 * @returns {void}
 */
export function registerForumImageStore(name, adapter){
  if(!/^[a-z][a-z0-9_-]{0,31}$/.test(name) || imageStores.has(name) || !['put', 'get', 'delete'].every(key => typeof adapter?.[key] === 'function'))
    throw Error('Invalid or duplicate forum image storage adapter');
  imageStores.set(name, adapter);
}

/**
 * 取一个已注册的图片存储适配器。
 * @param {string} name 驱动名。
 * @returns {{put: Function, get: Function, delete: Function}} 适配器。
 */
export function forumImageStore(name){
  const store = imageStores.get(name);
  if(!store)
    throw Error(`Forum image storage adapter is not registered: ${name}`);
  return store;
}

/**
 * 上传一张图（草稿状态，发帖时才挂到帖子上）。
 *
 * 没有一张专门的幂等表，幂等靠 `(poster_id, etag)` + `post_id IS NULL`，
 * 同一张图重复上传（网络重试、双击）会命中已经存在的草稿图并复用它，本次写进去的字节再删掉。
 * 失败路径都要清掉已经写进去的字节，否则会留下没人引用的孤儿对象。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键（仍校验格式，用于限流分桶时的语义一致性）。
 * @param {Buffer} input 原始字节。
 * @param {string} type 请求的 Content-Type。
 * @returns {Promise<object>} 图片信息（id / url / 尺寸）。
 */
export async function uploadForumImage(user, key, input, type){
  // 传图是为了发帖，算公开发言：禁言期不能传（ban 更不行）。
  await transaction(c => checkMember(c, user, {speaking: true}));
  if(!/^[\w-]{8,80}$/.test(String(key ?? '')))
    fail('idempotency_required');
  if(!Buffer.isBuffer(input) || !input.length)
    fail('invalid_image', 422);
  if(input.length > FORUM_IMAGE_MAX_BYTES)
    fail('image_too_large', 413);
  const expected = {'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp'}[String(type).split(';')[0].trim().toLowerCase()];
  if(!expected)
    fail('unsupported_image_type', 415);
  let output;
  try{
    const image = sharp(input, {limitInputPixels: 16 * 1024 * 1024, failOn: 'warning'});
    const meta = await image.metadata();
    // 动图不收：只留一帧的「动图」比原图更容易误导。
    if(meta.format !== expected || (meta.pages || 1) > 1)
      fail('invalid_image', 422);
    output = await image.rotate().resize({width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true}).webp({quality: 85}).toBuffer({resolveWithObject: true});
  }
  catch(error){
    if(error.code === 'invalid_image')
      throw error;
    fail('invalid_image', 422);
  }
  const storageKey = randomUUID();
  const driver = loadConfig().forumImageStorage?.driver || 'mysql';
  const store = forumImageStore(driver);
  const bytes = output.data;
  const etag = createHash('sha256').update(bytes).digest('hex');
  let result;
  try{
    await store.put({key: storageKey, bytes, contentType: 'image/webp'});
    result = await write(user, key, 'image_upload', async c => {
      await limit(c, user, 'image_upload', IMAGE_UPLOAD_PER_HOUR);
      // 同一张图重复上传：复用还没挂到帖子上的那张草稿。
      const [prior] = await c.execute('SELECT id,storage_key,content_type,byte_size,width,height FROM forum_images WHERE poster_id=? AND etag=? AND post_id IS NULL AND created_at>? ORDER BY id DESC LIMIT 1', [user.id, etag, draftCutoff()]);
      if(prior[0])
        return {id: prior[0].id, storage_key: prior[0].storage_key, url: '/api/forum/images/' + prior[0].id, contentType: prior[0].content_type, size: Number(prior[0].byte_size), width: prior[0].width, height: prior[0].height};
      // c.execute 返回 [ResultSetHeader, fields]，insertId 在第一个元素上（不是 rows() 的裸 result）。
      const [created] = await c.execute('INSERT INTO forum_images(poster_id,storage_driver,storage_key,content_type,byte_size,width,height,etag,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [user.id, driver, storageKey, 'image/webp', bytes.length, output.info.width, output.info.height, etag, new Date()]);
      return {id: created.insertId, storage_key: storageKey, url: '/api/forum/images/' + created.insertId, contentType: 'image/webp', size: bytes.length, width: output.info.width, height: output.info.height};
    });
  }
  catch(error){
    await dropObject(driver, storageKey);
    throw error;
  }
  // 命中已有草稿时，本次写进去的这份就是多余的，删掉。
  if(result.storage_key !== storageKey)
    await dropObject(driver, storageKey);
  delete result.storage_key;
  return result;
}

/**
 * 删一段字节。删不掉只记日志：此时引用已经不在，最多留一段孤儿数据，不该让整个请求失败。
 * @param {string} driver 存储驱动。
 * @param {string} key 存储键。
 * @returns {Promise<void>} 无。
 */
async function dropObject(driver, key){
  try{
    await forumImageStore(driver).delete(key);
  }
  catch(error){
    console.error('[forum:image:cleanup]', key, error.code || '', error.message);
  }
}

/**
 * 读一张图。
 *
 * 已挂到帖子上的图跟着帖子的可见性走（帖子被删就 404）；
 * 还没挂的草稿图只有本人能看，而且过了 7 天就当它不存在 —— 防止拿上传接口当图床。
 * @param {string|number} id 图片编号（自增数字）。
 * @param {number} [viewer] 当前用户。
 * @returns {Promise<{meta: object, bytes: Buffer}>} 元信息与字节。
 */
export async function readForumImage(id, viewer = 0){
  const [meta] = await select('SELECT i.*,p.status AS post_status FROM forum_images i LEFT JOIN forum_posts p ON p.id=i.post_id WHERE i.id=?', [idOf(id)]);
  if(!meta)
    fail('not_found', 404);
  if(meta.post_id){
    if(meta.post_status !== 'published')
      fail('not_found', 404);
  }
  else if(Number(meta.poster_id) !== Number(viewer) || new Date(meta.created_at) < draftCutoff())
    fail('not_found', 404);
  const bytes = await forumImageStore(meta.storage_driver).get(meta.storage_key);
  if(!bytes){
    // 元信息在、字节没了：这是存储故障，不能当 404 糊过去，否则永远发现不了。
    console.error('[forum:image:missing-object]', meta.id, meta.storage_driver);
    fail('unavailable', 503);
  }
  return {meta, bytes};
}

/**
 * 清理过期草稿图（运维脚本调用）。
 * @param {string|number} [limit=100] 单批上限。
 * @param {string|number|null} [posterId] 只清某个人的（测试用）。
 * @returns {Promise<number>} 清掉的张数。
 */
export async function cleanupDraftImages(limit = 100, posterId = null){
  const batch = Math.min(1000, Math.max(1, Number.parseInt(limit, 10) || 100));
  return transaction(async c => {
    const [images] = await c.query(`SELECT * FROM forum_images WHERE post_id IS NULL AND created_at<? ${posterId? 'AND poster_id=?': ''} ORDER BY created_at LIMIT ${batch} FOR UPDATE`, posterId? [draftCutoff(), posterId]: [draftCutoff()]);
    for(const image of images){
      await dropObject(image.storage_driver, image.storage_key);
      await c.execute('DELETE FROM forum_images WHERE id=? AND post_id IS NULL', [image.id]);
    }
    return images.length;
  });
}
