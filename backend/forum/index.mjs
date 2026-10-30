// 论坛的核心：幂等写、帖子与回复、互动（投票/关注/收藏/举报）、审核。
//
// 论坛拆成四个文件，按「改东西时你会打开哪个」分，而不是按技术层分：
//   index.mjs   —— 写路径与数据模型：加字段、改校验、改权限都从这里进
//   read.mjs    —— 读路径与通知：列表、详情、我的内容、红点
//   images.mjs  —— 图片管线：上传、裁剪、存储适配器、清理草稿
//   routes.mjs  —— HTTP 边界：/forum/* 页面与 /api/forum/* 接口
//
// 依赖方向（只许往下）：
//   base.mjs        公共原语（错误类型、编号解析、分页、成员校验）—— 只 import backend/auth，不认 forum 里任何文件
//   dm.mjs          私信业务 —— 只认识 base，不 import 本文件 / read / images
//   本文件          论坛的写与模型 —— 只认识 base，不 import dm / read / images
//   read.mjs / images.mjs —— 认识 base 与本文件，本文件不认识它们
//   routes.mjs —— 唯一把 dm、本文件、read、images 拼在一起的地方
//
// 注意 dm 与本文件是**并列的两块**（两者之间没有边），不是上下层：私信只用 base 的成员校验，
// 论坛这边也不读私信数据；「消息页要读私信」发生在 routes.mjs 的页面分支里，不在本文件。
//
// 两条与旧实现的重要差别（2026-10-29 表结构重写）：
//   1. **内容发布后不可编辑**：只有 published / deleted_by_author / deleted_by_report 三个状态，
//      没有 hidden，也没有 version —— 「删了就没了」，详情页对非 published 一律 404。
//   2. **幂等不再有一张总表**：发帖/回复靠业务表自己的 client_request_key 唯一键，
//      限流靠 forum_post_rate_limits（固定窗口、单行自增），其余动作天生幂等。
import {PAGE_SIZE, POST_BODY_MAX, POST_BODY_MIN, POST_IMAGES_MAX, POST_TITLE_MAX, POST_TITLE_MIN, RATE_LIMITS, RATE_LIMIT_DEFAULT, REPLY_MAX, REPLY_MIN} from '../../common/forum.mjs';
import {categories, reportReasons} from '../../content/forum.mjs';
import {checkMember, fail, idOf, isStaff, memberType, rows, text} from './base.mjs';
import {select, transaction} from '../db.mjs';
import {forumImagePath, postImageSources} from '../../src/markdown.mjs';

// ======================= 小工具 =======================

/** 分类校验：不在白名单里就是 invalid_category。读列表按分类筛选时也要用，所以导出给 read.mjs。 */
export const categoryOf = value => {
  if(!categories.some(category => category.id === value))
    fail('invalid_category');
  return value;
};

/**
 * 内容类型的三种载体，一张表列全。
 *
 * 统一写成显式映射，读的人不用记哪几个是规则的；表名字面量还能被 grep 到，改表名不会漏。
 * 加第三种内容（比如 comment）只改这一处。
 */
const CONTENT = {
  post: {table: 'forum_posts', votes: 'forum_post_votes', reports: 'forum_post_reports', column: 'post_id'},
  reply: {table: 'forum_post_replies', votes: 'forum_reply_votes', reports: 'forum_reply_reports', column: 'reply_id'}
};

/**
 * 取内容类型的载体定义（内容表 / 投票表 / 举报表 / 指向它的列名）。
 * `kind` 不认识就 404 —— 它可能是 URL、请求体或命令行传进来的，不是内部常量。
 * @param {string} kind post / reply。
 * @returns {{table: string, votes: string, reports: string, column: string}} 载体定义。
 */
const contentOf = kind => CONTENT[kind] || fail('not_found', 404);

// 每小时的写上限在 common/forum.mjs（RATE_LIMITS / RATE_LIMIT_DEFAULT）：模板要把它们写进提示文案，
// 所以不能只留在后端。

/**
 * 哪些动作算「公开发言」。`mute` 只拦这些，`ban` 拦全部写动作。
 *
 * 判据是「会不会出现在广场上」：发帖、回复、投票、举报都是给别人看的；
 * 收藏、关注、删自己的内容、标已读都不是发言 —— 被禁言的人也该能整理自己的东西。
 * 传图不在这个集合里（它走 images.mjs，自己带 `speaking: true`）。
 */
const SPEAKING_ACTIONS = new Set(['post_create', 'reply_create', 'post.vote', 'reply.vote', 'report']);

// ======================= 限流与写闸门 =======================

/**
 * 固定窗口限流：一个用户的每个动作只占一行，(window_start, hits) 原子自增。
 *
 * 窗口按 `seconds` 自然对齐（整点/整十分钟），所以不需要清理任务 —— 新窗口到来时
 * `IF(window_start < 本窗口起点, 1, hits+1)` 会把计数重置成 1。
 * 先自增再判断：超限的那次也计数，防止「一直重试一直放行」。
 * @param {object} c 事务连接。
 * @param {object} user 当前用户。
 * @param {string} action 动作名。
 * @param {number} [max] 上限次数。
 * @param {number} [seconds=3600] 窗口长度（秒）。
 * @returns {Promise<void>} 无。
 */
export async function limit(c, user, action, max = RATE_LIMIT_DEFAULT, seconds = 3600){
  const start = new Date(Math.floor(Date.now() / (seconds * 1000)) * seconds * 1000);
  await rows(c, `INSERT INTO forum_post_rate_limits(user_id,action,window_start,hits) VALUES (?,?,?,1)
    ON DUPLICATE KEY UPDATE hits=IF(window_start<?,1,hits+1),window_start=IF(window_start<?,?,window_start)`, [user.id, action, start, start, start, start]);
  const [state] = await rows(c, 'SELECT hits FROM forum_post_rate_limits WHERE user_id=? AND action=?', [user.id, action]);
  if(Number(state.hits) > max)
    fail('rate_limited', 429);
}

/**
 * 写动作的总闸门：校验幂等键格式 → 事务 → 成员校验 → 限流 → 干活。
 *
 * 注意它**不再记录幂等结果**，幂等现在下放到业务表：
 * 发帖/回复写 `client_request_key` 唯一键，私信写 `client_message_id`，举报靠 `open_key`，
 * 投票/收藏/关注本来就是「同一目标一行」。所以这里只保证「限流 + 成员校验 + 同一事务」。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键（格式仍然校验，业务函数自己决定怎么用）。
 * @param {string} action 动作名（用于限流分桶）。
 * @param {Function} work 真正干活的事务函数，签名 (c, key)。
 * @returns {Promise<unknown>} work 的返回值。
 */
export async function write(user, key, action, work){
  if(!/^[\w-]{8,64}$/.test(String(key ?? '')))
    fail('idempotency_required');
  return transaction(async c => {
    // 标记已读这类动作走宽松校验：被禁言的人也得能清红点；发言类动作禁言时就拦掉。
    await checkMember(c, user, {passive: action === 'notifications.read', speaking: SPEAKING_ACTIONS.has(action)});
    await limit(c, user, action, RATE_LIMITS[action] || RATE_LIMIT_DEFAULT);
    return work(c, key);
  });
}

/**
 * 写一条通知。自己给自己点赞/回复/关注不产生通知；`event_key` 唯一索引兜重复。
 * @param {object} c 事务连接。
 * @param {number} receiver 收件人。
 * @param {number|null} sender 触发者（系统事件传 null）。
 * @param {string} category 通知类型。
 * @param {string} type 目标类型。
 * @param {number} id 目标编号。
 * @param {string} key 语义幂等键（同一件事只通知一次）。
 * @returns {Promise<void>} 无。
 */
async function notice(c, receiver, sender, category, type, id, key){
  if(sender && Number(receiver) === Number(sender) && ['reply', 'like', 'follow'].includes(category))
    return;
  await rows(c, 'INSERT IGNORE INTO forum_notifications(receiver,sender,category,target_type,target_id,event_key,created_at) VALUES (?,?,?,?,?,?,?)', [receiver, sender, category, type, id, key, new Date()]);
}

// ======================= 帖子与回复 =======================

/**
 * 锁住一条帖并返回它。非 published 一律当「不存在」—— 删掉的内容连作者也打不开。
 *
 * 加锁顺序在整份文件里只有一种：**先帖、后回复**。`targetLocked` 天然是这个顺序；
 * 会碰回复行的写路径（删除、审核）也必须先调 `lockPost()` —— 因为收尾的 `recalcPost()`
 * 会 `UPDATE forum_posts` 拿帖锁，那一步是「回复 → 帖」的边，先锁回复就和这里成环了。
 * @param {object} c 事务连接。
 * @param {string|number} id 帖子编号。
 * @returns {Promise<object>} 帖子行。
 */
async function postLocked(c, id){
  const [post] = await rows(c, 'SELECT * FROM forum_posts WHERE id=? FOR UPDATE', [id]);
  if(!post || post.status !== 'published')
    fail('not_found', 404);
  return post;
}

/**
 * 只把帖子的那一行锁住，不判状态。
 *
 * 给「必须按先帖后回复的顺序拿锁、但不在乎帖子是否已删」的路径用（删回复、审回复）：
 * 用 `postLocked()` 会把「帖子已被作者删掉、我来删自己的回复」变成 404。
 * @param {object} c 事务连接。
 * @param {string|number} id 帖子编号。
 * @returns {Promise<void>} 无。
 */
async function lockPost(c, id){
  const [row] = await rows(c, 'SELECT id FROM forum_posts WHERE id=? FOR UPDATE', [id]);
  if(!row)
    fail('not_found', 404);
}

/**
 * 锁住一条内容（帖或回复），同时把所属帖也锁上 —— 加锁顺序固定为先帖后回复，避免死锁。
 * @param {object} c 事务连接。
 * @param {string} kind post / reply。
 * @param {string|number} id 内容编号。
 * @returns {Promise<{item: object, post: object|null}>} 内容与所属帖（本身是帖时为 null）。
 */
async function targetLocked(c, kind, id){
  if(kind === 'post')
    return {item: await postLocked(c, id), post: null};
  // 只是拿它当白名单：非 post / reply 的 kind 在这里就 404。
  contentOf(kind);
  const [ref] = await rows(c, 'SELECT post_id FROM forum_post_replies WHERE id=?', [id]);
  if(!ref)
    fail('not_found', 404);
  const post = await postLocked(c, ref.post_id);
  const [item] = await rows(c, 'SELECT * FROM forum_post_replies WHERE id=? FOR UPDATE', [id]);
  if(!item || item.status !== 'published')
    fail('not_found', 404);
  return {item, post};
}

/**
 * 发帖。正文里引用的图片必须是本人上传、还没挂到帖子上的草稿（7 天内），最多 20 张。
 *
 * 幂等：`(poster_id, client_request_key)` 唯一。同一键重放时直接返回已有帖，不重复插入。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {object} data 请求体（title / body / category）。
 * @returns {Promise<{id: number, href: string}>} 新帖。
 */
export async function createPost(user, key, data){
  const title = text(data.title, POST_TITLE_MIN, POST_TITLE_MAX);
  const content = text(data.body, POST_BODY_MIN, POST_BODY_MAX);
  const category = categoryOf(data.category);
  const sources = postImageSources(content);
  if(sources.length > POST_IMAGES_MAX)
    fail('too_many_images');
  const imageIds = [...new Set(sources.map(src => {
    const match = String(src).match(forumImagePath);
    if(!match)
      fail('invalid_image_reference');
    return Number(match[1]);
  }))];
  return transaction(async c => {
    await checkMember(c, user, {speaking: true});
    const [prior] = await rows(c, 'SELECT id FROM forum_posts WHERE poster_id=? AND client_request_key=?', [user.id, key]);
    if(prior)
      return {id: prior.id, href: `/forum/topics/${prior.id}/`};
    await limit(c, user, 'post_create', RATE_LIMITS.post_create);
    const now = new Date();
    if(imageIds.length){
      // 只认「自己的、还没归属帖子、7 天内」的草稿图，防止把别人的图挂到自己帖子上。
      const images = await rows(c, `SELECT id,poster_id,post_id,created_at FROM forum_images WHERE id IN (${imageIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, imageIds);
      if(images.length !== imageIds.length || images.some(image => Number(image.poster_id) !== Number(user.id) || image.post_id || new Date(image.created_at) < new Date(Date.now() - 7 * 86400000)))
        fail('invalid_image_reference');
    }
    const created = await rows(c, 'INSERT INTO forum_posts(poster_id,category,title,content,client_request_key,created_at,last_activity_at) VALUES (?,?,?,?,?,?,?)', [user.id, category, title, content, key, now, now]);
    if(imageIds.length)
      await rows(c, `UPDATE forum_images SET post_id=? WHERE id IN (${imageIds.map(() => '?').join(',')})`, [created.insertId, ...imageIds]);
    return {id: created.insertId, href: `/forum/topics/${created.insertId}/`};
  }).catch(error => {
    // 并发下两个请求同时通过 prior 检查：唯一键兜底，重查一次返回已有帖。
    if(error.code === 'ER_DUP_ENTRY')
      return select('SELECT id FROM forum_posts WHERE poster_id=? AND client_request_key=?', [user.id, key])
        .then(([row]) => row? {id: row.id, href: `/forum/topics/${row.id}/`}: Promise.reject(error));
    throw error;
  });
}

/**
 * 回帖（`parentId` 给了就是楼中楼）。
 *
 * 楼层号来自 `posts.next_sequence`（锁帖后取号再 +1），不用 `MAX(sequence)+1` —— 并发下后者会撞唯一键。
 * 回复数用 `reply_count+1` 增量更新，删回复时由 recalcPost 兜底重算。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string|number} id 帖子编号。
 * @param {object} data 请求体（body / parentId）。
 * @returns {Promise<{id: number, href: string}>} 新回复。
 */
export async function createReply(user, key, id, data){
  id = idOf(id);
  const content = text(data.body, REPLY_MIN, REPLY_MAX);
  const parent = data.parentId? idOf(data.parentId): null;
  return transaction(async c => {
    await checkMember(c, user, {speaking: true});
    const [prior] = await rows(c, 'SELECT id,sequence FROM forum_post_replies WHERE poster_id=? AND client_request_key=?', [user.id, key]);
    if(prior)
      return {id: prior.id, href: `/forum/topics/${id}/#reply-${prior.id}`};
    await limit(c, user, 'reply_create', RATE_LIMITS.reply_create);
    const post = await postLocked(c, id);
    if(parent){
      const [target] = await rows(c, 'SELECT id,status FROM forum_post_replies WHERE id=? AND post_id=?', [parent, id]);
      if(!target || target.status !== 'published')
        fail('invalid_reply_target');
    }
    const sequence = Number(post.next_sequence);
    const now = new Date();
    const created = await rows(c, 'INSERT INTO forum_post_replies(post_id,poster_id,parent_reply,sequence,content,client_request_key,created_at) VALUES (?,?,?,?,?,?,?)', [id, user.id, parent, sequence, content, key, now]);
    await rows(c, 'UPDATE forum_posts SET next_sequence=next_sequence+1,reply_count=reply_count+1,last_activity_at=? WHERE id=?', [now, id]);
    // 楼主和被回复的人各通知一次（Set 去重：楼主回复自己时不重复发）。
    const targets = new Set([Number(post.poster_id)]);
    if(parent){
      const [target] = await rows(c, 'SELECT poster_id FROM forum_post_replies WHERE id=?', [parent]);
      targets.add(Number(target.poster_id));
    }
    for(const receiver of targets)
      await notice(c, receiver, user.id, 'reply', 'reply', created.insertId, `reply:${created.insertId}`);
    return {id: created.insertId, href: `/forum/topics/${id}/#reply-${created.insertId}`};
  }).catch(error => {
    if(error.code !== 'ER_DUP_ENTRY')
      throw error;
    return select('SELECT id FROM forum_post_replies WHERE poster_id=? AND client_request_key=?', [user.id, key])
      .then(([row]) => row? {id: row.id, href: `/forum/topics/${id}/#reply-${row.id}`}: Promise.reject(error));
  });
}

/**
 * 重算帖子的回复数与最后活动时间（删回复之后用）。
 * @param {object} c 事务连接。
 * @param {string|number} id 帖子编号。
 * @returns {Promise<void>} 无。
 */
async function recalcPost(c, id){
  const [row] = await rows(c, "SELECT COUNT(*) AS n,MAX(created_at) AS latest FROM forum_post_replies WHERE post_id=? AND status='published'", [id]);
  await rows(c, 'UPDATE forum_posts SET reply_count=?,last_activity_at=COALESCE(?,last_activity_at) WHERE id=?', [row.n, row.latest, id]);
}

/**
 * 删自己的帖子/回复（软删：status 改成 deleted_by_author，别人再也看不到）。
 *
 * 已经删过的重复调用直接返回 ok —— 前端重试不该报错。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string} kind post / reply。
 * @param {string|number} id 内容编号。
 * @returns {Promise<{ok: boolean}>} 结果。
 */
export async function deleteContent(user, key, kind, id){
  id = idOf(id);
  const {table} = contentOf(kind);
  return write(user, key, `${kind}.delete`, async c => {
    // 不走 targetLocked：它把「非 published」当 404，而重复删除应该幂等返回 ok。
    // 但锁顺序要跟它一致：删回复时先把所属帖锁上（收尾的 recalcPost 会 UPDATE 帖子）。
    if(kind === 'reply'){
      const [ref] = await rows(c, 'SELECT post_id FROM forum_post_replies WHERE id=?', [id]);
      if(!ref)
        fail('not_found', 404);
      await lockPost(c, ref.post_id);
    }
    const [row] = await rows(c, `SELECT id,poster_id,status${kind === 'reply'? ',post_id': ''} FROM ${table} WHERE id=? FOR UPDATE`, [id]);
    if(!row)
      fail('not_found', 404);
    if(Number(row.poster_id) !== Number(user.id))
      fail('forbidden', 403);
    if(row.status === 'deleted_by_author')
      return {ok: true};
    // 被举报删掉的内容不能再由作者「删一次」改变状态。
    if(row.status !== 'published')
      fail('content_unavailable', 409);
    await rows(c, `UPDATE ${table} SET status='deleted_by_author' WHERE id=?`, [id]);
    if(kind === 'reply')
      await recalcPost(c, row.post_id);
    return {ok: true};
  });
}

/**
 * 投票：-1 踩 / 0 取消 / 1 顶。自己的内容不能投（self_vote）。
 *
 * 表里存的是 `vote_type`（up / down），取消是把行删掉 —— 没有「第三种状态」。
 * 返回值仍用 -1/0/1，前端不用改。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string} kind post / reply。
 * @param {string|number} id 内容编号。
 * @param {number} value -1 / 0 / 1。
 * @returns {Promise<{up: number, down: number, mine: number}>} 投票状态。
 */
export async function vote(user, key, kind, id, value){
  id = idOf(id);
  if(![-1, 0, 1].includes(value))
    fail('invalid_vote');
  const {votes, column} = contentOf(kind);
  return write(user, key, `${kind}.vote`, async c => {
    const {item, post} = await targetLocked(c, kind, id);
    if(post && post.status !== 'published')
      fail('content_unavailable', 409);
    if(Number(item.poster_id) === Number(user.id))
      fail('self_vote', 403);
    if(value === 0)
      await rows(c, `DELETE FROM ${votes} WHERE ${column}=? AND voter=?`, [id, user.id]);
    else
      await rows(c, `INSERT INTO ${votes}(${column},voter,vote_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE vote_type=VALUES(vote_type)`, [id, user.id, value === 1? 'up': 'down']);
    if(value === 1)
      await notice(c, item.poster_id, user.id, 'like', kind, id, `like:${kind}:${id}:${user.id}`);
    return await voteState(c, kind, id, user.id);
  });
}

/**
 * 读一条内容的投票状态。`userId` 为 0 时 `mine` 恒为 0（访客）。
 * 导出只为给 read.mjs 用（列表与详情要显示票数）；它需要事务连接，不适合当公开接口。
 * @param {object} c 事务连接。
 * @param {string} kind post / reply。
 * @param {string|number} id 内容编号。
 * @param {number} [userId] 当前用户。
 * @returns {Promise<{up: number, down: number, mine: number}>} 投票状态。
 */
export async function voteState(c, kind, id, userId){
  const {votes, column} = contentOf(kind);
  const [state] = await rows(c, `SELECT COALESCE(SUM(vote_type='up'),0) AS up,COALESCE(SUM(vote_type='down'),0) AS down,COALESCE(MAX(CASE WHEN voter=? THEN vote_type END),'') AS mine FROM ${votes} WHERE ${column}=?`, [userId || 0, id]);
  return {up: Number(state.up), down: Number(state.down), mine: state.mine === 'up'? 1: state.mine === 'down'? -1: 0};
}

/**
 * 关注/取关一个人。不能关注自己，也不能关注被封禁的账号。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string|number} id 目标用户。
 * @param {boolean} enabled 关注还是取关。
 * @returns {Promise<{enabled: boolean}>} 结果。
 */
export async function follow(user, key, id, enabled){
  id = idOf(id);
  if(typeof enabled !== 'boolean')
    fail('invalid_state');
  return write(user, key, 'follow', async c => {
    if(id === Number(user.id))
      fail('self_follow', 403);
    const [target] = await rows(c, 'SELECT u.id,m.type,m.expired_at FROM users u LEFT JOIN forum_member_roles m ON m.member_id=u.id WHERE u.id=?', [id]);
    if(!target || memberType(target) === 'ban')
      fail('not_found', 404);
    if(enabled){
      await rows(c, 'INSERT IGNORE INTO forum_follows(follower_id,followed_id,created_at) VALUES (?,?,?)', [user.id, id, new Date()]);
      await notice(c, id, user.id, 'follow', 'user', user.id, `follow:${user.id}`);
    }
    else
      await rows(c, 'DELETE FROM forum_follows WHERE follower_id=? AND followed_id=?', [user.id, id]);
    return {enabled};
  });
}

/**
 * 收藏/取消收藏帖子。返回最新的收藏数，卡片上的数字不用再查一次。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string|number} id 帖子编号。
 * @param {boolean} enabled 收藏还是取消。
 * @returns {Promise<{enabled: boolean, count: number}>} 结果。
 */
export async function bookmark(user, key, id, enabled){
  id = idOf(id);
  if(typeof enabled !== 'boolean')
    fail('invalid_state');
  return write(user, key, 'bookmark', async c => {
    if(enabled){
      await postLocked(c, id);
      await rows(c, 'INSERT IGNORE INTO forum_post_bookmarks(user_id,post_id,created_at) VALUES (?,?,?)', [user.id, id, new Date()]);
    }
    else
      await rows(c, 'DELETE FROM forum_post_bookmarks WHERE user_id=? AND post_id=?', [user.id, id]);
    const [{total}] = await rows(c, 'SELECT COUNT(*) AS total FROM forum_post_bookmarks WHERE post_id=?', [id]);
    return {enabled, count: Number(total)};
  });
}

/**
 * 举报内容。同一人一小时最多 10 条；对同一条内容 24 小时内只能报一次（report_cooldown）。
 * 帖子与回复各一张表；还在处理中的重复举报由 `open_key` 唯一索引兜住，直接返回原编号。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {object} data 请求体（type / id / reason / detail）。
 * @returns {Promise<{id: number}>} 举报编号。
 */
export async function report(user, key, data){
  const kind = data.type;
  const {reports, column} = contentOf(kind);  // 认不出的种类回 404。
  const id = idOf(data.id);
  const reason = text(data.reason, 1, 32);
  const detail = text(data.detail || '', reason === '其他'? 5: 0, 1000);
  if(!reportReasons.includes(reason))
    fail('invalid_reason');
  return write(user, key, 'report', async c => {
    const {item, post} = await targetLocked(c, kind, id);
    if(post && post.status !== 'published')
      fail('content_unavailable', 409);
    const [prior] = await rows(c, `SELECT id FROM ${reports} WHERE reporter_id=? AND ${column}=? AND status IN('open','reviewing')`, [user.id, id]);
    if(prior)
      return {id: prior.id};
    const [recent] = await rows(c, `SELECT created_at FROM ${reports} WHERE reporter_id=? AND ${column}=? ORDER BY id DESC LIMIT 1`, [user.id, id]);
    if(recent && Date.now() - new Date(recent.created_at) < 86400000)
      fail('report_cooldown', 429);
    const now = new Date();
    const targetPost = kind === 'post'? id: item.post_id;
    const created = kind === 'post'
      ? await rows(c, 'INSERT INTO forum_post_reports(post_id,reporter_id,category,detail,created_at,updated_at) VALUES (?,?,?,?,?,?)', [id, user.id, reason, detail, now, now])
      : await rows(c, 'INSERT INTO forum_reply_reports(reply_id,post_id,reporter_id,category,detail,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [id, targetPost, user.id, reason, detail, now, now]);
    return {id: created.insertId};
  });
}

/**
 * 撤回自己还没被受理的举报。
 *
 * 两张举报表各自自增、编号会撞，所以 `kind`（post / reply）必传：光凭编号分不清是哪一张。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string} kind post / reply。
 * @param {string|number} id 举报编号。
 * @returns {Promise<{ok: boolean}>} 结果。
 */
export async function withdrawReport(user, key, kind, id){
  id = idOf(id);
  const {reports} = contentOf(kind);
  return write(user, key, 'report.withdraw', async c => {
    const [row] = await rows(c, `SELECT id,reporter_id,status FROM ${reports} WHERE id=? FOR UPDATE`, [id]);
    if(!row)
      fail('not_found', 404);
    if(Number(row.reporter_id) !== Number(user.id))
      fail('not_found', 404);
    if(row.status === 'withdrawn')
      return {ok: true};
    // 只有「还没人受理」的才允许撤回；进入 reviewing 之后就不能反悔了。
    if(row.status !== 'open')
      fail('report_in_progress', 409);
    await rows(c, `UPDATE ${reports} SET status='withdrawn',version=version+1,updated_at=? WHERE id=?`, [new Date(), id]);
    return {ok: true};
  });
}

// ======================= 审核 =======================

/**
 * 处理一条举报：领取 / 成立 / 驳回 / 恢复。
 * TODO: 上线审核时再审查
 *
 * 没有 hidden 这个状态，所以：
 *   · uphold  → 把内容标成 deleted_by_report（对所有人不可见）
 *   · restore → 只有 admin 能把 deleted_by_report 改回 published（误判翻案）
 * 处理不再叠加禁言，也不写审计表（`resolution` 就是处理理由）。
 * `kind` 必传：两张举报表各自自增，光凭编号分不清是哪一张。
 * @param {string|number} actorId 操作人编号。
 * @param {object} input 参数（kind / reportId / version / action / reason）。
 * @returns {Promise<{id: number, status: string, version: number}>} 新状态。
 */
export async function moderation(actorId, {kind, reportId, version, action, reason}){
  actorId = idOf(actorId);
  reportId = idOf(reportId);
  reason = text(reason, 3, 1000);
  if(!['claim', 'uphold', 'dismiss', 'restore'].includes(action))
    fail('invalid_action');
  const {reports, table, column} = contentOf(kind);
  return transaction(async c => {
    const [role] = await rows(c, 'SELECT type,expired_at FROM forum_member_roles WHERE member_id=?', [actorId]);
    if(!isStaff(role))
      fail('forbidden', 403);
    const [report] = await rows(c, `SELECT * FROM ${reports} WHERE id=? FOR UPDATE`, [reportId]);
    if(!report)
      fail('not_found', 404);
    // 版本号是乐观锁：两个人同时处理同一条时，后到的失败而不是覆盖。
    if(Number(report.version) !== Number(version))
      fail('version_conflict', 409);
    if(action !== 'restore' && !['open', 'reviewing'].includes(report.status))
      fail('report_closed', 409);
    if(action === 'restore' && report.status !== 'upheld')
      fail('report_closed', 409);
    if(report.assignee && Number(report.assignee) !== actorId && role.type !== 'admin')
      fail('report_assigned', 403);
    const contentId = Number(report[column]);
    // 锁顺序：先帖、后回复（与 targetLocked 一致）。回复举报行上带冗余的 post_id，不用多查一次。
    if(kind === 'reply')
      await lockPost(c, report.post_id);
    const [item] = await rows(c, `SELECT * FROM ${table} WHERE id=? FOR UPDATE`, [contentId]);
    if(!item)
      fail('not_found', 404);
    const status = action === 'claim'? 'reviewing': action === 'uphold'? 'upheld': action === 'dismiss'? 'dismissed': report.status;
    if(action === 'restore' && item.status !== 'deleted_by_report')
      fail('content_unavailable', 409);
    if(action === 'uphold' && item.status === 'published')
      await rows(c, `UPDATE ${table} SET status='deleted_by_report' WHERE id=?`, [contentId]);
    if(action === 'restore')
      await rows(c, `UPDATE ${table} SET status='published' WHERE id=?`, [contentId]);
    if(kind === 'reply')
      await recalcPost(c, report.post_id);
    // restore 不覆盖 resolution：结案理由记的是「第一次处理时为什么」，恢复只是撤销处置。
    // 否则举报人的历史通知文案会被后来的结论改掉（旧实现靠 audit 存每次理由，audit 删了就没有了）。
    if(action === 'restore')
      await rows(c, `UPDATE ${reports} SET status=?,assignee=?,version=version+1,updated_at=? WHERE id=?`, [status, report.assignee, new Date(), reportId]);
    else
      await rows(c, `UPDATE ${reports} SET status=?,resolution=?,assignee=?,version=version+1,updated_at=? WHERE id=?`, [status, reason, actorId, new Date(), reportId]);
    // 领取只是「我接下了」，不打扰任何人；处理完才通知举报人，恢复只通知内容作者。
    // 举报通知的 target_type 用「post_report / reply_report」：两张举报表编号会撞，必须带种类。
    if(['uphold', 'dismiss'].includes(action))
      await notice(c, report.reporter_id, actorId, 'report_result', `${kind}_report`, reportId, `report:${kind}:${reportId}:${report.version + 1}`);
    if(action === 'restore')
      await notice(c, item.poster_id, actorId, 'content_restored', kind, contentId, `moderation:${kind}:${reportId}:${report.version + 1}`);
    if(action === 'uphold')
      await notice(c, item.poster_id, actorId, 'content_deleted', kind, contentId, `moderation:${kind}:${reportId}:${report.version + 1}`);
    return {id: reportId, status, version: report.version + 1};
  });
}

/**
 * 审核台：待处理清单，或按编号取一条。
 * TODO: 上线审核时再审查、拆分
 *
 * 两张表 UNION 时带 `kind` 列 —— 编号会在两张表里重复，光看 id 分不清是哪一类。
 * @param {string|number} actorId 操作人编号。
 * @param {string|number} [id] 举报编号（需要同时给 kind 才能唯一定位）。
 * @param {string} [kind] post / reply。
 * @returns {Promise<Array<object>>} 举报行。
 */
export async function listReports(actorId, id, kind){
  const [role] = await select('SELECT type,expired_at FROM forum_member_roles WHERE member_id=?', [idOf(actorId)]);
  if(!isStaff(role))
    fail('forbidden', 403);
  if(id){
    const {reports} = contentOf(kind);
    return select(`SELECT *,? AS kind FROM ${reports} WHERE id=?`, [kind, idOf(id)]);
  }
  // 两张举报表 UNION：编号会在两张表里重复，所以每行都带 `kind`。
  // 表名与列名从 CONTENT 派生（key 是我们自己的常量，不是外部输入）——加第三种内容不用改这里。
  const union = Object.entries(CONTENT)
    .map(([key, entry]) => `SELECT id,'${key}' AS kind,${entry.column} AS target_id,category AS reason,status,version,assignee,created_at FROM ${entry.reports} WHERE status IN('open','reviewing')`)
    .join(' UNION ALL ');
  return select(`${union} ORDER BY id LIMIT 100`);
}
