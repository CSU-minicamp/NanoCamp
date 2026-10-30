// 私信：会话与消息的读写 + 举报处理 + 接口路由，全在这一处（建表在 backend/schema.mjs）。
//
// 它和论坛是**两个功能、一层依赖**：私信要用论坛的成员校验与错误类型，但那是从 base.mjs 借的，
// 不是从论坛的写路径借的。所以同目录的边只有一条：本文件 → base.mjs。
// 反向（论坛 → 私信）只发生在 routes.mjs 的页面分支里（消息页要读会话与消息）；
// index.mjs / read.mjs / images.mjs 都不认识私信。
//
// 四条约定，改动前先读：
//   1. **会话按有序用户对唯一**：`user_low/user_high` 是由 `user_a/user_b` 算出来的生成列，
//      插入时随便写两个人的编号，UNIQUE 保证同一对只有一行。
//   2. **消息有序号**：conversation.last_seq 是这条会话的下一个序号，消息表 (conversation_id,sequence) 唯一。
//      已读位置记在 forum_dm_members.last_read_seq 上，未读数一律现算，不存计数器。
//   3. 幂等只做在「发消息」上（`client_message_id` 唯一）；标记已读、拉黑这类动作本身幂等，不需要键。
//   4. 发不出去有三种原因 —— 被对方拉黑、自己被禁言/资料不全、全局关了私信 —— 对外都叫 cannot_message
//      或 messaging_disabled，别在提示里区分「谁拉黑了谁」。
import {DM_BODY_MAX, DM_MESSAGE_PAGE, DM_MESSAGES_PER_MINUTE, PAGE_SIZE, REPORTS_PER_HOUR} from '../../common/forum.mjs';
import {select, transaction} from '../db.mjs';
import {reportReasons} from '../../content/forum.mjs';
import {checkMember, CommunityError, ensurePage, fail, idOf, isStaff, memberType, pageOf, rows, text} from './base.mjs';
import {missingFields} from '../auth.mjs';
import {loadConfig} from '../config.mjs';

// ======================= 小工具 =======================

/** 幂等键：客户端生成的 8–64 位串。私信只在发消息时真正用它（写进 client_message_id）。 */
const keyOf = key => {
  if(!/^[\w-]{8,64}$/.test(String(key || '')))
    fail('idempotency_required');
  return key;
};

/** 消息正文：1–2000 字，去首尾空白。 */
const bodyOf = body => {
  if(typeof body !== 'string' || !body.trim() || Array.from(body.trim()).length > DM_BODY_MAX)
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

/** 两个人的会话键：小的在前，用于查 `user_low/user_high` 这两个生成列。 */
const pair = (a, b) => [Math.min(a, b), Math.max(a, b)];

/**
 * 写动作的公共外壳：登录 → 事务 → 成员校验 → 干活。
 *
 * 旧实现这里还有一张 forum_write_requests 做幂等回放（那时要拿 action + payload 算摘要，
 * 所以还收一个 payload —— 表删掉后没人读，已经去掉）。现在：
 * 发消息靠 `client_message_id` 唯一键，标记已读/拉黑本身幂等，重复执行结果一样。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string} action 动作名（排查日志用）。
 * @param {Function} work 真正干活的事务函数。
 * @param {boolean} [passive=false] 是否走 checkMember 的宽松模式（只改自己的阅读状态时用）。
 * @returns {Promise<unknown>} work 的返回值。
 */
async function change(user, key, work, passive = false){
  auth(user);
  keyOf(key);
  return transaction(async c => {
    // 私信永远不算「公开发言」：被禁言（mute）的人还能发私信，只有封禁（ban）才拦。
    await checkMember(c, user, {passive});
    return work(c);
  });
}

/**
 * 取一条会话（顺带取出「我」的已读位置与成员状态）。`lock` 用于写路径，把并发发送串起来。
 * 不是会话成员时一律 404 —— 不用 403，免得泄露「这个会话存在」。
 * @param {object} c 事务连接。
 * @param {string|number} id 会话编号。
 * @param {object} user 当前用户。
 * @param {boolean} [lock=false] 是否加行锁。
 * @returns {Promise<object>} 会话行。
 */
async function member(c, id, user, lock = false){
  const [conversation] = await rows(c, `SELECT d.*,m.last_read_seq,m.status AS member_status FROM forum_dm_conversations d JOIN forum_dm_members m ON m.conversation_id=d.id AND m.member_id=? WHERE d.id=? ${lock? 'FOR UPDATE': ''}`, [user.id, idOf(id)]);
  if(!conversation)
    fail('not_found', 404);
  return conversation;
}

/** 会话里的另一个人。 */
const peerId = (conversation, user) => Number(conversation.user_low) === Number(user.id)? Number(conversation.user_high): Number(conversation.user_low);

/**
 * 这条会话现在的可写状态：有没有被拉黑、双方有没有被封禁、我自己能不能发。
 *
 * 只看 `ban` —— 禁言（mute）只拦公开发言，私信照常；被封的人连私信都不该能发。
 * 一次查完，避免发送流程里散落三处判断。
 * @param {object} c 事务连接。
 * @param {object} conversation 会话行。
 * @param {object} user 当前用户。
 * @returns {Promise<{blocked: boolean, blocked_by_me: boolean, can_send: boolean, restricted: boolean}>} 状态。
 */
async function flags(c, conversation, user){
  const peer = peerId(conversation, user);
  const blocks = await rows(c, 'SELECT blocker_id FROM forum_user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)', [user.id, peer, peer, user.id]);
  const states = await rows(c, 'SELECT member_id,type,expired_at FROM forum_member_roles WHERE member_id IN (?,?)', [user.id, peer]);
  const restricted = states.some(state => memberType(state) === 'ban');
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
    // 「现在」由 Node 传参：连接是 timezone:'Z'，MySQL 会话时区可能是 +08:00，用 NOW() 会静默差 8 小时。
    items: await select("SELECT u.id,u.nickname FROM users u WHERE u.id<>? AND u.nickname LIKE ? ESCAPE '!' AND NOT EXISTS(SELECT 1 FROM forum_member_roles b WHERE b.member_id=u.id AND b.type='ban' AND (b.expired_at IS NULL OR b.expired_at > ?)) ORDER BY u.nickname,u.id LIMIT 10", [user.id, like, new Date()])
  };
}

/**
 * 会话列表，最新在前，游标分页（keyset）。
 *
 * 用游标而不是 OFFSET：消息一直在进来，OFFSET 会让第二页重复或漏条。
 * 游标里放的是上一页最后一条的 (last_message_at, id)，服务端解出来当边界。
 * 预览只取正文前 100 字；删掉的消息统一显示「消息已删除」。
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
    CASE WHEN last.status='published' THEN LEFT(last.body,100) ELSE '消息已删除' END AS preview,
    (SELECT COUNT(*) FROM forum_dm_messages x WHERE x.conversation_id=d.id AND x.sender_id<>? AND x.sequence>m.last_read_seq AND x.status='published') AS unread,
    EXISTS(SELECT 1 FROM forum_user_blocks b WHERE (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)) AS blocked
    FROM forum_dm_conversations d JOIN forum_dm_members m ON m.conversation_id=d.id AND m.member_id=?
    JOIN users u ON u.id=IF(d.user_low=?,d.user_high,d.user_low)
    JOIN forum_dm_messages last ON last.conversation_id=d.id AND last.sequence=d.last_seq
    WHERE m.status='active' ${boundary}
    ORDER BY d.last_message_at DESC,d.id DESC LIMIT ${PAGE_SIZE + 1}`, args);
  const more = items.length > PAGE_SIZE;
  items.splice(PAGE_SIZE);
  const last = items.at(-1);
  return {items, next_cursor: more? Buffer.from(JSON.stringify([last.last_message_at, last.id])).toString('base64url'): null, enabled: messagesEnabled()};
}

/**
 * 一条会话的消息，支持往前翻（before_seq）和增量拉（after_seq）。
 *
 * 两种情况取一次 31 条再切：多取一条是为了判断「还有没有更多」，不用额外 count。
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
    // sequence 对外叫 seq：模板与前端脚本一直用的是 seq。
    let items = await rows(c, `SELECT id,sequence AS seq,sender_id,client_message_id,CASE WHEN status='published' THEN body ELSE '消息已删除' END AS body,status,sent_at AS created_at FROM forum_dm_messages WHERE conversation_id=? ${cursor? `AND sequence${before_seq? '<': '>'}?`: ''} ORDER BY sequence ${after_seq? 'ASC': 'DESC'} LIMIT ${DM_MESSAGE_PAGE + 1}`, cursor? [conversation.id, limit]: [conversation.id]);
    const more = items.length > DM_MESSAGE_PAGE;
    items.splice(DM_MESSAGE_PAGE);
    if(!after_seq)
      items.reverse();
    const state = {...conversation, ...await flags(c, conversation, user)};
    return {conversation: state, peer, items, has_more: more, next_cursor: items.length? (after_seq? items.at(-1).seq: items[0].seq): null, enabled: messagesEnabled()};
  });
}

/**
 * 消息中心角标：私信未读 + 通知未读。
 *
 * 通知那部分要现判「这条通知还该不该算」：关注被取消、点赞被撤回、内容被删之后，
 * 旧通知不该继续顶着红点。所以这里不是简单 COUNT。
 * @param {object} user 当前用户。
 * @returns {Promise<object>} 各类未读数与 total_unread。
 */
export async function summary(user){
  auth(user);
  const [dm] = await select(`SELECT COUNT(*) AS dm_unread FROM forum_dm_members m
    JOIN forum_dm_conversations d ON d.id=m.conversation_id JOIN forum_dm_messages x ON x.conversation_id=d.id
    WHERE m.member_id=? AND m.status='active' AND x.sender_id<>? AND x.sequence>m.last_read_seq AND x.status='published'`, [user.id, user.id]);
  const [notices] = await select(`SELECT COALESCE(SUM(n.category IN ('reply','follow','like')),0) AS activity_unread,COALESCE(SUM(n.category NOT IN ('reply','follow','like')),0) AS system_unread FROM forum_notifications n WHERE n.receiver=? AND n.read_at IS NULL
    AND (n.category<>'follow' OR EXISTS(SELECT 1 FROM forum_follows f WHERE f.follower_id=n.sender AND f.followed_id=n.receiver))
    AND (n.category<>'like' OR (n.target_type='post' AND EXISTS(SELECT 1 FROM forum_post_votes v JOIN forum_posts p ON p.id=v.post_id WHERE v.post_id=n.target_id AND v.voter=n.sender AND v.vote_type='up' AND p.status='published')) OR (n.target_type='reply' AND EXISTS(SELECT 1 FROM forum_reply_votes v JOIN forum_post_replies r ON r.id=v.reply_id JOIN forum_posts p ON p.id=r.post_id WHERE v.reply_id=n.target_id AND v.voter=n.sender AND v.vote_type='up' AND r.status='published' AND p.status='published')))`, [user.id]);
  const result = Object.fromEntries(Object.entries({...dm, ...notices}).map(([key, value]) => [key, Number(value)]));
  return {...result, total_unread: Object.values(result).reduce((sum, value) => sum + value, 0)};
}

// ======================= 写 =======================

/**
 * 发消息。给了会话编号就往那条会话里发，否则按收件人找/建会话。
 *
 * 幂等靠 `client_message_id` 唯一键：客户端没拿到响应时会用同一个 id 再发一次，这里返回原消息。
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
  return change(user, key, async c => {
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
        seq: prior.sequence,
        conversation_id: prior.conversation_id,
        client_message_id: client,
        sender_id: prior.sender_id,
        body: prior.status === 'published'? body: '消息已删除',
        status: prior.status,
        created_at: prior.sent_at
      };
    }
    // 一个人一分钟最多 20 条：挡脚本刷屏，普通人远够用。
    const [{n}] = await rows(c, 'SELECT COUNT(*) AS n FROM forum_dm_messages WHERE sender_id=? AND sent_at>?', [user.id, new Date(Date.now() - 60000)]);
    if(n >= DM_MESSAGES_PER_MINUTE)
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
        // 序号由 last_seq 发，唯一键是生成列 (user_low,user_high)：并发第一次发消息只会建出一条会话。
        await rows(c, 'INSERT INTO forum_dm_conversations(user_a,user_b,last_message_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)', [user.id, target, new Date()]);
        const [created] = await rows(c, 'SELECT id FROM forum_dm_conversations WHERE user_low=? AND user_high=? FOR UPDATE', pair(user.id, target));
        await rows(c, 'INSERT IGNORE INTO forum_dm_members(conversation_id,member_id) VALUES (?,?),(?,?)', [created.id, user.id, created.id, target]);
        conversation = await member(c, created.id, user, true);
      }
    }
    const state = await flags(c, conversation, user);
    if(state.blocked || state.restricted)
      fail('cannot_message', 409);
    // 序号在锁内自增：同一条会话的并发发送不会撞号（另有 uniq_dm_sequence 兜底）。
    const seq = Number(conversation.last_seq) + 1;
    const now = new Date();
    const created = await rows(c, 'INSERT INTO forum_dm_messages(conversation_id,sequence,sender_id,client_message_id,body,sent_at) VALUES (?,?,?,?,?,?)', [conversation.id, seq, user.id, client, body, now]);
    await rows(c, 'UPDATE forum_dm_conversations SET last_seq=?,last_message_at=? WHERE id=?', [seq, now, conversation.id]);
    // 新消息到达时，所有「隐藏」了这条会话的人都重新看到它（隐藏只是收起，不是退出）。
    // 旧实现用 hidden_through_seq 比较序号，现在靠 status：两条路效果一样，但这条更直白。
    await rows(c, "UPDATE forum_dm_members SET status='active' WHERE conversation_id=? AND status='hidden'", [conversation.id]);
    return {id: created.insertId, conversation_id: conversation.id, seq, sender_id: user.id, client_message_id: client, body, status: 'published', created_at: now};
  });
}

/**
 * 会话上的四个动作：标已读 / 隐藏 / 拉黑 / 取消拉黑。
 * 这几个都是「只动我自己的状态」或「只动我自己的黑名单」，所以走 checkMember 的宽松模式。
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
  return change(user, key, async c => {
    const conversation = await member(c, id, user, true);
    if(action === 'read'){
      const seq = idOf(data.last_visible_seq);
      // 超过 last_seq 的已读位置没意义（对方还没发到那儿），当成非法请求。
      if(seq > conversation.last_seq)
        fail('invalid_state');
      await rows(c, 'UPDATE forum_dm_members SET last_read_seq=GREATEST(last_read_seq,?) WHERE conversation_id=? AND member_id=?', [seq, conversation.id, user.id]);
    }
    else if(action === 'hide')
      await rows(c, "UPDATE forum_dm_members SET status='hidden' WHERE conversation_id=? AND member_id=?", [conversation.id, user.id]);
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
 * @param {object} data 请求体（message_id / reason / detail）。
 * @returns {Promise<{id: number}>} 举报编号。
 */
export async function report(user, key, data){
  const message = idOf(data.message_id);
  // 请求体字段是 reason（前端表单）；落库改名 category —— 三张举报表同一口径。
  const category = text(data.reason, 1, 32);
  const detail = text(data.detail || '', category === '其他'? 5: 0, 1000);
  if(!reportReasons.includes(category))
    fail('invalid_reason');
  return change(user, key, async c => {
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
    if(n >= REPORTS_PER_HOUR)
      rate('rate_limited', 3600);
    const now = new Date();
    const created = await rows(c, 'INSERT INTO forum_dm_reports(reporter_id,conversation_id,message_id,category,detail,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [user.id, target.conversation_id, message, category, detail, now, now]);
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
  let page = pageOf(query.page);
  if(query.report){
    const [target] = await select('SELECT id FROM forum_dm_reports WHERE reporter_id=? AND id=?', [user.id, idOf(query.report)]);
    if(!target)
      fail('not_found', 404);
    const [{n}] = await select('SELECT COUNT(*) AS n FROM forum_dm_reports WHERE reporter_id=? AND id>?', [user.id, target.id]);
    // 反推出来的页一定存在（那条举报就在那页上），不必再过 ensurePage。
    page = Math.floor(Number(n) / PAGE_SIZE) + 1;
  }
  const [{total}] = await select('SELECT COUNT(*) AS total FROM forum_dm_reports WHERE reporter_id=?', [user.id]);
  const pages = query.report? Math.max(1, Math.ceil(Number(total) / PAGE_SIZE)): ensurePage(page, total, PAGE_SIZE);
  return {
    items: await select(`SELECT id,category,detail,status,resolution,created_at,conversation_id,version FROM forum_dm_reports WHERE reporter_id=? ORDER BY id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, [user.id]),
    page,
    pages
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
  // 编号形状在这里收口（以前是塞进 payload 时顺手 idOf 的，payload 去掉后要显式做）。
  id = idOf(id);
  return change(user, key, async c => {
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
  const [user] = await rows(c, 'SELECT type,expired_at FROM forum_member_roles WHERE member_id=?', [idOf(actor)]);
  if(!isStaff(user))
    fail('forbidden', 403);
  return user;
}

/**
 * 处理一条私信举报：领取 / 成立 / 驳回 / 恢复。
 *
 * 没有 hidden 这个状态：成立就把消息标成 `deleted_by_report`（对双方都不可见），
 * 只有 admin 能 restore 回 published。**处理不再叠加禁言** —— 禁言是独立操作，
 * 也不写审计表（旧实现靠 audit 反推旧制裁，现在没有这个需求，`resolution` 就是理由）。
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
      || ['uphold', 'dismiss'].includes(action) && (report.status !== 'reviewing' || Number(report.assignee) !== actor)
      || action === 'restore' && (report.status !== 'upheld' || op.type !== 'admin'))
      fail('invalid_state', 409);
    const [message] = await rows(c, 'SELECT * FROM forum_dm_messages WHERE id=?', [report.message_id]);
    await rows(c, 'SELECT id FROM forum_dm_conversations WHERE id=? FOR UPDATE', [report.conversation_id]);
    const status = action === 'claim'? 'reviewing': action === 'uphold'? 'upheld': action === 'dismiss'? 'dismissed': report.status;
    // restore 不覆盖 resolution，理由同论坛侧：结案理由不能被后来的撤销改掉。
    if(action === 'restore')
      await rows(c, 'UPDATE forum_dm_reports SET status=?,assignee=?,version=version+1,updated_at=? WHERE id=?', [status, report.assignee, new Date(), report.id]);
    else
      await rows(c, 'UPDATE forum_dm_reports SET status=?,resolution=?,assignee=?,version=version+1,updated_at=? WHERE id=?', [status, reason, action === 'claim'? actor: report.assignee, new Date(), report.id]);
    if(action === 'uphold')
      await rows(c, "UPDATE forum_dm_messages SET status='deleted_by_report' WHERE id=?", [message.id]);
    if(action === 'restore')
      await rows(c, "UPDATE forum_dm_messages SET status='published' WHERE id=?", [message.id]);
    if(['uphold', 'dismiss'].includes(action))
      await rows(c, 'INSERT IGNORE INTO forum_notifications(receiver,sender,category,target_type,target_id,event_key,created_at) VALUES (?,?,?,?,?,?,?)', [report.reporter_id, actor, 'dm_report_result', 'dm_report', report.id, `dm:${report.id}:${Number(version) + 1}:${report.reporter_id}`, new Date()]);
    if(action === 'uphold' || action === 'restore')
      await rows(c, 'INSERT IGNORE INTO forum_notifications(receiver,sender,category,target_type,target_id,event_key,created_at) VALUES (?,?,?,?,?,?,?)', [message.sender_id, actor, action === 'restore'? 'dm_content_restored': 'dm_content_deleted', 'dm_report', report.id, `dm:${report.id}:${Number(version) + 1}:${message.sender_id}`, new Date()]);
    return {ok: true, status, version: Number(version) + 1};
  });
}

/**
 * 审核台：列待处理举报，或按编号取一条连同前后 5 条上下文。
 *
 * 只有**领了这条举报的人**能看上下文（`assignee` 必须是自己）。
 * 旧实现在这里写一条「查看证据」审计，审计表删掉后改为只记日志（不落库）。
 * @param {string|number} actor 操作人编号。
 * @param {string|number} [id] 举报编号；不传就列清单。
 * @returns {Promise<Array|object>} 清单或 {report, evidence}。
 */
export async function reviewReports(actor, id){
  return transaction(async c => {
    await operator(c, actor);
    if(!id)
      return rows(c, "SELECT id,category,status,version,assignee,created_at FROM forum_dm_reports WHERE status IN ('open','reviewing') ORDER BY id LIMIT 100");
    const [report] = await rows(c, 'SELECT * FROM forum_dm_reports WHERE id=?', [idOf(id)]);
    if(!report || Number(report.assignee) !== Number(actor) || report.status === 'open')
      fail('forbidden', 403);
    const [message] = await rows(c, 'SELECT sequence FROM forum_dm_messages WHERE id=?', [report.message_id]);
    console.log('[dm:evidence]', actor, report.id, new Date().toISOString());
    return {
      report,
      evidence: await rows(c, 'SELECT id,sequence AS seq,sender_id,body,status,sent_at AS created_at FROM forum_dm_messages WHERE conversation_id=? AND sequence BETWEEN ? AND ? ORDER BY sequence', [report.conversation_id, Math.max(1, message.sequence - 5), message.sequence + 5])
    };
  });
}

// ======================= 接口路由 =======================

/**
 * GET 侧的私信路由。由 backend/forum/routes.mjs 的接口层调用（它已经解析好会话、查询串与 CSRF 闸门），
 * 所以这里只做「路径 → 业务函数」的映射，不重复做鉴权。
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
