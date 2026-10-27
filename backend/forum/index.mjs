// 论坛的核心：表结构、幂等写、帖子与回复、互动（投票/关注/收藏/举报）、审核。
//
// 论坛拆成四个文件，按「改东西时你会打开哪个」分，而不是按技术层分：
//   index.mjs   —— 写路径与数据模型：加字段、改校验、改权限都从这里进
//   read.mjs    —— 读路径与通知：列表、详情、我的内容、红点
//   images.mjs  —— 图片管线：上传、裁剪、存储适配器、清理草稿
//   routes.mjs  —— HTTP 边界：/forum/* 页面与 /api/forum/* 接口
//
// 依赖方向（只许往下）：
//   community.mjs  公共原语（错误类型、编号解析、成员校验）—— 谁都可以用，它谁也不认识
//   dm.mjs          私信业务 —— 只认识 community
//   本文件          论坛的写与模型 —— 认识 community 与 dm（消息页要读私信数据）
//   read.mjs / images.mjs —— 认识本文件，本文件不认识它们
//   routes.mjs —— 认识上面全部
//
// 读代码时的两个入口：
//   写内容 → write()：幂等键 + 摘要 + 限流，所有写动作都从它进事务
//   改模型 → forumSchema：建表语句，末尾 migrateForum 负责幂等迁移
import {createHash} from 'node:crypto';

import {categories, reportReasons} from '../../content/forum.mjs';
import {checkMember, fail, idOf, rows, text} from './base.mjs';
import {select, transaction} from '../db.mjs';
import * as dm from './dm.mjs';
import {forumImagePath, postImageSources} from '../../src/markdown.mjs';

// ======================= 小工具 =======================

/** 分类校验：不在白名单里就是 invalid_category。读列表按分类筛选时也要用，所以导出给 read.mjs。 */
export const categoryOf = value => {
  if(!categories.some(category => category.id === value))
    fail('invalid_category');
  return value;
};

/** 内容类型 → 表名。`kind` 只有 topic / reply 两种，别的一律 404。 */
const tableOf = kind => kind === 'topic'? 'forum_topics': kind === 'reply'? 'forum_replies': fail('not_found', 404);

/** 内容类型 → 投票表名。 */
const voteTable = kind => kind === 'topic'? 'forum_topic_votes': 'forum_reply_votes';

// ======================= 幂等写 =======================

/**
 * 每小时每个动作的上限。`write()` 里对其他动作统一 120，发帖/回复/举报另有更紧的上限（见各自的调用处）。
 * 导出只为给 images.mjs 用（上传另有更紧的上限）；对站内其它模块它不是接口。
 * @param {object} c 事务连接。
 * @param {object} user 当前用户。
 * @param {string} action 动作名。
 * @param {number} max 上限次数。
 * @param {number} [seconds=3600] 统计窗口（秒）。
 * @returns {Promise<void>} 无。
 */
export async function limit(c, user, action, max, seconds = 3600){
  const [count] = await rows(c, 'SELECT COUNT(*) AS n FROM forum_write_requests WHERE user_id=? AND action=? AND created_at>?', [user.id, action, new Date(Date.now() - seconds * 1000)]);
  if(count.n >= max)
    fail('rate_limited', 429);
}

/**
 * 幂等写：同一个 (用户, 幂等键) 只执行一次 work，重放返回第一次的结果。
 *
 * 这是所有写动作（发帖、回复、投票、举报、上传图片…）的总闸门，做三件事：
 *   1. 校验幂等键格式（8–80 位），没有键就不许写 —— 网络重试才不会写出两条；
 *   2. 摘要比对：同一个键换了内容说明客户端用错键，409 而不是悄悄按新的写；
 *   3. 写请求表里留一行（digest + 结果），既是幂等记录也是限流的计数依据。
 *
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string} action 动作名。
 * @param {unknown} payload 参与摘要的内容。
 * @param {Function} work 真正干活的事务函数。
 * @returns {Promise<unknown>} work 的返回值（或第一次执行的结果）。
 */
export async function write(user, key, action, payload, work){
  if(!/^[\w-]{8,80}$/.test(String(key ?? '')))
    fail('idempotency_required');
  const digest = createHash('sha256').update(JSON.stringify({action, payload})).digest('hex');
  return transaction(async c => {
    // 标记已读这类动作走宽松校验：被禁言的人也得能清红点。
    await checkMember(c, user, action === 'notifications.read');
    const [prior] = await rows(c, 'SELECT * FROM forum_write_requests WHERE user_id=? AND request_key=?', [user.id, key]);
    if(prior){
      if(prior.digest !== digest)
        fail('request_conflict', 409);
      return JSON.parse(prior.result);
    }
    await limit(c, user, action, 120);
    const result = await work(c);
    await rows(c, 'INSERT INTO forum_write_requests(user_id,request_key,digest,action,result,created_at) VALUES (?,?,?,?,?,?)', [user.id, key, digest, action, JSON.stringify(result), new Date()]);
    return result;
  });
}

/**
 * 写一条通知。自己给自己点赞/回复/关注不产生通知（`INSERT IGNORE` 再加 event_key 唯一索引去重）。
 * @param {object} c 事务连接。
 * @param {number} user 收件人。
 * @param {number} actor 触发者。
 * @param {string} kind 通知类型。
 * @param {string} type 目标类型。
 * @param {number} id 目标编号。
 * @param {string} key 事件键（同一件事只通知一次）。
 * @returns {Promise<void>} 无。
 */
async function notice(c, user, actor, kind, type, id, key){
  if(Number(user) === Number(actor) && ['reply', 'like', 'follow'].includes(kind))
    return;
  await rows(c, 'INSERT IGNORE INTO forum_notifications(user_id,actor_id,kind,target_type,target_id,event_key,created_at) VALUES (?,?,?,?,?,?,?)', [user, actor, kind, type, id, key, new Date()]);
}

// ======================= 帖子与回复 =======================

/**
 * 锁住一条主题并返回它。隐藏的主题按"不存在"处理，撤回的仍可读（由调用方决定怎么展示）。
 * @param {object} c 事务连接。
 * @param {string|number} id 主题编号。
 * @returns {Promise<object>} 主题行。
 */
async function topicLocked(c, id){
  const [topic] = await rows(c, 'SELECT * FROM forum_topics WHERE id=? FOR UPDATE', [id]);
  if(!topic || topic.status === 'hidden')
    fail('not_found', 404);
  return topic;
}

/**
 * 锁住一条内容（主题或回复），同时把所属主题也锁上 —— 加锁顺序固定为先主题后回复，避免死锁。
 * @param {object} c 事务连接。
 * @param {string} kind topic / reply。
 * @param {string|number} id 内容编号。
 * @returns {Promise<{item: object, topic: object|null}>} 内容与所属主题（主题本身时为 null）。
 */
async function targetLocked(c, kind, id){
  if(kind === 'topic')
    return {item: await topicLocked(c, id), topic: null};
  tableOf(kind);
  const [ref] = await rows(c, 'SELECT topic_id FROM forum_replies WHERE id=?', [id]);
  if(!ref)
    fail('not_found', 404);
  const topic = await topicLocked(c, ref.topic_id);
  const [item] = await rows(c, 'SELECT * FROM forum_replies WHERE id=? FOR UPDATE', [id]);
  if(!item || item.status === 'hidden')
    fail('not_found', 404);
  return {item, topic};
}

/**
 * 发帖。正文里引用的图片必须是本人上传、还没挂到帖子上的草稿（7 天内），最多 9 张。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {object} data 请求体（title / body / category）。
 * @returns {Promise<{id: number, href: string}>} 新帖。
 */
export async function createTopic(user, key, data){
  const title = text(data.title, 4, 80);
  const body = text(data.body, 10, 15000);
  const category = categoryOf(data.category);
  const sources = postImageSources(body);
  if(sources.length > 9)
    fail('too_many_images');
  const imageIds = [...new Set(sources.map(src => {
    const match = String(src).match(forumImagePath);
    if(!match)
      fail('invalid_image_reference');
    return match[1];
  }))];
  return write(user, key, 'topic.create', {title, body, category}, async c => {
    await limit(c, user, 'topic.create', 3);
    const now = new Date();
    if(imageIds.length){
      // 只认"自己的、还没归属帖子、7 天内"的草稿图，防止把别人的图挂到自己帖子上。
      const images = await rows(c, `SELECT id,owner_id,topic_id,created_at FROM forum_images WHERE id IN (${imageIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, imageIds);
      if(images.length !== imageIds.length || images.some(image => Number(image.owner_id) !== Number(user.id) || image.topic_id || new Date(image.created_at) < new Date(Date.now() - 7 * 86400000)))
        fail('invalid_image_reference');
    }
    const result = await rows(c, 'INSERT INTO forum_topics(author_id,category,title,body,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [user.id, category, title, body, now, now, now]);
    if(imageIds.length)
      await rows(c, `UPDATE forum_images SET topic_id=? WHERE id IN (${imageIds.map(() => '?').join(',')})`, [result.insertId, ...imageIds]);
    return {id: result.insertId, href: `/forum/topics/${result.insertId}/`};
  });
}

/**
 * 回帖（`parentId` 给了就是楼中楼）。回复数用 `reply_count+1` 增量更新，另有 recalcTopic 兜底重算。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string|number} id 主题编号。
 * @param {object} data 请求体（body / parentId）。
 * @returns {Promise<{id: number, href: string}>} 新回复。
 */
export async function createReply(user, key, id, data){
  id = idOf(id);
  const body = text(data.body, 1, 3000);
  const parent = data.parentId? idOf(data.parentId): null;
  return write(user, key, 'reply.create', {id, body, parent}, async c => {
    await limit(c, user, 'reply.create', 20);
    const topic = await topicLocked(c, id);
    if(topic.status !== 'published')
      fail('topic_closed', 409);
    if(parent){
      const [target] = await rows(c, 'SELECT * FROM forum_replies WHERE id=? AND topic_id=?', [parent, id]);
      if(!target || target.status !== 'published')
        fail('invalid_reply_target');
    }
    // 序号是"这条主题下第几楼"，并发时靠 uniq_reply_sequence 兜底。
    const [{n}] = await rows(c, 'SELECT COALESCE(MAX(sequence),0)+1 AS n FROM forum_replies WHERE topic_id=?', [id]);
    const now = new Date();
    const reply = await rows(c, 'INSERT INTO forum_replies(topic_id,author_id,parent_id,body,sequence,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [id, user.id, parent, body, n, now, now]);
    await rows(c, 'UPDATE forum_topics SET reply_count=reply_count+1,last_activity_at=? WHERE id=?', [now, id]);
    // 楼主和被回复的人各通知一次（Set 去重：楼主回复自己时不重复发）。
    const targetUsers = new Set([Number(topic.author_id)]);
    if(parent){
      const [target] = await rows(c, 'SELECT author_id FROM forum_replies WHERE id=?', [parent]);
      targetUsers.add(Number(target.author_id));
    }
    for(const target of targetUsers)
      await notice(c, target, user.id, 'reply', 'reply', reply.insertId, `reply:${reply.insertId}`);
    return {id: reply.insertId, href: `/forum/topics/${id}/#reply-${reply.insertId}`};
  });
}

/**
 * 重算主题的回复数与最后活动时间（撤回回复之后用）。
 * @param {object} c 事务连接。
 * @param {string|number} id 主题编号。
 * @returns {Promise<void>} 无。
 */
async function recalcTopic(c, id){
  const [row] = await rows(c, "SELECT COUNT(*) AS n,MAX(created_at) AS latest FROM forum_replies WHERE topic_id=? AND status='published'", [id]);
  await rows(c, 'UPDATE forum_topics SET reply_count=?,last_activity_at=COALESCE(?,created_at) WHERE id=?', [row.n, row.latest, id]);
}

/**
 * 撤回自己的帖子/回复。已撤回的重复调用直接返回 ok（幂等由 write 兜住，这里再兜一层）。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string} kind topic / reply。
 * @param {string|number} id 内容编号。
 * @returns {Promise<{ok: boolean}>} 结果。
 */
export async function withdrawContent(user, key, kind, id){
  id = idOf(id);
  return write(user, key, `${kind}.withdraw`, {id}, async c => {
    const {item} = await targetLocked(c, kind, id);
    if(Number(item.author_id) !== Number(user.id))
      fail('forbidden', 403);
    if(item.status === 'withdrawn')
      return {ok: true};
    await rows(c, `UPDATE ${tableOf(kind)} SET status='withdrawn',version=version+1,updated_at=? WHERE id=?`, [new Date(), id]);
    if(kind === 'reply')
      await recalcTopic(c, item.topic_id);
    return {ok: true};
  });
}

/**
 * 投票：-1 踩 / 0 取消 / 1 顶。自己的内容不能投（self_vote）。
 * 返回值里带最新的上下票数与"我投了什么"，前端不用再请求一次。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string} kind topic / reply。
 * @param {string|number} id 内容编号。
 * @param {number} value -1 / 0 / 1。
 * @returns {Promise<{up: number, down: number, mine: number}>} 投票状态。
 */
export async function vote(user, key, kind, id, value){
  id = idOf(id);
  if(![-1, 0, 1].includes(value))
    fail('invalid_vote');
  return write(user, key, `${kind}.vote`, {id, value}, async c => {
    const {item, topic} = await targetLocked(c, kind, id);
    if(item.status !== 'published' || topic && topic.status !== 'published')
      fail('content_unavailable', 409);
    if(Number(item.author_id) === Number(user.id))
      fail('self_vote', 403);
    if(value === 0)
      await rows(c, `DELETE FROM ${voteTable(kind)} WHERE target_id=? AND user_id=?`, [id, user.id]);
    else
      await rows(c, `INSERT INTO ${voteTable(kind)}(target_id,user_id,value) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)`, [id, user.id, value]);
    if(value === 1)
      await notice(c, item.author_id, user.id, 'like', kind, id, `like:${kind}:${id}:${user.id}`);
    return await voteState(c, kind, id, user.id);
  });
}

/**
 * 读一条内容的投票状态。`userId` 为 0 时 `mine` 恒为 0（访客）。
 * 导出只为给 read.mjs 用（列表与详情要显示票数）；它需要事务连接，不适合当公开接口。
 * @param {object} c 事务连接。
 * @param {string} kind topic / reply。
 * @param {string|number} id 内容编号。
 * @param {number} [userId] 当前用户。
 * @returns {Promise<{up: number, down: number, mine: number}>} 投票状态。
 */
export async function voteState(c, kind, id, userId){
  const [state] = await rows(c, `SELECT COALESCE(SUM(value=1),0) AS up,COALESCE(SUM(value=-1),0) AS down,COALESCE(MAX(CASE WHEN user_id=? THEN value END),0) AS mine FROM ${voteTable(kind)} WHERE target_id=?`, [userId || 0, id]);
  return {up: Number(state.up), down: Number(state.down), mine: Number(state.mine)};
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
  return write(user, key, 'follow', {id, enabled}, async c => {
    if(id === Number(user.id))
      fail('self_follow', 403);
    const [target] = await rows(c, 'SELECT u.id,m.banned_at FROM users u LEFT JOIN forum_members m ON m.user_id=u.id WHERE u.id=?', [id]);
    if(!target || target.banned_at)
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
 * @param {string|number} id 主题编号。
 * @param {boolean} enabled 收藏还是取消。
 * @returns {Promise<{enabled: boolean, count: number}>} 结果。
 */
export async function bookmark(user, key, id, enabled){
  id = idOf(id);
  if(typeof enabled !== 'boolean')
    fail('invalid_state');
  return write(user, key, 'bookmark', {id, enabled}, async c => {
    if(enabled){
      const topic = await topicLocked(c, id);
      if(topic.status !== 'published')
        fail('content_unavailable', 409);
      await rows(c, 'INSERT IGNORE INTO forum_bookmarks(user_id,topic_id,created_at) VALUES (?,?,?)', [user.id, id, new Date()]);
    }
    else
      await rows(c, 'DELETE FROM forum_bookmarks WHERE user_id=? AND topic_id=?', [user.id, id]);
    const [{total}] = await rows(c, 'SELECT COUNT(*) AS total FROM forum_bookmarks WHERE topic_id=?', [id]);
    return {enabled, count: Number(total)};
  });
}

/**
 * 举报内容。同一人一小时最多 10 条；对同一条内容 24 小时内只能报一次（report_cooldown）。
 * 重复举报靠 open_key 唯一索引兜：还在处理中的那条直接返回原编号。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {object} data 请求体（type / id / reason / details）。
 * @returns {Promise<{id: number}>} 举报编号。
 */
export async function report(user, key, data){
  const kind = data.type;
  tableOf(kind);
  const id = idOf(data.id);
  const reason = text(data.reason, 1, 32);
  const details = text(data.details || '', reason === '其他'? 5: 0, 1000);
  if(!reportReasons.includes(reason))
    fail('invalid_reason');
  return write(user, key, 'report', {kind, id, reason, details}, async c => {
    const {item, topic} = await targetLocked(c, kind, id);
    if(item.status !== 'published')
      fail('content_unavailable', 409);
    const [prior] = await rows(c, "SELECT id FROM forum_reports WHERE reporter_id=? AND target_type=? AND target_id=? AND status IN('open','reviewing')", [user.id, kind, id]);
    if(prior)
      return {id: prior.id};
    await limit(c, user, 'report', 10);
    const [recent] = await rows(c, 'SELECT created_at FROM forum_reports WHERE reporter_id=? AND target_type=? AND target_id=? ORDER BY id DESC LIMIT 1', [user.id, kind, id]);
    if(recent && Date.now() - new Date(recent.created_at) < 86400000)
      fail('report_cooldown', 429);
    const now = new Date();
    const created = await rows(c, 'INSERT INTO forum_reports(reporter_id,target_type,target_id,topic_id,reason,details,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [user.id, kind, id, topic?.id || item.id, reason, details, now, now]);
    return {id: created.insertId};
  });
}

/**
 * 撤回自己还没被受理的举报。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string|number} id 举报编号。
 * @returns {Promise<{ok: boolean}>} 结果。
 */
export async function withdrawReport(user, key, id){
  id = idOf(id);
  return write(user, key, 'report.withdraw', {id}, async c => {
    const [row] = await rows(c, 'SELECT * FROM forum_reports WHERE id=? FOR UPDATE', [id]);
    if(!row || Number(row.reporter_id) !== Number(user.id))
      fail('not_found', 404);
    if(row.status === 'withdrawn')
      return {ok: true};
    if(row.status !== 'open')
      fail('report_in_progress', 409);
    await rows(c, "UPDATE forum_reports SET status='withdrawn',version=version+1,updated_at=? WHERE id=?", [new Date(), id]);
    return {ok: true};
  });
}

// ======================= 审核 =======================

/**
 * 处理一条举报：领取 / 成立 / 驳回 / 恢复。
 *
 * 加锁顺序固定「主题 → 举报 → 内容」，和所有内容写路径一致，避免互相等待。
 * `restore` 只有管理员能做（把已经成立的处罚撤回，风险更高）。
 * @param {string|number} actorId 操作人编号。
 * @param {object} input 参数（reportId / version / action / reason）。
 * @returns {Promise<{id: number, status: string, version: number}>} 新状态。
 */
export async function moderation(actorId, {reportId, version, action, reason}){
  actorId = idOf(actorId);
  reportId = idOf(reportId);
  reason = text(reason, 3, 1000);
  if(!['claim', 'uphold', 'dismiss', 'restore'].includes(action))
    fail('invalid_action');
  return transaction(async c => {
    const [role] = await rows(c, 'SELECT role,banned_at FROM forum_members WHERE user_id=?', [actorId]);
    if(!role || role.banned_at || !['moderator', 'admin'].includes(role.role))
      fail('forbidden', 403);
    const [ref] = await rows(c, 'SELECT * FROM forum_reports WHERE id=?', [reportId]);
    if(!ref)
      fail('not_found', 404);
    // 先锁主题，再锁举报，最后锁内容 —— 与其它写路径保持同一顺序。
    const [topic] = await rows(c, 'SELECT * FROM forum_topics WHERE id=? FOR UPDATE', [ref.topic_id]);
    const [report] = await rows(c, 'SELECT * FROM forum_reports WHERE id=? FOR UPDATE', [reportId]);
    // 版本号是乐观锁：两个人同时处理同一条时，后到的失败而不是覆盖。
    if(report.version !== Number(version))
      fail('version_conflict', 409);
    if(action !== 'restore' && !['open', 'reviewing'].includes(report.status))
      fail('report_closed', 409);
    if(action === 'restore' && report.status !== 'upheld')
      fail('report_closed', 409);
    if(report.assigned_to && Number(report.assigned_to) !== actorId && role.role !== 'admin')
      fail('report_assigned', 403);
    const [target] = await rows(c, `SELECT * FROM ${tableOf(report.target_type)} WHERE id=? FOR UPDATE`, [report.target_id]);
    if(!target)
      fail('not_found', 404);
    const status = action === 'claim'? 'reviewing': action === 'uphold'? 'upheld': action === 'dismiss'? 'dismissed': report.status;
    if(action === 'restore' && target.status !== 'hidden')
      fail('content_unavailable', 409);
    if(action === 'uphold' && target.status === 'published')
      await rows(c, `UPDATE ${tableOf(report.target_type)} SET status='hidden',version=version+1,updated_at=? WHERE id=?`, [new Date(), target.id]);
    if(action === 'restore')
      await rows(c, `UPDATE ${tableOf(report.target_type)} SET status='published',version=version+1,updated_at=? WHERE id=?`, [new Date(), target.id]);
    if(report.target_type === 'reply')
      await recalcTopic(c, topic.id);
    await rows(c, 'UPDATE forum_reports SET status=?,resolution=?,assigned_to=?,version=version+1,updated_at=? WHERE id=?', [status, reason, actorId, new Date(), reportId]);
    const before = JSON.stringify({report: report.status, content: target.status});
    const after = JSON.stringify({report: status, action});
    const audit = await rows(c, 'INSERT INTO forum_audit(actor_id,action,target_type,target_id,reason,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?)', [actorId, action, report.target_type, report.target_id, reason, before, after, new Date()]);
    // 领取只是"我接下了"，不打扰任何人；其余动作都要通知举报人，处置内容时还要通知作者。
    if(action !== 'claim')
      await notice(c, report.reporter_id, actorId, 'report_result', 'report', reportId, `report:${reportId}:${report.version + 1}:${audit.insertId}`);
    if(action === 'restore' || action === 'uphold' && target.status === 'published')
      await notice(c, target.author_id, actorId, action === 'restore'? 'content_restored': 'content_hidden', report.target_type, report.target_id, `moderation:${reportId}:${report.version + 1}:${audit.insertId}`);
    return {id: reportId, status, version: report.version + 1};
  });
}

/**
 * 审核台：待处理清单，或按编号取一条。
 * @param {string|number} actorId 操作人编号。
 * @param {string|number} [id] 举报编号。
 * @returns {Promise<Array<object>>} 举报行。
 */
export async function listReports(actorId, id){
  const [role] = await select('SELECT role,banned_at FROM forum_members WHERE user_id=?', [idOf(actorId)]);
  if(!role || role.banned_at || !['admin', 'moderator'].includes(role.role))
    fail('forbidden', 403);
  if(id)
    return select('SELECT * FROM forum_reports WHERE id=?', [idOf(id)]);
  return select("SELECT id,target_type,target_id,reason,status,version,assigned_to,created_at FROM forum_reports WHERE status IN('open','reviewing') ORDER BY id LIMIT 100");
}

// ======================= 表结构 =======================

/**
 * 论坛的全部表。私信那几张在 dm.mjs 里，由 migrateForum 一起建。
 *
 * 索引不是装饰：`forum_topics` 的三个索引分别对应「按活动时间」「按分类」「按作者」三种列表，
 * 少一个就会有一条列表变成全表扫描。
 */
export const forumSchema = [
  `CREATE TABLE IF NOT EXISTS forum_schema_migrations (version VARCHAR(64) PRIMARY KEY, applied_at DATETIME NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS forum_members (
    user_id BIGINT UNSIGNED PRIMARY KEY, role ENUM('member','moderator','admin') NOT NULL DEFAULT 'member',
    suspended_until DATETIME NULL, banned_at DATETIME NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS forum_topics (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, author_id BIGINT UNSIGNED NOT NULL,
    category VARCHAR(24) NOT NULL, title VARCHAR(80) NOT NULL, body MEDIUMTEXT NOT NULL,
    status ENUM('published','withdrawn','hidden') NOT NULL DEFAULT 'published', version INT NOT NULL DEFAULT 1,
    reply_count INT NOT NULL DEFAULT 0, last_activity_at DATETIME NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
    FOREIGN KEY(author_id) REFERENCES users(id), INDEX idx_topics_activity(status,last_activity_at,id),
    INDEX idx_topics_category(status,category,last_activity_at,id), INDEX idx_topics_author(author_id,created_at,id))`,
  `CREATE TABLE IF NOT EXISTS forum_replies (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, topic_id BIGINT UNSIGNED NOT NULL, author_id BIGINT UNSIGNED NOT NULL,
    parent_id BIGINT UNSIGNED NULL, body TEXT NOT NULL, status ENUM('published','withdrawn','hidden') NOT NULL DEFAULT 'published',
    version INT NOT NULL DEFAULT 1, sequence INT NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
    FOREIGN KEY(topic_id) REFERENCES forum_topics(id), FOREIGN KEY(author_id) REFERENCES users(id),
    FOREIGN KEY(parent_id) REFERENCES forum_replies(id), UNIQUE KEY uniq_reply_sequence(topic_id,sequence),
    INDEX idx_replies_list(topic_id,sequence), INDEX idx_replies_author(author_id,created_at),INDEX idx_replies_own(topic_id,author_id,status,sequence))`,
  `CREATE TABLE IF NOT EXISTS forum_image_blobs (storage_key VARCHAR(80) PRIMARY KEY,content MEDIUMBLOB NOT NULL) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS forum_images (
    id CHAR(36) PRIMARY KEY,owner_id BIGINT UNSIGNED NOT NULL,topic_id BIGINT UNSIGNED NULL,
    storage_driver VARCHAR(32) NOT NULL,storage_key VARCHAR(80) NOT NULL,content_type VARCHAR(32) NOT NULL,
    byte_size INT UNSIGNED NOT NULL,width SMALLINT UNSIGNED NOT NULL,height SMALLINT UNSIGNED NOT NULL,
    etag CHAR(64) NOT NULL,created_at DATETIME NOT NULL,
    UNIQUE KEY uniq_forum_image_object(storage_driver,storage_key),INDEX idx_forum_images_drafts(topic_id,created_at),
    FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(topic_id) REFERENCES forum_topics(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  ...['topic', 'reply'].map(kind => `CREATE TABLE IF NOT EXISTS forum_${kind}_votes (
    target_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, value TINYINT NOT NULL,
    PRIMARY KEY(target_id,user_id), CHECK(value IN(-1,1)),
    FOREIGN KEY(target_id) REFERENCES forum_${kind === 'topic'? 'topics': 'replies'}(id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`),
  `CREATE TABLE IF NOT EXISTS forum_follows (
    follower_id BIGINT UNSIGNED NOT NULL, followed_id BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL,
    PRIMARY KEY(follower_id,followed_id), INDEX idx_fans(followed_id,follower_id), CHECK(follower_id<>followed_id),
    FOREIGN KEY(follower_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(followed_id) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS forum_bookmarks (
    user_id BIGINT UNSIGNED NOT NULL, topic_id BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL,
    PRIMARY KEY(user_id,topic_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(topic_id) REFERENCES forum_topics(id))`,
  `CREATE TABLE IF NOT EXISTS forum_notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, actor_id BIGINT UNSIGNED NULL,
    kind VARCHAR(24) NOT NULL, target_type VARCHAR(16) NOT NULL, target_id BIGINT UNSIGNED NOT NULL,
    event_key VARCHAR(160) NOT NULL, read_at DATETIME NULL, created_at DATETIME NOT NULL,
    UNIQUE KEY uniq_notice(user_id,event_key), INDEX idx_notice_user(user_id,id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL)`,
  `CREATE TABLE IF NOT EXISTS forum_reports (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, reporter_id BIGINT UNSIGNED NOT NULL,
    target_type ENUM('topic','reply') NOT NULL, target_id BIGINT UNSIGNED NOT NULL, topic_id BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(32) NOT NULL, details TEXT NOT NULL, status ENUM('open','reviewing','upheld','dismissed','withdrawn') NOT NULL DEFAULT 'open',
    assigned_to BIGINT UNSIGNED NULL, resolution TEXT NULL, version INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
    open_key VARCHAR(120) GENERATED ALWAYS AS (CASE WHEN status IN ('open','reviewing') THEN CONCAT(reporter_id,':',target_type,':',target_id) ELSE NULL END) STORED,
    UNIQUE KEY uniq_open_report(open_key), INDEX idx_reports_owner(reporter_id,id),
    FOREIGN KEY(reporter_id) REFERENCES users(id), FOREIGN KEY(topic_id) REFERENCES forum_topics(id), FOREIGN KEY(assigned_to) REFERENCES users(id))`,
  `CREATE TABLE IF NOT EXISTS forum_audit (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, actor_id BIGINT UNSIGNED NOT NULL, action VARCHAR(32) NOT NULL,
    target_type VARCHAR(16) NOT NULL, target_id BIGINT UNSIGNED NOT NULL, reason TEXT NOT NULL,
    before_state TEXT NOT NULL, after_state TEXT NOT NULL, created_at DATETIME NOT NULL, FOREIGN KEY(actor_id) REFERENCES users(id))`,
  `CREATE TABLE IF NOT EXISTS forum_revisions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, target_type VARCHAR(16) NOT NULL, target_id BIGINT UNSIGNED NOT NULL,
    actor_id BIGINT UNSIGNED NOT NULL, version INT NOT NULL, content MEDIUMTEXT NOT NULL, created_at DATETIME NOT NULL,
    UNIQUE KEY uniq_revision(target_type,target_id,version), FOREIGN KEY(actor_id) REFERENCES users(id))`,
  `CREATE TABLE IF NOT EXISTS forum_write_requests (
    user_id BIGINT UNSIGNED NOT NULL, request_key VARCHAR(80) NOT NULL, digest CHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL, result TEXT NOT NULL, created_at DATETIME NOT NULL,
    PRIMARY KEY(user_id,request_key), INDEX idx_write_rate(user_id,action,created_at), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`
];

/**
 * 建表 + 增量升级。可反复执行。
 *
 * MySQL 的 DDL 会隐式提交，事务在这里只能保证「拿到锁 → 建完 → 放锁」这段不会被打断，
 * 真正的并发保护靠具名咨询锁。每一步升级都往 forum_schema_migrations 里记一行，重复执行无副作用。
 * @returns {Promise<void>} 无。
 */
export async function migrateForum(){
  await transaction(async connection => {
    const [[lock]] = await connection.query("SELECT GET_LOCK('nanocamp_forum_migration',10) AS acquired");
    if(!lock.acquired)
      throw new Error('Forum migration is already running');
    try{
      for(const sql of forumSchema)
        await connection.query(sql);
      // 私信的表也在这里建：它们有外键依赖 users 与 forum_*，顺序放在论坛表之后。
      await dm.migrateDirectMessages(connection);
      await connection.execute('INSERT IGNORE INTO forum_schema_migrations(version,applied_at) VALUES (?,?)', ['forum-dm-v1', new Date()]);
      // 早期版本的 forum_replies 没有 idx_replies_own，这里补上（information_schema 判一下，避免重复加索引报错）。
      const [ownIndex] = await connection.query("SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='forum_replies' AND index_name='idx_replies_own' LIMIT 1");
      if(!ownIndex.length)
        await connection.query('ALTER TABLE forum_replies ADD INDEX idx_replies_own(topic_id,author_id,status,sequence)');
      await connection.execute('INSERT IGNORE INTO forum_schema_migrations(version,applied_at) VALUES (?,?)', ['forum-v1', new Date()]);
      await connection.execute('INSERT IGNORE INTO forum_schema_migrations(version,applied_at) VALUES (?,?)', ['forum-images-v1', new Date()]);
      await connection.execute('INSERT IGNORE INTO forum_schema_migrations(version,applied_at) VALUES (?,?)', ['forum-own-replies-v1', new Date()]);
    }
    finally{
      await connection.query("SELECT RELEASE_LOCK('nanocamp_forum_migration')");
    }
  });
}
