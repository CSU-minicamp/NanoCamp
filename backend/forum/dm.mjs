// 私信：表结构 + 会话与消息的读写 + 举报处理 + 接口路由，全在这一处。
//
// 它和论坛是**两个功能、一层依赖**：私信要用论坛的成员校验与错误类型（走 community.mjs），
// 论坛的消息页要读私信数据。依赖方向是 forum → dm，私信这边不认识论坛的任何业务函数。
// 虽然放在 forum/ 目录里（dm 属于论坛这块功能），它**不 import 同目录任何文件** —— 反过来说是另外三件 import 它。
//
// 四条约定，改动前先读：
//   1. **会话按 (user_low,user_high) 唯一**：两个人的编号排序后存一行，谁先发起都落在同一处，
//      不用"我也建一个反向会话"这种双写。
//   2. **消息有序号**：conversation.last_seq 是这条会话的下一个序号，消息表 (conversation_id,seq) 唯一。
//      已读位置记在 forum_dm_members.last_read_seq 上，未读数一律现算，不存计数器。
//   3. 每个写动作都走 change()：幂等键 + 摘要比对，重放同一个请求返回第一次的结果，不重复插入。
//   4. 发不出去有三种原因 —— 被对方拉黑、自己被禁言/资料不全、全局关了私信 —— 对外都叫 cannot_message
//      或 messaging_disabled，别在提示里区分"谁拉黑了谁"。
import {createHash} from 'node:crypto';

import {select, transaction} from '../db.mjs';
import {reportReasons} from '../../content/forum.mjs';
import {checkMember, CommunityError, fail, idOf, rows} from './base.mjs';
import {missingFields} from '../auth.mjs';
import {loadConfig} from '../config.mjs';

// ======================= 表结构 =======================

/**
 * 私信用到的五张表。全部挂在 users 外键上，删号时对话与消息跟着走。
 *
 * `forum_dm_reports.open_key` 是生成列：同一对 (举报人,消息) 在 open/reviewing 期间只允许一条，
 * 关闭后再举报才会插入新行 —— 用唯一索引挡住重复举报，比在应用层先查后插可靠。
 */
const dmSchema = [
  `CREATE TABLE IF NOT EXISTS forum_dm_conversations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_low BIGINT UNSIGNED NOT NULL,
    user_high BIGINT UNSIGNED NOT NULL,
    last_seq INT UNSIGNED NOT NULL DEFAULT 0,
    last_message_at DATETIME(3) NOT NULL,
    UNIQUE KEY uniq_dm_pair(user_low,user_high),
    FOREIGN KEY(user_low) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(user_high) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS forum_dm_members (
    conversation_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    last_read_seq INT UNSIGNED NOT NULL DEFAULT 0,
    hidden_through_seq INT UNSIGNED NULL,
    PRIMARY KEY(conversation_id,user_id),
    INDEX idx_dm_member(user_id,conversation_id),
    FOREIGN KEY(conversation_id) REFERENCES forum_dm_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS forum_dm_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_id BIGINT UNSIGNED NOT NULL,
    seq INT UNSIGNED NOT NULL,
    sender_id BIGINT UNSIGNED NOT NULL,
    client_message_id VARCHAR(80) NOT NULL,
    body TEXT NOT NULL,
    status ENUM('published','hidden') NOT NULL DEFAULT 'published',
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uniq_dm_seq(conversation_id,seq),
    UNIQUE KEY uniq_dm_client(sender_id,client_message_id),
    FOREIGN KEY(conversation_id) REFERENCES forum_dm_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS forum_user_blocks (
    blocker_id BIGINT UNSIGNED NOT NULL,
    blocked_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY(blocker_id,blocked_id),
    FOREIGN KEY(blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(blocked_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS forum_dm_reports (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    reporter_id BIGINT UNSIGNED NOT NULL,
    conversation_id BIGINT UNSIGNED NOT NULL,
    message_id BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(32) NOT NULL,
    details TEXT NOT NULL,
    status ENUM('open','reviewing','upheld','dismissed','withdrawn') NOT NULL DEFAULT 'open',
    assigned_to BIGINT UNSIGNED NULL,
    resolution TEXT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    open_key VARCHAR(120) GENERATED ALWAYS AS (CASE WHEN status IN ('open','reviewing') THEN CONCAT(reporter_id,':',message_id) ELSE NULL END) STORED,
    UNIQUE KEY uniq_dm_report(open_key),
    INDEX idx_dm_reporter(reporter_id,id),
    FOREIGN KEY(reporter_id) REFERENCES users(id),
    FOREIGN KEY(conversation_id) REFERENCES forum_dm_conversations(id),
    FOREIGN KEY(message_id) REFERENCES forum_dm_messages(id)
  )`
].map(sql => sql + ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');

/**
 * 升级旧库：删掉早期「消息请求」流程留下的三列。会话与消息本身不动。
 *
 * 白名单校验是刻意的：这段 SQL 会拼列名（DDL 不支持占位符），万一 information_schema 返回了
 * 意料之外的列名就直接报错停下，绝不把没预期的列删掉。
 * @param {object} connection 事务连接。
 * @returns {Promise<void>} 无。
 */
export async function migrateDirectMessages(connection){
  // 先建表（全部 IF NOT EXISTS，可反复执行），再删早期流程留下的旧列 —— 新库只做第一步。
  for(const sql of dmSchema)
    await connection.query(sql);
  const [columns] = await connection.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='forum_dm_conversations' AND COLUMN_NAME IN ('initiator_id','state','request_state')");
  const allowed = new Set(['initiator_id', 'state', 'request_state']);
  for(const column of columns){
    const name = column.COLUMN_NAME;
    if(!allowed.has(name))
      throw Error('Unexpected private-message migration column');
    await connection.query('ALTER TABLE forum_dm_conversations DROP COLUMN `' + name + '`');
  }
  await connection.execute('INSERT IGNORE INTO forum_schema_migrations(version,applied_at) VALUES (?,?)', ['forum-dm-direct-v2', new Date()]);
}

// ======================= 小工具 =======================

/** 幂等键：客户端生成的 8–80 位串，同一个键重放只算一次。 */
const keyOf = key => {
  if(!/^[\w-]{8,80}$/.test(String(key || '')))
    fail('idempotency_required');
  return key;
};

/** 消息正文：1–2000 字，去首尾空白。 */
const bodyOf = body => {
  if(typeof body !== 'string' || !body.trim() || Array.from(body.trim()).length > 2000)
    fail('invalid_content');
  return body.trim();
};

/** 没登录就 401。私信的每个入口都要先过它。 */
const auth = user => {
  if(!user)
    fail('unauthenticated', 401);
};

/** 运维开关：config.messages.enabled 显式设成 false 才关，缺省是开。 */
export const messagesEnabled = () => loadConfig().messages?.enabled !== false;

/** 限流：带 retryAfter 抛 429，接口层会把它写进 Retry-After 头。 */
const rate = (code, seconds) => {
  const error = new CommunityError(code, 429);
  error.retryAfter = seconds;
  throw error;
};

/** 两个人的会话键：小的在前，保证同一对用户永远算出同一个有序对。 */
const pair = (a, b) => [Math.min(a, b), Math.max(a, b)];

/**
 * 幂等写：同一个 (用户, 幂等键) 只执行一次 work，重放时返回第一次的结果。
 *
 * 摘要不匹配说明「同一个键换了内容」—— 这是客户端复用键的错误，直接 409，别悄悄按新的写。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string} action 动作名（同时用于审计与排查）。
 * @param {unknown} payload 参与摘要的内容。
 * @param {Function} work 真正干活的事务函数。
 * @param {boolean} [passive=false] 是否走 checkMember 的宽松模式（只改自己的阅读状态时用）。
 * @returns {Promise<unknown>} work 的返回值（或第一次执行的结果）。
 */
async function change(user, key, action, payload, work, passive = false){
  auth(user);
  keyOf(key);
  const digest = createHash('sha256').update(JSON.stringify({action, payload})).digest('hex');
  return transaction(async c => {
    await checkMember(c, user, passive);
    const [prior] = await rows(c, 'SELECT digest,result FROM forum_write_requests WHERE user_id=? AND request_key=?', [user.id, key]);
    if(prior){
      if(prior.digest !== digest)
        fail('request_conflict', 409);
      return JSON.parse(prior.result);
    }
    const result = await work(c);
    await rows(c, 'INSERT INTO forum_write_requests(user_id,request_key,digest,action,result,created_at) VALUES (?,?,?,?,?,?)', [user.id, key, digest, action, JSON.stringify(result), new Date()]);
    return result;
  });
}

/**
 * 取一条会话（顺带取出「我」的已读位置）。`lock` 用于写路径，把并发发送串起来。
 * 不是会话成员时一律 404 —— 不用 403，免得泄露"这个会话存在"。
 * @param {object} c 事务连接。
 * @param {string|number} id 会话编号。
 * @param {object} user 当前用户。
 * @param {boolean} [lock=false] 是否加行锁。
 * @returns {Promise<object>} 会话行。
 */
async function member(c, id, user, lock = false){
  const [conversation] = await rows(c, `SELECT d.*,m.last_read_seq,m.hidden_through_seq FROM forum_dm_conversations d JOIN forum_dm_members m ON m.conversation_id=d.id AND m.user_id=? WHERE d.id=? ${lock? 'FOR UPDATE': ''}`, [user.id, idOf(id)]);
  if(!conversation)
    fail('not_found', 404);
  return conversation;
}

/** 会话里的另一个人。 */
const peerId = (conversation, user) => Number(conversation.user_low) === Number(user.id)? Number(conversation.user_high): Number(conversation.user_low);

/**
 * 这条会话现在的可写状态：有没有被拉黑、对方有没有被禁言、我自己能不能发。
 * 一次查完，避免发送流程里散落三处判断。
 * @param {object} c 事务连接。
 * @param {object} conversation 会话行。
 * @param {object} user 当前用户。
 * @returns {Promise<{blocked: boolean, blocked_by_me: boolean, can_send: boolean, restricted: boolean}>} 状态。
 */
async function flags(c, conversation, user){
  const peer = peerId(conversation, user);
  const blocks = await rows(c, 'SELECT blocker_id FROM forum_user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)', [user.id, peer, peer, user.id]);
  const states = await rows(c, 'SELECT user_id,banned_at,suspended_until FROM forum_members WHERE user_id IN (?,?)', [user.id, peer]);
  const restricted = states.some(state => state.banned_at || state.suspended_until && new Date(state.suspended_until) > new Date());
  return {
    blocked: blocks.length > 0,
    blocked_by_me: blocks.some(block => Number(block.blocker_id) === Number(user.id)),
    can_send: messagesEnabled() && !restricted && !missingFields(user).length && !blocks.length,
    restricted
  };
}

// ======================= 读 =======================

/**
 * 「给某人发消息」的落点：对方资料 + 已有会话编号。
 * @param {object} user 当前用户。
 * @param {string|number} id 对方用户编号。
 * @returns {Promise<{peer: object, conversation_id: number|null, enabled: boolean}>} 落点信息。
 */
export async function recipient(user, id){
  auth(user);
  id = idOf(id);
  if(id === Number(user.id))
    fail('self_message', 403);
  // 只有填过昵称的人才可被发消息：没昵称的账号还没在社区露过面。
  const [peer] = await select("SELECT id,nickname,bio FROM users WHERE id=? AND nickname<>''", [id]);
  if(!peer)
    fail('not_found', 404);
  const [existing] = await select('SELECT id FROM forum_dm_conversations WHERE user_low=? AND user_high=?', pair(user.id, id));
  return {peer, conversation_id: existing?.id || null, enabled: messagesEnabled()};
}

/**
 * 按昵称搜人（最多 10 个），用于发消息时选收件人。
 * LIKE 里的 % _ 会被转义，避免用户输入的通配符把整张表扫出来。
 * @param {object} user 当前用户。
 * @param {string} q 关键词。
 * @returns {Promise<{items: Array<object>}>} 候选人列表（只含编号与昵称）。
 */
export async function recipients(user, q){
  auth(user);
  q = String(q || '').trim().slice(0, 60);
  if(!q)
    return {items: []};
  const like = '%' + q.replace(/[!%_]/g, char => '!' + char) + '%';
  return {
    items: await select("SELECT u.id,u.nickname FROM users u LEFT JOIN forum_members m ON m.user_id=u.id WHERE u.id<>? AND u.nickname LIKE ? ESCAPE '!' AND m.banned_at IS NULL ORDER BY u.nickname,u.id LIMIT 10", [user.id, like])
  };
}

/**
 * 会话列表，最新在前，游标分页（keyset）。
 *
 * 用游标而不是 OFFSET：消息一直在进来，OFFSET 会让第二页重复或漏条。
 * 游标里放的是上一页最后一条的 (last_message_at, id)，服务端解出来当边界。
 * 预览只取正文前 100 字；已隐藏的消息统一显示"消息已隐藏"，不把被处理的内容从列表里漏出去。
 * @param {object} user 当前用户。
 * @param {object} [options] 参数。
 * @param {string} [options.cursor] 上一页的游标。
 * @returns {Promise<{items: Array<object>, next_cursor: string|null, enabled: boolean}>} 一页会话。
 */
export async function conversations(user, {cursor} = {}){
  auth(user);
  const args = [user.id, user.id, user.id, user.id, user.id];
  let boundary = '';
  if(cursor){
    let parsed;
    try{
      parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString());
    }
    catch{
      fail('invalid_state');
    }
    if(!Array.isArray(parsed) || !Number.isFinite(Date.parse(parsed[0])))
      fail('invalid_state');
    boundary = ' AND (d.last_message_at<? OR (d.last_message_at=? AND d.id<?))';
    args.push(new Date(parsed[0]), new Date(parsed[0]), idOf(parsed[1]));
  }
  const items = await select(`SELECT d.id,d.last_seq,d.last_message_at,m.last_read_seq,u.id AS peer_id,u.nickname,
 CASE WHEN last.status='published' THEN LEFT(last.body,100) ELSE '消息已隐藏' END AS preview,
 (SELECT COUNT(*) FROM forum_dm_messages x WHERE x.conversation_id=d.id AND x.sender_id<>? AND x.seq>m.last_read_seq) AS unread,
 EXISTS(SELECT 1 FROM forum_user_blocks b WHERE (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)) AS blocked
 FROM forum_dm_conversations d JOIN forum_dm_members m ON m.conversation_id=d.id AND m.user_id=?
 JOIN users u ON u.id=IF(d.user_low=?,d.user_high,d.user_low)
 JOIN forum_dm_messages last ON last.conversation_id=d.id AND last.seq=d.last_seq
 WHERE (m.hidden_through_seq IS NULL OR d.last_seq>m.hidden_through_seq) ${boundary}
 ORDER BY d.last_message_at DESC,d.id DESC LIMIT 21`, args);
  const more = items.length > 20;
  items.splice(20);
  const last = items.at(-1);
  return {items, next_cursor: more? Buffer.from(JSON.stringify([last.last_message_at, last.id])).toString('base64url'): null, enabled: messagesEnabled()};
}

/**
 * 一条会话的消息，支持往前翻（before_seq）和增量拉（after_seq）。
 *
 * 两种情况取一次 31 条再切：多取一条是为了判断"还有没有更多"，不用额外 count。
 * 往前翻时结果是倒序取的，切完再反转，保证对外永远是正序。
 * @param {object} user 当前用户。
 * @param {string|number} id 会话编号。
 * @param {object} [options] 参数。
 * @param {string|number} [options.before_seq] 取这个序号之前的一页。
 * @param {string|number} [options.after_seq] 取这个序号之后的新消息。
 * @returns {Promise<object>} 会话状态 + 消息列表。
 */
export async function messages(user, id, {before_seq, after_seq} = {}){
  auth(user);
  if(before_seq && after_seq)
    fail('invalid_state');
  return transaction(async c => {
    const conversation = await member(c, id, user);
    const [peer] = await rows(c, 'SELECT id,nickname,bio FROM users WHERE id=?', [peerId(conversation, user)]);
    const cursor = before_seq || after_seq;
    const limit = cursor? idOf(cursor): 0;
    let items = await rows(c, `SELECT id,seq,sender_id,client_message_id,CASE WHEN status='published' THEN body ELSE '消息已隐藏' END AS body,status,created_at FROM forum_dm_messages WHERE conversation_id=? ${cursor? `AND seq${before_seq? '<': '>'}?`: ''} ORDER BY seq ${after_seq? 'ASC': 'DESC'} LIMIT 31`, cursor? [conversation.id, limit]: [conversation.id]);
    const more = items.length > 30;
    items.splice(30);
    if(!after_seq)
      items.reverse();
    const state = {...conversation, ...await flags(c, conversation, user)};
    return {conversation: state, peer, items, has_more: more, next_cursor: items.length? (after_seq? items.at(-1).seq: items[0].seq): null, enabled: messagesEnabled()};
  });
}

/**
 * 消息中心角标：私信未读 + 通知未读。
 *
 * 通知那部分要现判"这条通知还该不该算"：关注被取消、点赞被撤回、内容被隐藏之后，
 * 旧通知不该继续顶着红点。所以这里不是简单 COUNT。
 * @param {object} user 当前用户。
 * @returns {Promise<object>} 各类未读数与 total_unread。
 */
export async function summary(user){
  auth(user);
  const [dm] = await select(`SELECT COUNT(*) AS dm_unread FROM forum_dm_members m
 JOIN forum_dm_conversations d ON d.id=m.conversation_id JOIN forum_dm_messages x ON x.conversation_id=d.id
 WHERE m.user_id=? AND x.sender_id<>? AND x.seq>m.last_read_seq
 AND (m.hidden_through_seq IS NULL OR d.last_seq>m.hidden_through_seq)`, [user.id, user.id]);
  const [notices] = await select(`SELECT COALESCE(SUM(n.kind IN ('reply','follow','like')),0) AS activity_unread,COALESCE(SUM(n.kind NOT IN ('reply','follow','like')),0) AS system_unread FROM forum_notifications n WHERE n.user_id=? AND n.read_at IS NULL
 AND (n.kind<>'follow' OR EXISTS(SELECT 1 FROM forum_follows f WHERE f.follower_id=n.actor_id AND f.followed_id=n.user_id))
 AND (n.kind<>'like' OR (n.target_type='topic' AND EXISTS(SELECT 1 FROM forum_topic_votes v JOIN forum_topics t ON t.id=v.target_id WHERE v.target_id=n.target_id AND v.user_id=n.actor_id AND v.value=1 AND t.status='published')) OR (n.target_type='reply' AND EXISTS(SELECT 1 FROM forum_reply_votes v JOIN forum_replies r ON r.id=v.target_id JOIN forum_topics t ON t.id=r.topic_id WHERE v.target_id=n.target_id AND v.user_id=n.actor_id AND v.value=1 AND r.status='published' AND t.status='published')))`, [user.id]);
  const result = Object.fromEntries(Object.entries({...dm, ...notices}).map(([key, value]) => [key, Number(value)]));
  return {...result, total_unread: Object.values(result).reduce((sum, value) => sum + value, 0)};
}

// ======================= 写 =======================

/**
 * 发消息。给了会话编号就往那条会话里发，否则按收件人找/建会话。
 *
 * 幂等有两条线：外层幂等键（同一个请求重放）与内层 client_message_id（同一条消息重发）。
 * 后者是给"发送超时后重试"用的 —— 客户端没拿到响应时会用同一个 id 再发一次，这里返回原消息。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string|number|null} id 会话编号（新建会话时是 null）。
 * @param {object} data 请求体（body / client_message_id / to_user_id）。
 * @returns {Promise<object>} 消息。
 */
export async function send(user, key, id, data){
  const body = bodyOf(data.body);
  const client = keyOf(data.client_message_id || key);
  const target = id? idOf(id): idOf(data.to_user_id);
  return change(user, key, 'dm.send', {id: id || null, target, body, client}, async c => {
    if(!messagesEnabled())
      fail('messaging_disabled', 409);
    const [prior] = await rows(c, 'SELECT * FROM forum_dm_messages WHERE sender_id=? AND client_message_id=?', [user.id, client]);
    if(prior){
      // 同一个 client_message_id 又来了：内容必须一致，否则就是客户端把键用错了。
      if(prior.body !== body || id && Number(prior.conversation_id) !== target)
        fail('request_conflict', 409);
      const existing = await member(c, prior.conversation_id, user);
      if(!id && peerId(existing, user) !== target)
        fail('request_conflict', 409);
      return {
        id: prior.id,
        seq: prior.seq,
        conversation_id: prior.conversation_id,
        client_message_id: client,
        sender_id: prior.sender_id,
        body: prior.status === 'published'? body: '消息已隐藏',
        status: prior.status,
        created_at: prior.created_at
      };
    }
    // 一个人一分钟最多 20 条：挡脚本刷屏，普通人远够用。
    const [{n}] = await rows(c, 'SELECT COUNT(*) AS n FROM forum_dm_messages WHERE sender_id=? AND created_at>?', [user.id, new Date(Date.now() - 60000)]);
    if(n >= 20)
      rate('rate_limited', 60);
    let conversation;
    if(id)
      conversation = await member(c, id, user, true);
    else{
      if(target === Number(user.id))
        fail('self_message', 403);
      const [peer] = await rows(c, "SELECT id FROM users WHERE id=? AND nickname<>''", [target]);
      if(!peer)
        fail('not_found', 404);
      const [existing] = await rows(c, 'SELECT id FROM forum_dm_conversations WHERE user_low=? AND user_high=?', pair(user.id, target));
      if(existing)
        conversation = await member(c, existing.id, user, true);
      else{
        // ON DUPLICATE + LAST_INSERT_ID 让"并发第一次发消息"也只会建出一条会话。
        await rows(c, 'INSERT INTO forum_dm_conversations(user_low,user_high,last_message_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)', [...pair(user.id, target), new Date()]);
        const [created] = await rows(c, 'SELECT id FROM forum_dm_conversations WHERE user_low=? AND user_high=? FOR UPDATE', pair(user.id, target));
        await rows(c, 'INSERT IGNORE INTO forum_dm_members(conversation_id,user_id) VALUES (?,?),(?,?)', [created.id, user.id, created.id, target]);
        conversation = await member(c, created.id, user, true);
      }
    }
    const state = await flags(c, conversation, user);
    if(state.blocked || state.restricted)
      fail('cannot_message', 409);
    // 序号在锁内自增：同一条会话的并发发送不会撞号（另有 uniq_dm_seq 兜底）。
    const seq = Number(conversation.last_seq) + 1;
    const now = new Date();
    const created = await rows(c, 'INSERT INTO forum_dm_messages(conversation_id,seq,sender_id,client_message_id,body,created_at) VALUES (?,?,?,?,?,?)', [conversation.id, seq, user.id, client, body, now]);
    await rows(c, 'UPDATE forum_dm_conversations SET last_seq=?,last_message_at=? WHERE id=?', [seq, now, conversation.id]);
    // 发一条新消息就把「隐藏更早的消息」取消，否则对方看不到最新这条。
    await rows(c, 'UPDATE forum_dm_members SET hidden_through_seq=NULL WHERE conversation_id=? AND user_id=?', [conversation.id, user.id]);
    return {id: created.insertId, conversation_id: conversation.id, seq, sender_id: user.id, client_message_id: client, body, status: 'published', created_at: now};
  });
}

/**
 * 会话上的四个动作：标已读 / 隐藏 / 拉黑 / 取消拉黑。
 * 这几个都是"只动我自己的状态"或"只动我自己的黑名单"，所以走 checkMember 的宽松模式。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string|number} id 会话编号。
 * @param {string} action read / hide / block / unblock。
 * @param {object} [data] 请求体（read 时带 last_visible_seq）。
 * @returns {Promise<{ok: boolean}>} 结果。
 */
export async function act(user, key, id, action, data = {}){
  if(!['read', 'hide', 'block', 'unblock'].includes(action))
    fail('not_found', 404);
  return change(user, key, 'dm.' + action, {...data, id: idOf(id)}, async c => {
    const conversation = await member(c, id, user, true);
    if(action === 'read'){
      const seq = idOf(data.last_visible_seq);
      // 超过 last_seq 的已读位置没意义（对方还没发到那儿），当成非法请求。
      if(seq > conversation.last_seq)
        fail('invalid_state');
      await rows(c, 'UPDATE forum_dm_members SET last_read_seq=GREATEST(last_read_seq,?) WHERE conversation_id=? AND user_id=?', [seq, conversation.id, user.id]);
    }
    else if(action === 'hide')
      await rows(c, 'UPDATE forum_dm_members SET hidden_through_seq=? WHERE conversation_id=? AND user_id=?', [conversation.last_seq, conversation.id, user.id]);
    else if(action === 'block')
      await rows(c, 'INSERT IGNORE INTO forum_user_blocks(blocker_id,blocked_id,created_at) VALUES (?,?,?)', [user.id, peerId(conversation, user), new Date()]);
    else
      await rows(c, 'DELETE FROM forum_user_blocks WHERE blocker_id=? AND blocked_id=?', [user.id, peerId(conversation, user)]);
    return {ok: true};
  }, true);
}

/**
 * 举报一条私信。
 *
 * 只有会话双方能举报（`member()` 会挡外人），不能举报自己发的，同一人一小时最多 10 条。
 * 重复举报靠 open_key 唯一索引兜：还在处理中的那条直接返回原编号，不再插一行。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {object} data 请求体（message_id / reason / details）。
 * @returns {Promise<{id: number}>} 举报编号。
 */
export async function report(user, key, data){
  const message = idOf(data.message_id);
  const reason = String(data.reason || '');
  const details = String(data.details || '').trim();
  if(!reportReasons.includes(reason) || Array.from(details).length > 1000)
    fail('invalid_reason');
  return change(user, key, 'dm.report', {message, reason, details}, async c => {
    const [target] = await rows(c, 'SELECT * FROM forum_dm_messages WHERE id=?', [message]);
    if(!target)
      fail('not_found', 404);
    await member(c, target.conversation_id, user, true);
    if(Number(target.sender_id) === Number(user.id))
      fail('self_report', 403);
    const [prior] = await rows(c, "SELECT id FROM forum_dm_reports WHERE reporter_id=? AND message_id=? AND status IN ('open','reviewing')", [user.id, message]);
    if(prior)
      return {id: prior.id};
    const [{n}] = await rows(c, 'SELECT COUNT(*) AS n FROM forum_dm_reports WHERE reporter_id=? AND created_at>?', [user.id, new Date(Date.now() - 3600000)]);
    if(n >= 10)
      rate('rate_limited', 3600);
    const now = new Date();
    const created = await rows(c, 'INSERT INTO forum_dm_reports(reporter_id,conversation_id,message_id,reason,details,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [user.id, target.conversation_id, message, reason, details, now, now]);
    return {id: created.insertId};
  }, true);
}

/**
 * 我提交过的私信举报，一页 20 条。
 * 带 `?report=<id>` 时反推出这条在第几页 —— 通知里的链接就是要直接落到那一页。
 * @param {object} user 当前用户。
 * @param {object} [query] 查询参数（page / report）。
 * @returns {Promise<object>} 一页举报。
 */
export async function reports(user, query = {}){
  auth(user);
  let page = Math.max(1, Math.min(10000, parseInt(query.page, 10) || 1));
  if(query.report){
    const [target] = await select('SELECT id FROM forum_dm_reports WHERE reporter_id=? AND id=?', [user.id, idOf(query.report)]);
    if(!target)
      fail('not_found', 404);
    const [{n}] = await select('SELECT COUNT(*) AS n FROM forum_dm_reports WHERE reporter_id=? AND id>?', [user.id, target.id]);
    page = Math.floor(Number(n) / 20) + 1;
  }
  const [{total}] = await select('SELECT COUNT(*) AS total FROM forum_dm_reports WHERE reporter_id=?', [user.id]);
  return {
    items: await select(`SELECT id,reason,details,status,resolution,created_at,conversation_id,version FROM forum_dm_reports WHERE reporter_id=? ORDER BY id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`, [user.id]),
    page,
    pages: Math.max(1, Math.ceil(Number(total) / 20))
  };
}

/**
 * 撤回自己还没被受理的举报。已经受理（reviewing 之后）就不能撤了。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string|number} id 举报编号。
 * @returns {Promise<{ok: boolean}>} 结果。
 */
export async function withdrawReport(user, key, id){
  return change(user, key, 'dm.report.withdraw', {id: idOf(id)}, async c => {
    const [row] = await rows(c, 'SELECT * FROM forum_dm_reports WHERE id=? AND reporter_id=? FOR UPDATE', [id, user.id]);
    if(!row)
      fail('not_found', 404);
    if(row.status !== 'open' && row.status !== 'withdrawn')
      fail('report_in_progress', 409);
    await rows(c, "UPDATE forum_dm_reports SET status='withdrawn',version=version+1,updated_at=? WHERE id=?", [new Date(), id]);
    return {ok: true};
  }, true);
}

// ======================= 审核 =======================

/**
 * 取管理员/版主身份（审核动作都要）。不是管理员就 403。
 * @param {object} c 事务连接。
 * @param {string|number} actor 操作人编号。
 * @returns {Promise<{role: string}>} 成员行。
 */
async function operator(c, actor){
  const [user] = await rows(c, "SELECT role FROM forum_members WHERE user_id=? AND role IN ('moderator','admin')", [idOf(actor)]);
  if(!user)
    fail('forbidden', 403);
  return user;
}

/**
 * 处理一条私信举报：领取 / 成立 / 驳回 / 恢复。
 *
 * 处理成立时会把消息置为 hidden 并给发送者一个 24 小时起的禁言（叠加在已有制裁上，不是覆盖）。
 * 每一步都写一条 forum_audit：`restore` 要靠这条审计反推"成立之前的制裁是什么"，
 * 否则撤回处罚时没法把人恢复到原状。
 * @param {string|number} actor 操作人编号。
 * @param {object} input 参数（reportId / version / action / reason）。
 * @returns {Promise<object>} 新状态与版本号。
 */
export async function moderate(actor, {reportId, version, action, reason}){
  actor = idOf(actor);
  reportId = idOf(reportId);
  reason = String(reason || '').trim();
  if(reason.length < 3 || reason.length > 1000 || !['claim', 'uphold', 'dismiss', 'restore'].includes(action))
    fail('invalid_state');
  return transaction(async c => {
    const op = await operator(c, actor);
    const [report] = await rows(c, 'SELECT * FROM forum_dm_reports WHERE id=? FOR UPDATE', [reportId]);
    if(!report)
      fail('not_found', 404);
    // 版本号是乐观锁：两个人同时处理同一条举报时，后到的会失败而不是覆盖。
    if(Number(version) !== report.version)
      fail('version_conflict', 409);
    if(action === 'claim' && report.status !== 'open'
      || ['uphold', 'dismiss'].includes(action) && (report.status !== 'reviewing' || Number(report.assigned_to) !== actor)
      || action === 'restore' && (report.status !== 'upheld' || op.role !== 'admin'))
      fail('invalid_state', 409);
    const [message] = await rows(c, 'SELECT * FROM forum_dm_messages WHERE id=?', [report.message_id]);
    await rows(c, 'SELECT id FROM forum_dm_conversations WHERE id=? FOR UPDATE', [report.conversation_id]);
    const status = action === 'claim'? 'reviewing': action === 'uphold'? 'upheld': 'dismissed';
    await rows(c, 'UPDATE forum_dm_reports SET status=?,assigned_to=?,resolution=?,version=version+1,updated_at=? WHERE id=?', [status, action === 'claim'? actor: report.assigned_to, reason, new Date(), report.id]);
    const before = {status: message.status};
    let after = {status: message.status};
    if(action === 'uphold'){
      const [state] = await rows(c, 'SELECT suspended_until FROM forum_members WHERE user_id=?', [message.sender_id]);
      before.suspended_until = state?.suspended_until || null;
      const until = new Date(Math.max(Date.now() + 86400000, new Date(state?.suspended_until || 0).getTime()));
      until.setMilliseconds(0);
      await rows(c, "UPDATE forum_dm_messages SET status='hidden' WHERE id=?", [message.id]);
      await rows(c, 'INSERT INTO forum_members(user_id,suspended_until) VALUES (?,?) ON DUPLICATE KEY UPDATE suspended_until=?', [message.sender_id, until, until]);
      after = {status: 'hidden', suspended_until: until};
    }
    else if(action === 'restore'){
      await rows(c, "UPDATE forum_dm_messages SET status='published' WHERE id=?", [message.id]);
      after.status = 'published';
      // 把当时那条 uphold 记下的旧制裁恢复回去（只恢复"还是当时那个值"的情况，避免覆盖后来的新处罚）。
      const [audit] = await rows(c, "SELECT before_state,after_state FROM forum_audit WHERE target_type='dm_report' AND target_id=? AND action='uphold' ORDER BY id DESC LIMIT 1", [report.id]);
      if(audit){
        const previous = JSON.parse(audit.before_state);
        const applied = JSON.parse(audit.after_state);
        await rows(c, 'UPDATE forum_members SET suspended_until=? WHERE user_id=? AND suspended_until=?', [previous.suspended_until? new Date(previous.suspended_until): null, message.sender_id, new Date(applied.suspended_until)]);
      }
    }
    const audit = await rows(c, 'INSERT INTO forum_audit(actor_id,action,target_type,target_id,reason,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?)', [actor, action, 'dm_report', report.id, reason, JSON.stringify(before), JSON.stringify(after), new Date()]);
    if(action !== 'claim'){
      // 领取只是"我看上了这条"，不打扰任何人；其余三个动作都要通知当事人。
      const targets = [[report.reporter_id, 'dm_report_result'], ...(action === 'dismiss'? []: [[message.sender_id, action === 'restore'? 'dm_content_restored': 'dm_content_hidden']])];
      for(const [uid, kind] of targets)
        await rows(c, 'INSERT IGNORE INTO forum_notifications(user_id,actor_id,kind,target_type,target_id,event_key,created_at) VALUES (?,?,?,?,?,?,?)', [uid, actor, kind, 'dm_report', report.id, `dm:${report.id}:${Number(version) + 1}:${uid}:${audit.insertId}`, new Date()]);
    }
    return {ok: true, status, version: Number(version) + 1};
  });
}

/**
 * 审核台：列待处理举报，或按编号取一条连同前后 5 条上下文。
 *
 * 只有**领了这条举报的人**能看上下文（`assigned_to` 必须是自己），而且每看一次都记审计 ——
 * 私信上下文是别人的隐私，能看要有据可查。
 * @param {string|number} actor 操作人编号。
 * @param {string|number} [id] 举报编号；不传就列清单。
 * @returns {Promise<Array|object>} 清单或 {report, evidence}。
 */
export async function reviewReports(actor, id){
  return transaction(async c => {
    await operator(c, actor);
    if(!id)
      return rows(c, "SELECT id,reason,status,version,assigned_to,created_at FROM forum_dm_reports WHERE status IN ('open','reviewing') ORDER BY id LIMIT 100");
    const [report] = await rows(c, 'SELECT * FROM forum_dm_reports WHERE id=?', [idOf(id)]);
    if(!report || Number(report.assigned_to) !== Number(actor) || report.status === 'open')
      fail('forbidden', 403);
    const [message] = await rows(c, 'SELECT seq FROM forum_dm_messages WHERE id=?', [report.message_id]);
    await rows(c, 'INSERT INTO forum_audit(actor_id,action,target_type,target_id,reason,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?)', [actor, 'evidence.read', 'dm_report', report.id, '查看领取举报的有限上下文', '{}', '{}', new Date()]);
    return {
      report,
      evidence: await rows(c, 'SELECT id,seq,sender_id,body,status,created_at FROM forum_dm_messages WHERE conversation_id=? AND seq BETWEEN ? AND ? ORDER BY seq', [report.conversation_id, Math.max(1, message.seq - 5), message.seq + 5])
    };
  });
}

// ======================= 接口路由 =======================

/**
 * GET 侧的私信路由。由 backend/forum/routes.mjs 的接口层调用（它已经解析好会话、查询串与 CSRF 闸门），
 * 所以这里只做"路径 → 业务函数"的映射，不重复做鉴权。
 * @param {object|null} user 当前用户（可能是访客）。
 * @param {string} path 去掉结尾斜杠的路径。
 * @param {object} query 查询串。
 * @returns {Promise<object>} 响应体。
 */
export async function getDm(user, path, query){
  if(path === '/api/forum/message-summary')
    return summary(user);
  if(path === '/api/forum/dm/recipients')
    return recipients(user, query.q);
  if(path === '/api/forum/dm/conversations')
    return conversations(user, query);
  if(path === '/api/forum/dm/reports')
    return reports(user, query);
  const match = path.match(/^\/api\/forum\/dm\/conversations\/(\d+)\/messages$/);
  if(match)
    return messages(user, match[1], query);
  fail('not_found', 404);
}

/**
 * POST 侧的私信路由。幂等键来自请求头 Idempotency-Key。
 * @param {object|null} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string} path 去掉结尾斜杠的路径。
 * @param {object} data 请求体。
 * @returns {Promise<object>} 响应体。
 */
export async function postDm(user, key, path, data){
  if(path === '/api/forum/dm/conversations')
    return send(user, key, null, data);
  if(path === '/api/forum/dm/reports')
    return report(user, key, data);
  let match = path.match(/^\/api\/forum\/dm\/conversations\/(\d+)\/(messages|read|hide|block|unblock)$/);
  if(match)
    return match[2] === 'messages'? send(user, key, match[1], data): act(user, key, match[1], match[2], data);
  match = path.match(/^\/api\/forum\/dm\/reports\/(\d+)\/withdraw$/);
  if(match)
    return withdrawReport(user, key, match[1]);
  fail('not_found', 404);
}
