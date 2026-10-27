// 论坛图片：上传（sharp 解码 → 缩放 → 转 webp）、读取、存储适配器、过期草稿清理。
//
// 这套管线很少动，但一旦动就要连着改上传、读取与 markdown 白名单，所以自成一处。
// 存储走适配器（registerForumImageStore），测试里换成内存实现，生产用 MySQL 的 blob 表。
// 依赖方向：本文件 → index.mjs（借 write/limit 走同一套幂等与限流）—— 不允许反向引用。
import sharp from 'sharp';
import {createHash, randomUUID} from 'node:crypto';

import {checkMember, fail} from './base.mjs';
import {execute, select, transaction} from '../db.mjs';
import {loadConfig} from '../config.mjs';
import {write, limit} from './index.mjs';

// ======================= 图片 =======================

/** 单张图片原始上传上限（5 MB）。压缩后长边 1920、WebP。 */
export const FORUM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** 草稿图存活天数：发帖时才会挂到主题上，超过这个时间没挂上的会被清理脚本删掉。 */
export const FORUM_IMAGE_DRAFT_DAYS = 7;

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
 * 上传一张图（草稿状态，发帖时才挂到主题上）。
 *
 * 幂等键覆盖"同一张图重复上传"：摘要里放了原图哈希与格式，重放同一个键直接返回第一次的结果。
 * 失败路径都要清掉已经写进去的字节，否则会留下没人引用的孤儿对象。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {Buffer} input 原始字节。
 * @param {string} type 请求的 Content-Type。
 * @returns {Promise<object>} 图片信息（id / url / 尺寸）。
 */
export async function uploadForumImage(user, key, input, type){
  await transaction(c => checkMember(c, user));
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
    // 动图不收：只留一帧的"动图"比原图更容易误导。
    if(meta.format !== expected || (meta.pages || 1) > 1)
      fail('invalid_image', 422);
    output = await image.rotate().resize({width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true}).webp({quality: 85}).toBuffer({resolveWithObject: true});
  }
  catch(error){
    if(error.code === 'invalid_image')
      throw error;
    fail('invalid_image', 422);
  }
  const id = randomUUID();
  const driver = loadConfig().forumImageStorage?.driver || 'mysql';
  const store = forumImageStore(driver);
  const bytes = output.data;
  const digest = createHash('sha256').update(input).digest('hex');
  let result;
  try{
    await store.put({key: id, bytes, contentType: 'image/webp'});
    result = await write(user, key, 'image.upload', {digest, type: expected}, async c => {
      // 一小时 20 张：够正常发帖配图，挡得住批量刷。
      const [[{n}]] = await c.execute("SELECT COUNT(*) AS n FROM forum_write_requests WHERE user_id=? AND action='image.upload' AND created_at>?", [user.id, new Date(Date.now() - 3600000)]);
      if(n >= 20)
        fail('rate_limited', 429);
      await c.execute('INSERT INTO forum_images(id,owner_id,storage_driver,storage_key,content_type,byte_size,width,height,etag,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, user.id, driver, id, 'image/webp', bytes.length, output.info.width, output.info.height, createHash('sha256').update(bytes).digest('hex'), new Date()]);
      return {id, url: '/api/forum/images/' + id, contentType: 'image/webp', size: bytes.length, width: output.info.width, height: output.info.height};
    });
  }
  catch(error){
    try{
      await store.delete(id);
    }
    catch(cleanup){
      console.error('[forum:image:cleanup]', id, cleanup.code || '', cleanup.message);
    }
    throw error;
  }
  // 幂等重放时 result.id 是第一次那个 id，本次写进去的这份就是多余的，删掉。
  if(result.id !== id)
    try{
      await store.delete(id);
    }
    catch(error){
      console.error('[forum:image:duplicate-cleanup]', id, error.message);
    }
  return result;
}

/**
 * 读一张图。
 *
 * 已挂到主题上的图跟着主题的可见性走（主题被隐藏就 404）；
 * 还没挂的草稿图只有本人能看，而且过了 7 天就当它不存在 —— 防止拿上传接口当图床。
 * @param {string} id 图片编号（UUID）。
 * @param {number} [viewer] 当前用户。
 * @returns {Promise<{meta: object, bytes: Buffer}>} 元信息与字节。
 */
export async function readForumImage(id, viewer = 0){
  const [meta] = await select('SELECT i.*,t.status AS topic_status FROM forum_images i LEFT JOIN forum_topics t ON t.id=i.topic_id WHERE i.id=?', [id]);
  if(!meta)
    fail('not_found', 404);
  if(meta.topic_id){
    if(meta.topic_status !== 'published')
      fail('not_found', 404);
  }
  else if(Number(meta.owner_id) !== Number(viewer) || new Date(meta.created_at) < draftCutoff())
    fail('not_found', 404);
  const bytes = await forumImageStore(meta.storage_driver).get(meta.storage_key);
  if(!bytes){
    // 元信息在、字节没了：这是存储故障，不能当 404 糊过去，否则永远发现不了。
    console.error('[forum:image:missing-object]', id, meta.storage_driver);
    fail('unavailable', 503);
  }
  return {meta, bytes};
}

/**
 * 清理过期草稿图（运维脚本调用）。
 * @param {string|number} [limit=100] 单批上限。
 * @param {string|number|null} [ownerId] 只清某个人的（测试用）。
 * @returns {Promise<number>} 清掉的张数。
 */
export async function cleanupDraftImages(limit = 100, ownerId = null){
  const batch = Math.min(1000, Math.max(1, Number.parseInt(limit, 10) || 100));
  return transaction(async c => {
    const [images] = await c.query(`SELECT * FROM forum_images WHERE topic_id IS NULL AND created_at<? ${ownerId? 'AND owner_id=?': ''} ORDER BY created_at LIMIT ${batch} FOR UPDATE`, ownerId? [draftCutoff(), ownerId]: [draftCutoff()]);
    for(const image of images){
      await forumImageStore(image.storage_driver).delete(image.storage_key);
      await c.execute('DELETE FROM forum_images WHERE id=? AND topic_id IS NULL', [image.id]);
    }
    return images.length;
  });
}
