// 论坛的读路径：列表、详情、我的内容、关系列表，以及通知（读 + 标记已读）。
//
// 单独一个文件的原因不是「读比写低级」，而是这两块经常一起改：加一个筛选条件往往要动
// listTopics、getTopic、myContent 与 myContent 的分页判断，而这些都不碰写入与表结构。
// 依赖方向：本文件 → index.mjs（投票/收藏状态要靠 voteState/bookmark 算），反过来不允许。
import {ensurePage, fail, idOf, pageOf, rows} from './base.mjs';
import {select, transaction} from '../db.mjs';
import * as dm from './dm.mjs';
import {categoryOf, vote, voteState, bookmark, write, report} from './index.mjs';

// ======================= 读 =======================

/** 主题列表的基础 SELECT：带上作者昵称，列表页与详情页共用同一组列。 */
const listSelect = 'SELECT t.*,u.nickname FROM forum_topics t JOIN users u ON u.id=t.author_id';

/**
 * 给一批主题补上点赞数与收藏数（列表卡片要显示）。
 *
 * 两次 GROUP BY 查询而不是每行一次，20 条卡片就是 2 次查询，不是 40 次。
 * @param {Array<object>} items 主题行（会被原地写入统计字段）。
 * @param {number} [viewer] 当前用户，用来算"我有没有点过/收藏过"。
 * @returns {Promise<Array<object>>} 同一批行。
 */
async function enrichTopicRows(items, viewer = 0){
  if(!items.length)
    return items;
  const ids = items.map(topic => topic.id);
  const marks = ids.map(() => '?').join(',');
  const votes = await select(`SELECT target_id,SUM(value=1) AS likes,MAX(CASE WHEN user_id=? THEN value END) AS mine FROM forum_topic_votes WHERE target_id IN (${marks}) GROUP BY target_id`, [viewer || 0, ...ids]);
  const bookmarks = await select(`SELECT topic_id,COUNT(*) AS total,MAX(user_id=?) AS mine FROM forum_bookmarks WHERE topic_id IN (${marks}) GROUP BY topic_id`, [viewer || 0, ...ids]);
  const voteMap = new Map(votes.map(row => [Number(row.target_id), row]));
  const bookMap = new Map(bookmarks.map(row => [Number(row.topic_id), row]));
  for(const item of items){
    const vote = voteMap.get(Number(item.id));
    const bookmark = bookMap.get(Number(item.id));
    item.like_count = Number(vote?.likes || 0);
    item.vote_mine = Number(vote?.mine || 0);
    item.bookmark_count = Number(bookmark?.total || 0);
    item.bookmarked = Boolean(Number(bookmark?.mine || 0));
  }
  return items;
}

/**
 * 主题列表：按分类/关键词/作者筛，按最后活动或发布时间排，一页 20 条。
 *
 * `feed=following` 是"只看关注的人"的视图：未登录直接 401，而不是返回空列表 ——
 * 空列表会让人以为关注的人没发帖。
 * @param {object} [params] 查询参数（page / category / q / feed / author / sort）。
 * @param {number} [userId] 当前用户。
 * @returns {Promise<{items: Array<object>, total: number, page: number, pages: number}>} 一页主题。
 */
export async function listTopics(params = {}, userId = 0){
  const page = pageOf(params.page);
  const where = ["t.status='published'"];
  const args = [];
  if(params.category){
    categoryOf(params.category);
    where.push('t.category=?');
    args.push(params.category);
  }
  const keyword = String(params.q || '').trim().slice(0, 100);
  if(keyword){
    const escaped = '%' + keyword.replace(/[!%_]/g, char => '!' + char) + '%';
    where.push("(t.title LIKE ? ESCAPE '!' OR t.body LIKE ? ESCAPE '!')");
    args.push(escaped, escaped);
  }
  if(params.feed === 'following'){
    if(!userId)
      fail('unauthenticated', 401);
    where.push('EXISTS(SELECT 1 FROM forum_follows f WHERE f.followed_id=t.author_id AND f.follower_id=?)');
    args.push(userId);
  }
  if(params.author){
    where.push('t.author_id=?');
    args.push(idOf(params.author));
  }
  const clause = where.join(' AND ');
  const order = params.sort === 'new'? 't.created_at': 't.last_activity_at';
  const [{total}] = await select(`SELECT COUNT(*) AS total FROM forum_topics t WHERE ${clause}`, args);
  const items = await select(`${listSelect} WHERE ${clause} ORDER BY ${order} DESC,t.id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`, args);
  await enrichTopicRows(items, userId);
  return {items, total: Number(total), page, pages: ensurePage(page, total, 20)};
}

/**
 * 作者信息 + 粉丝/关注数 + 我有没有关注他。
 * @param {object} c 事务连接。
 * @param {string|number} id 用户编号。
 * @param {number} [viewer] 当前用户。
 * @returns {Promise<object>} 作者信息。
 */
async function authorInfo(c, id, viewer = 0){
  const [user] = await rows(c, 'SELECT id,nickname,bio FROM users WHERE id=?', [id]);
  if(!user)
    fail('not_found', 404);
  const [[stats]] = await c.execute('SELECT (SELECT COUNT(*) FROM forum_follows WHERE followed_id=?) AS fans,(SELECT COUNT(*) FROM forum_follows WHERE follower_id=?) AS following,EXISTS(SELECT 1 FROM forum_follows WHERE follower_id=? AND followed_id=?) AS followed', [id, id, viewer, id]);
  return {...user, ...stats, followed: Boolean(stats.followed)};
}

/**
 * 公开的主页信息（不含邮箱）。
 * @param {string|number} id 用户编号。
 * @param {number} [viewer] 当前用户。
 * @returns {Promise<object>} 作者信息。
 */
export async function publicUser(id, viewer = 0){
  return transaction(c => authorInfo(c, idOf(id), viewer));
}

/**
 * 主题详情：主题本身 + 当页回复 + 投票/收藏/作者信息。
 *
 * 这一页的取法比较绕，两个设计点：
 *   1. **一页最多 30 条正文**，不把整段讨论拉出来排序（热门帖可以上千楼）。
 *   2. **"只看楼主"和正常分页共用一套偏移**：`own_priority` 先在同一个查询里给楼主回复打标，
 *      所以锚定某条回复（?reply=）时能算出它在第几页，而不用全表扫描。
 * @param {string|number} id 主题编号。
 * @param {number} [userId] 当前用户。
 * @param {string|number} [page] 页码。
 * @param {object} [options] 参数。
 * @param {string|number} [options.target] 要定位的回复编号。
 * @returns {Promise<object>} 主题、回复与统计。
 */
export async function getTopic(id, userId = 0, page = 1, {target = 0} = {}){
  id = idOf(id);
  page = pageOf(page);
  // 短读事务：主题、当页回复与投票状态要来自同一个快照。
  return transaction(async c => {
    const [topic] = await rows(c, `${listSelect} WHERE t.id=?`, [id]);
    if(!topic || topic.status === 'hidden')
      fail('not_found', 404);
    if(topic.status !== 'published'){
      topic.body = '';
      topic.title = '已撤回的讨论';
    }
    const [{total}] = await rows(c, 'SELECT COUNT(*) AS total FROM forum_replies WHERE topic_id=?', [id]);
    // 只有"对主题的直接回复"参与分页；楼中楼跟着它的父回复走。
    const ownCondition = "author_id=? AND parent_id IS NULL AND status='published'";
    const [{own_total: ownTotal}] = await rows(c, `SELECT COUNT(*) AS own_total FROM forum_replies WHERE topic_id=? AND ${ownCondition}`, [id, userId]);
    if(target){
      const [reply] = await rows(c, 'SELECT author_id,parent_id,status,sequence FROM forum_replies WHERE id=? AND topic_id=?', [idOf(target), id]);
      if(!reply)
        fail('not_found', 404);
      const own = Number(reply.author_id) === Number(userId) && !reply.parent_id && reply.status === 'published';
      const [{before}] = await rows(c, `SELECT COUNT(*) AS \`before\` FROM forum_replies WHERE topic_id=? AND ${own? `(${ownCondition}) AND sequence>?`: `NOT(${ownCondition}) AND sequence<?`}`, [id, userId, reply.sequence]);
      page = Math.floor((Number(before) + (own? 0: Number(ownTotal))) / 30) + 1;
    }
    const offset = (page - 1) * 30;
    const ownLimit = Math.max(0, Math.min(30, Number(ownTotal) - offset));
    const replySelect = `SELECT r.*,u.nickname,? AS own_priority,p.status AS parent_status,p.sequence AS parent_sequence,CASE WHEN p.status='published' THEN LEFT(p.body,160) ELSE '' END AS parent_excerpt,pu.nickname AS parent_name FROM forum_replies r JOIN users u ON u.id=r.author_id LEFT JOIN forum_replies p ON p.id=r.parent_id LEFT JOIN users pu ON pu.id=p.author_id WHERE r.topic_id=?`;
    const replies = ownLimit? await rows(c, `${replySelect} AND r.author_id=? AND r.parent_id IS NULL AND r.status='published' ORDER BY r.sequence DESC LIMIT ${ownLimit} OFFSET ${offset}`, [1, id, userId]): [];
    if(ownLimit < 30)
      replies.push(...await rows(c, `${replySelect} AND NOT(r.author_id=? AND r.parent_id IS NULL AND r.status='published') ORDER BY r.sequence LIMIT ${30 - ownLimit} OFFSET ${Math.max(0, offset - Number(ownTotal))}`, [0, id, userId]));
    const ids = replies.map(reply => reply.id);
    const voteRows = ids.length? await rows(c, `SELECT target_id,COALESCE(SUM(value=1),0) AS up,COALESCE(SUM(value=-1),0) AS down,COALESCE(MAX(CASE WHEN user_id=? THEN value END),0) AS mine FROM forum_reply_votes WHERE target_id IN (${ids.map(() => '?').join(',')}) GROUP BY target_id`, [userId, ...ids]): [];
    const voteMap = new Map(voteRows.map(row => [Number(row.target_id), {up: Number(row.up), down: Number(row.down), mine: Number(row.mine)}]));
    for(const reply of replies){
      // 撤回/隐藏的回复只留"有人在这里说过话"的位置，正文与昵称都不返回。
      if(reply.status !== 'published'){
        reply.body = '';
        reply.nickname = '';
      }
      reply.votes = voteMap.get(Number(reply.id)) || {up: 0, down: 0, mine: 0};
    }
    const [book] = await rows(c, 'SELECT 1 FROM forum_bookmarks WHERE user_id=? AND topic_id=?', [userId, id]);
    return {
      topic,
      replies,
      page,
      pages: ensurePage(page, total, 30),
      votes: await voteState(c, 'topic', id, userId),
      bookmarked: Boolean(book),
      author: await authorInfo(c, topic.author_id, userId)
    };
  });
}

/**
 * 由回复编号反查它所在的地址（旧链接 /forum/replies/<id>/ 跳过去）。
 * @param {string|number} id 回复编号。
 * @returns {Promise<string>} 主题地址 + 锚点。
 */
export async function locateReply(id){
  const [reply] = await select('SELECT r.*,t.status AS topic_status FROM forum_replies r JOIN forum_topics t ON t.id=r.topic_id WHERE r.id=?', [idOf(id)]);
  if(!reply || reply.topic_status === 'hidden')
    fail('not_found', 404);
  return `/forum/topics/${reply.topic_id}/?reply=${reply.id}#reply-${reply.id}`;
}

/**
 * "我的"内容：主题 / 回复 / 关注 / 粉丝 / 收藏 / 举报，一页 20 条。
 *
 * 五个分支的 SQL 差别很大，所以这里是一个显式的 if 链而不是拼通用的 where ——
 * 拼出来的 SQL 反而更难读，也更容易写出没走索引的查询。
 * @param {number} userId 用户编号。
 * @param {string} tab 分栏。
 * @param {string|number} [page] 页码。
 * @returns {Promise<object>} 一页内容。
 */
export async function myContent(userId, tab, page = 1){
  page = pageOf(page);
  const offset = (page - 1) * 20;
  let items;
  let total;
  if(tab === 'reports'){
    items = await select(`SELECT r.*,CASE WHEN t.status='published' THEN t.title ELSE '内容已不可见' END AS title FROM forum_reports r JOIN forum_topics t ON t.id=r.topic_id WHERE r.reporter_id=? ORDER BY r.id DESC LIMIT 20 OFFSET ${offset}`, [userId]);
    [{total}] = await select('SELECT COUNT(*) AS total FROM forum_reports WHERE reporter_id=?', [userId]);
  }
  else if(tab === 'following' || tab === 'fans'){
    const own = tab === 'following'? 'follower_id': 'followed_id';
    const other = tab === 'following'? 'followed_id': 'follower_id';
    items = await select(`SELECT u.id,u.nickname,u.bio FROM forum_follows f JOIN users u ON u.id=f.${other} WHERE f.${own}=? ORDER BY f.created_at DESC LIMIT 20 OFFSET ${offset}`, [userId]);
    [{total}] = await select(`SELECT COUNT(*) AS total FROM forum_follows WHERE ${own}=?`, [userId]);
  }
  else{
    let where = 't.author_id=?';
    let order = 't.created_at';
    if(tab === 'replies'){
      // "我回复过的主题"按我最后一次回复的时间排，而不是主题最后活动时间。
      where = "t.status<>'hidden' AND EXISTS(SELECT 1 FROM forum_replies r WHERE r.topic_id=t.id AND r.author_id=?)";
      order = '(SELECT MAX(r.created_at) FROM forum_replies r WHERE r.topic_id=t.id AND r.author_id=' + Number(userId) + ')';
    }
    if(tab === 'bookmarks')
      where = 'EXISTS(SELECT 1 FROM forum_bookmarks b WHERE b.topic_id=t.id AND b.user_id=?)';
    items = await select(`${listSelect} WHERE ${where} ORDER BY ${order} DESC,t.id DESC LIMIT 20 OFFSET ${offset}`, [userId]);
    [{total}] = await select(`SELECT COUNT(*) AS total FROM forum_topics t WHERE ${where}`, [userId]);
    // 被隐藏/撤回的帖子在"我的"里只留一个占位标题，正文不外露。
    for(const item of items){
      if(item.status !== 'published'){
        item.title = item.status === 'hidden'? '内容已隐藏': '已撤回的讨论';
        item.body = '';
      }
    }
    if(tab === 'replies'){
      for(const item of items){
        const [reply] = await select("SELECT id,sequence FROM forum_replies WHERE topic_id=? AND author_id=? AND status='published' ORDER BY id DESC LIMIT 1", [item.id, userId]);
        if(reply)
          item.jump = `/forum/replies/${reply.id}/`;
      }
    }
    await enrichTopicRows(items, userId);
  }
  return {items, total: Number(total), page, pages: ensurePage(page, total, 20)};
}

/**
 * 某人的关注/粉丝列表（公开主页的 tab）。
 * @param {string|number} id 用户编号。
 * @param {string} tab following / fans。
 * @param {string|number} [page] 页码。
 * @returns {Promise<object>} 一页内容。
 */
export async function relations(id, tab, page = 1){
  await publicUser(id);
  if(!['following', 'fans'].includes(tab))
    fail('not_found', 404);
  return myContent(idOf(id), tab, page);
}

/**
 * 某人回复过的主题（公开主页的"回复"tab）。
 * @param {string|number} id 用户编号。
 * @param {string|number} [page] 页码。
 * @param {number} [viewer] 当前用户。
 * @returns {Promise<object>} 一页主题。
 */
export async function publicReplies(id, page = 1, viewer = 0){
  id = idOf(id);
  page = pageOf(page);
  const where = "t.status='published' AND EXISTS(SELECT 1 FROM forum_replies r WHERE r.topic_id=t.id AND r.author_id=? AND r.status='published')";
  const items = await select(`${listSelect} WHERE ${where} ORDER BY t.last_activity_at DESC LIMIT 20 OFFSET ${(page - 1) * 20}`, [id]);
  const [{total}] = await select(`SELECT COUNT(*) AS total FROM forum_topics t WHERE ${where}`, [id]);
  await enrichTopicRows(items, viewer);
  return {items, total: Number(total), page, pages: ensurePage(page, total, 20)};
}

// ======================= 通知 =======================

/**
 * 通知列表。**文案是读的时候算的**，不是写入时存一份 ——
 * 帖子被隐藏、点赞被撤回、关注被取消之后，旧通知不该继续显示已经不存在的内容。
 *
 * 三种目标各有一套取标题/链接的逻辑：私信举报、帖子/回复、用户。
 * 算不出来时统一落到"相关内容已不可见"，并且不给链接。
 * @param {number} userId 用户编号。
 * @param {string} [filter] all / replies / social / system / activity。
 * @param {string|number} [page] 页码。
 * @returns {Promise<{items: Array<object>, unread: number, total: number, page: number, pages: number}>} 一页通知。
 */
export async function notifications(userId, filter = 'all', page = 1){
  page = pageOf(page);
  const conditions = ['n.user_id=?',
    "(n.kind<>'follow' OR EXISTS(SELECT 1 FROM forum_follows f WHERE f.follower_id=n.actor_id AND f.followed_id=n.user_id))",
    "(n.kind<>'like' OR (n.target_type='topic' AND EXISTS(SELECT 1 FROM forum_topic_votes v JOIN forum_topics t ON t.id=v.target_id WHERE v.target_id=n.target_id AND v.user_id=n.actor_id AND v.value=1 AND t.status='published')) OR (n.target_type='reply' AND EXISTS(SELECT 1 FROM forum_reply_votes v JOIN forum_replies r ON r.id=v.target_id JOIN forum_topics t ON t.id=r.topic_id WHERE v.target_id=n.target_id AND v.user_id=n.actor_id AND v.value=1 AND r.status='published' AND t.status='published')))"
  ];
  if(filter === 'replies')
    conditions.push("n.kind='reply'");
  if(filter === 'social')
    conditions.push("n.kind IN('like','follow')");
  if(filter === 'system')
    conditions.push("n.kind IN('report_result','content_hidden','content_restored')");
  if(filter === 'activity')
    conditions.push("n.kind IN('reply','like','follow')");
  // system 是"除社交以外"，与上面那条 IS IN 是互斥写法，这里用 NOT IN 覆盖（含未来的新类型）。
  if(filter === 'system')
    conditions[conditions.length - 1] = "n.kind NOT IN('reply','like','follow')";
  const clause = conditions.join(' AND ');
  const [{total}] = await select(`SELECT COUNT(*) AS total FROM forum_notifications n WHERE ${clause}`, [userId]);
  // 未读数只按前三条（本人 + 关注/点赞是否还有效）算，不跟着分栏变。
  const [{unread}] = await select(`SELECT COUNT(*) AS unread FROM forum_notifications n WHERE ${conditions.slice(0, 3).join(' AND ')} AND n.read_at IS NULL`, [userId]);
  const items = await select(`SELECT n.*,u.nickname AS actor_name FROM forum_notifications n LEFT JOIN users u ON u.id=n.actor_id WHERE ${clause} ORDER BY n.id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`, [userId]);
  for(const item of items){
    item.href = '';
    item.title = '相关内容已不可见';
    if(item.target_type === 'dm_report'){
      const [report] = await select('SELECT r.reporter_id,r.resolution,r.conversation_id,m.sender_id FROM forum_dm_reports r JOIN forum_dm_messages m ON m.id=r.message_id WHERE r.id=?', [item.target_id]);
      // 只有举报人和被举报人能看这条结果通知，其他人拿到的是兜底文案。
      if(report && (Number(report.reporter_id) === Number(userId) || Number(report.sender_id) === Number(userId))){
        const auditId = item.event_key.split(':')[4];
        const [audit] = auditId? await select("SELECT reason FROM forum_audit WHERE id=? AND target_type='dm_report' AND target_id=?", [idOf(auditId), item.target_id]): [];
        item.title = audit?.reason || report.resolution || '举报处理结果';
        item.href = Number(report.reporter_id) === Number(userId)? '/profile/?tab=reports&kind=dm&report=' + item.target_id + '#dm-report-' + item.target_id: '/forum/messages/conversations/' + report.conversation_id + '/';
      }
    }
    if(item.target_type === 'user'){
      item.title = item.actor_name || '社区伙伴';
      item.href = `/forum/users/${item.target_id}/`;
    }
    if(item.target_type === 'report'){
      const [report] = await select('SELECT resolution,status FROM forum_reports WHERE id=? AND reporter_id=?', [item.target_id, userId]);
      const auditId = item.event_key.split(':')[3];
      const [audit] = auditId? await select('SELECT reason FROM forum_audit WHERE id=?', [idOf(auditId)]): [];
      item.title = audit?.reason || report?.resolution || '举报处理结果';
      item.href = '/profile/?tab=reports#report-' + item.target_id;
    }
    if(item.target_type === 'topic' || item.target_type === 'reply'){
      const [target] = item.target_type === 'topic'? await select('SELECT id,title,status FROM forum_topics WHERE id=?', [item.target_id]): await select('SELECT t.id,t.title,t.status,r.status AS reply_status,r.sequence FROM forum_replies r JOIN forum_topics t ON t.id=r.topic_id WHERE r.id=?', [item.target_id]);
      if(target?.status === 'published' && (!target.reply_status || target.reply_status === 'published')){
        item.title = target.title;
        item.href = target.sequence? `/forum/replies/${item.target_id}/`: `/forum/topics/${target.id}/`;
      }
      if(item.kind === 'content_hidden' || item.kind === 'content_restored'){
        // 处理理由优先用审计里的那条；审计找不到时退回事件时间附近的那次操作。
        const auditId = item.event_key.split(':')[3];
        const [audit] = auditId? await select('SELECT reason FROM forum_audit WHERE id=?', [idOf(auditId)]): await select('SELECT reason FROM forum_audit WHERE target_type=? AND target_id=? AND action=? AND created_at<=? ORDER BY id DESC LIMIT 1', [item.target_type, item.target_id, item.kind === 'content_hidden'? 'uphold': 'restore', item.created_at]);
        item.title = audit?.reason || '内容状态已更新';
      }
    }
  }
  return {items, unread: Number(unread), total: Number(total), page, pages: ensurePage(page, total, 20)};
}

/**
 * 标记通知已读：可以是全部，也可以是最多 100 条指定编号。
 * @param {object} user 当前用户。
 * @param {string} key 幂等键。
 * @param {string|Array} ids 'all' 或编号数组。
 * @param {string} [filter] all / activity / system（只对 'all' 生效）。
 * @returns {Promise<{ok: boolean}>} 结果。
 */
export async function markRead(user, key, ids, filter = 'all'){
  if(!['all', 'activity', 'system'].includes(filter))
    fail('invalid_state');
  if(ids !== 'all' && (!Array.isArray(ids) || ids.length > 100))
    fail('invalid_state');
  const values = ids === 'all'? []: ids.map(idOf);
  return write(user, key, 'notifications.read', {ids, filter}, async c => {
    if(ids === 'all')
      await rows(c, `UPDATE forum_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL ${filter === 'all'? '': filter === 'system'? "AND kind NOT IN('reply','like','follow')": "AND kind IN('reply','like','follow')"}`, [new Date(), user.id]);
    else if(values.length)
      await rows(c, `UPDATE forum_notifications SET read_at=? WHERE user_id=? AND id IN (${values.map(() => '?').join(',')})`, [new Date(), user.id, ...values]);
    return {ok: true};
  });
}
