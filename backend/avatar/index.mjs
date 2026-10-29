// 头像的业务：字节存储 + 图片处理（HTTP 边界在 ./routes.mjs，建表在 backend/schema.mjs）。
//
// 为什么这三件事合成一个文件：它们只有一起改才说得通 —— 换存储驱动要动表里的 storage_key、
// 换压缩参数要动 etag、换驱动还要对上 content-type。拆开时改一处总要翻另外两处。
// HTTP 则单独一层（照 forum/routes.mjs 的样子）：它只认状态码和头，不参与上面这些取舍，
// 也不需要知道 sharp 怎么压、字节存在哪儿。
//
// 读之前先记住四条：
//   1. **先写字节、再发布引用**：两份字节都落盘成功后才更新 users 的 avatar_* 列，失败时旧头像还在；
//      旧字节要等事务提交之后才删，否则回滚了就只剩一条指向空对象的记录。
//      引用放在 users 上（不是单独一张 user_avatars），所以换头像就是一条单行 UPDATE，天然原子。
//   2. **对外两个地址，一份 etag**：`/api/users/<id>/avatar` 是 256×256 webp 缩略图（列表/导航用），
//      `/api/users/<id>/avatar/full` 是上传时的原图（原样存，GIF 保留动画，看大图用）。
//      缩略图是原图的派生物，原图没变它就不会变，所以两者共用一个 etag。
//   3. 写操作限流 5 次/分钟，记在 `rate_events(kind='avatar_write')` 里；清掉头像也算一次写。
//      一共查两次：解码前一次只读预检（挡掉明显超限，省下解码与写对象），事务里一次权威计数（防并发）。
//   4. 存储键是服务端生成的 UUID，**不是路径**；缩略图的键是 `<uuid>:thumb`，由原图键推导，不多存一列引用。
import sharp from 'sharp';
import {createHash, randomUUID} from 'node:crypto';

import {execute, select, transaction} from '../db.mjs';
import {loadConfig} from '../config.mjs';
import {AVATAR_MAX_BYTES} from '../../common/limits.mjs';
import {stripMetadata} from './metadata.mjs';

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

// ======================= 存储适配器 =======================

/**
 * 字节存储只有三个动作：写、读、删。键由服务端生成，适配器**不该**把它当路径拼。
 * 现在只有 mysql 一种；以后接对象存储时用 registerAvatarStore 注册，旧数据留在 mysql 里逐步迁移。
 */
const stores = new Map([['mysql', {
  async put({key, bytes, contentType = 'image/webp', createdAt = new Date()}){
    await execute('INSERT INTO avatar_blobs(storage_key,content_type,created_at,content) VALUES (?,?,?,?)', [key, contentType, createdAt, bytes]);
  },
  async get(key){
    const [row] = await select('SELECT content_type,content FROM avatar_blobs WHERE storage_key=?', [key]);
    return row? {bytes: row.content, contentType: row.content_type}: null;
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

/** 缩略图的边长与格式：列表、导航、帖子作者位都用它。 */
const AVATAR_SIZE = 256;
const AVATAR_TYPE = 'image/webp';

/**
 * 缩略图的对象键 = 原图键 + 这个后缀。
 *
 * 用派生键而不是再加一列引用：`users.avatar_storage_key` 只记原图，缩略图位置由它推出来，
 * 换头像时两个对象天然成对，不会出现「引用换了、缩略图还指着旧的」。
 */
const THUMB_SUFFIX = ':thumb';

/** 允许上传的格式。gif 也在内 —— 原图原样存，动画保留；缩略图取首帧。 */
const ACCEPTED_TYPES = {'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif'};

/**
 * 取某个用户的头像引用（没有就返回 null）。
 *
 * `updated_at` 是**字节写入时间**，跟着对象走：驱动换成对象存储后没有 blob 行，这里会是 null。
 * @param {string|number} id 用户编号。
 * @returns {Promise<object|null>} `{storage_driver, storage_key, etag, updated_at}`，或 null。
 */
export async function avatarMetadata(id){
  id = idOf(id);
  const [user] = await select('SELECT u.id,u.avatar_storage_driver,u.avatar_storage_key,u.avatar_etag,b.created_at FROM users u LEFT JOIN avatar_blobs b ON b.storage_key=u.avatar_storage_key WHERE u.id=?', [id]);
  if(!user)
    fail('not_found', 404);
  if(!user.avatar_storage_key)
    return null;
  return {storage_driver: user.avatar_storage_driver || 'mysql', storage_key: user.avatar_storage_key, etag: user.avatar_etag, updated_at: user.created_at};
}

/**
 * 拼成接口返回的形状。没设过头像时给"默认头像"那一套值，前端不用判断 null。
 *
 * 只返回**地址与版本**，不返回图片属性：
 *   · 缩略图固定 256×256 webp，宽高与格式都是常量，客户端用 CSS 控制显示尺寸就够了；
 *   · 原图是什么格式，看 `/avatar/full` 的 `Content-Type` 响应头（JSON 里写死一个值只会误导）。
 * 将来做灯箱若需要预留位置防抖动，再按需加 fullWidth / fullHeight。
 * @param {string|number} id 用户编号。
 * @param {object|null} meta 头像引用。
 * @returns {object} 对外的头像描述。
 */
export function avatarResult(id, meta){
  return {
    url: avatarUrl(id),
    // 原图地址：列表一律用 url（缩略图），只有「点头像看大图」时才换成 fullUrl。
    fullUrl: `${avatarUrl(id)}/full`,
    isDefault: !meta,
    version: meta?.etag || null,
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
 * 顺手把当前引用读出来（同一行，不用再查一次）。
 * @param {object} c 事务连接。
 * @param {number} id 用户编号。
 * @returns {Promise<object>} 锁定时的 `{avatar_storage_driver, avatar_storage_key}`。
 */
async function lockedUser(c, id){
  const [[user]] = await c.execute('SELECT avatar_storage_driver,avatar_storage_key FROM users WHERE id=? FOR UPDATE', [id]);
  if(!user)
    fail('unauthenticated', 401);
  return user;
}

/**
 * 限流的**预检**：只读，不加锁也不计数，超限就 429。
 * @param {number} id 用户编号。
 * @returns {Promise<void>} 无。
 */
async function ratePrecheck(id){
  const [row] = await select("SELECT COUNT(*) AS n FROM rate_events WHERE kind='avatar_write' AND subject=? AND at>?", [String(id), new Date(Date.now() - 60000)]);
  if(row.n >= 5)
    fail('rate_limited', 429);
}

/**
 * 限流的**权威检查**：在事务里、锁住用户行之后执行 —— 一分钟 5 次，超了 429，并把这次写记进 rate_events。
 *
 * 它不能提前到解码之前：计数要按「真的写了一次」算，而写发生在事务提交时。
 * 想在解码前就把明显超限的请求挡掉的，是上面的 ratePrecheck。
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
 * 换头像：校验 → 限流预检 → 读元信息 + 生成缩略图 → 写两份字节 → 发布引用（含权威限流）→ 删旧两份。
 *
 * 存两份是有意的：**原图原样存**（不转码、不重编码，GIF 动画保留，只在灯箱里加载；
 * 但落库前会剥掉 EXIF/XMP —— 手机原图里的 GPS 不该跟着 `full` 地址公开出去，剥离只删元数据块，像素不动），
 * 另存一份 256×256 webp 缩略图给列表/导航/作者位用 —— 页面首屏只拉缩略图，不会因为 2 MB 原图变重。
 * 缩略图**取首帧**：一屏几十个头像同时动既吵又贵。
 *
 * 顺序是刻意的（见文件头第 1 条）：任何一步失败，用户原来的头像都还完好。
 * 限流查两次：预检在解码前（挡掉明显超限的请求，只读），权威检查在事务里（真正计数、防并发）。
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
  const type = String(contentType).split(';')[0].trim().toLowerCase();
  const expected = ACCEPTED_TYPES[type];
  if(!expected)
    fail('unsupported_image_type', 415);
  await ratePrecheck(userId);  // 明显超限的请求到这里就回 429，不进 sharp、也不写对象。
  let bytes, thumb;
  try{
    const meta = await sharp(input, {limitInputPixels: 16 * 1024 * 1024, failOn: 'warning'}).metadata();
    // 声明是 png 但内容是 jpeg（或反过来）时也拒绝：让 Content-Type 与真实格式对得上。
    if(meta.format !== expected)
      fail('invalid_image', 422);
    // 剥掉 EXIF/XMP（含 GPS）再落库：只删容器里的元数据块，像素不动。
    bytes = stripMetadata(input, expected);
    // 缩略图从**剥完的字节**生成：万一剥离把文件弄坏了，这里会直接抛错变成 422，而不是把坏文件存进去。
    thumb = await sharp(bytes, {page: 0, limitInputPixels: 16 * 1024 * 1024, failOn: 'warning'})
      .rotate().resize(AVATAR_SIZE, AVATAR_SIZE, {fit: 'cover'}).webp({quality: 85}).toBuffer();
  }
  catch(error){
    if(error instanceof AvatarError)
      throw error;
    fail('invalid_image', 422);
  }
  const driver = loadConfig().avatarStorage?.driver || 'mysql';
  const store = avatarStore(driver);
  const key = randomUUID();
  // etag 用**原图**的哈希：缩略图是它的派生物，原图没变缩略图就不会变 —— 两个地址共用一个校验值。
  const etag = createHash('sha256').update(bytes).digest('hex');
  // DATETIME 只到秒，先把毫秒抹掉再写：否则写进响应里的时间和随后读出来的不一致。
  const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  try{
    await store.put({key, bytes, contentType: type, createdAt});
    await store.put({key: key + THUMB_SUFFIX, bytes: thumb, contentType: AVATAR_TYPE, createdAt});
  }
  catch(error){
    await clean(driver, key);
    await clean(driver, key + THUMB_SUFFIX);
    throw error;
  }
  let old = null;
  try{
    await transaction(async c => {
      const previous = await lockedUser(c, userId);
      await rate(c, userId);
      if(previous.avatar_storage_key)
        old = {driver: previous.avatar_storage_driver || 'mysql', key: previous.avatar_storage_key};
      await c.execute('UPDATE users SET avatar_storage_driver=?,avatar_storage_key=?,avatar_etag=? WHERE id=?', [driver, key, etag, userId]);
    });
  }
  catch(error){
    await clean(driver, key);
    await clean(driver, key + THUMB_SUFFIX);
    throw error;
  }
  // 事务提交之后才删旧图：回滚时它还得在。原图与缩略图成对删。
  if(old){
    await clean(old.driver, old.key);
    await clean(old.driver, old.key + THUMB_SUFFIX);
  }
  return avatarResult(userId, {storage_driver: driver, storage_key: key, etag, updated_at: createdAt});
}

/**
 * 清掉头像（回到默认图）。同样先记一次写限流，再删引用，最后删字节。
 * @param {string|number} userId 用户编号。
 * @returns {Promise<object>} 默认头像的描述。
 */
export async function removeAvatar(userId){
  userId = idOf(userId);
  let old = null;
  await transaction(async c => {
    const previous = await lockedUser(c, userId);
    await rate(c, userId);
    if(previous.avatar_storage_key)
      old = {driver: previous.avatar_storage_driver || 'mysql', key: previous.avatar_storage_key};
    await c.execute('UPDATE users SET avatar_storage_driver=NULL,avatar_storage_key=NULL,avatar_etag=NULL WHERE id=?', [userId]);
  });
  if(old){
    await clean(old.driver, old.key);
    await clean(old.driver, old.key + THUMB_SUFFIX);
  }
  return avatarResult(userId, null);
}

/**
 * 读头像字节。默认读**缩略图**，`full` 为真时读原图（灯箱用）。
 *
 * 两份对象在写入时一起落盘、一起删除，所以这里不做「缩略图缺失就退回原图」的兜底 ——
 * 头像还没上线，没有历史数据要兼容；真缺了就是故障，宁可 503 也不要悄悄发一张原图出去。
 * 可能撞上"引用已经换了、字节刚被删"的那一瞬间，所以最多重读一次引用；
 * 两次都拿不到才 503 —— 那说明存储真的有问题，不该伪装成 404（默认图会掩盖真实故障）。
 * @param {string|number} id 用户编号。
 * @param {object|null} [known] 已经读到的引用（调用方为了先做 304 判断读过一次，传进来省一次查询）。
 * @param {boolean} [full] 是否读原图。
 * @returns {Promise<{meta: object, bytes: Buffer, contentType: string}|null>} 引用、字节与类型；没设过头像时 null。
 */
export async function readAvatar(id, known = null, full = false){
  let meta = known;
  for(let attempt = 0; attempt < 2; attempt++){
    meta = meta || await avatarMetadata(id);
    if(!meta)
      return null;
    const object = await avatarStore(meta.storage_driver).get(full? meta.storage_key: meta.storage_key + THUMB_SUFFIX);
    if(object)
      return {meta, bytes: Buffer.isBuffer(object)? object: object.bytes, contentType: (Buffer.isBuffer(object)? null: object.contentType) || (full? null: AVATAR_TYPE) || 'application/octet-stream'};
    meta = null;
  }
  fail('avatar_unavailable', 503);
}
