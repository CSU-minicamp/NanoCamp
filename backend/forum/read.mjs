// 论坛的读路径：列表、详情、我的内容、关系列表，以及通知（读 + 标记已读）。
//
// 单独一个文件的原因不是「读比写低级」，而是这两块经常一起改：加一个筛选条件往往要动
// listPosts、getPost、myContent 与分页判断，而这些都不碰写入与表结构。
// 依赖方向：本文件 → index.mjs（投票/收藏状态要靠 voteState 算），反过来不允许。
//
// 表结构 2026-10-29 重写后，数据库列名变了（poster_id / content / parent_reply / vote_type / category…），
// 但**对外字段名不变**：SELECT 里统一用 `AS author_id` / `AS body` / `AS parent_id` / `AS kind` 别名，
// 传给模板与前端 JSON 的形状与旧版一致。改列名时记得同步这里的别名，否则页面会静默空白。
import {PAGE_SIZE, REPLY_PAGE_SIZE} from '../../common/forum.mjs';
import {ensurePage, fail, idOf, pageOf, rows} from './base.mjs';
import {select, transaction} from '../db.mjs';
import {categoryOf, voteState, write} from './index.mjs';

// ======================= 读 =======================

/**
 * 帖子列表的基础 SELECT：带上作者昵称，列表页与详情页共用同一组列。
 * `author_id` / `body` 是别名 —— 数据库里叫 poster_id / content，模板按旧名字读。
 */
const listSelect = 'SELECT p.*,p.poster_id AS author_id,p.content AS body,u.nickname FROM forum_posts p JOIN users u ON u.id=p.poster_id';

/** 只导出对外的字段映射，避免模板层出现「同一个字段两个名字」。 */
const POST_VISIBLE = "p.status='published'";

/**
 * 给一批帖子补上点赞数与收藏数（列表卡片要显示）。
 *
 * 两次 GROUP BY 查询而不是每行一次，20 条卡片就是 2 次查询，不是 40 次。
 * @param {Array<object>} items 帖子行（会被原地写入统计字段）。
 * @param {number} [viewer] 当前用户，用来算「我有没有点过赞/收藏过」。
 * @returns {Promise<Array<object>>} 同一批行。
 */
async function enrichPostRows(items, viewer = 0){
  if(!items.length)
    return items;
  const ids = items.map(post => post.id);
  const marks = ids.map(() => '?').join(',');
  const votes = await select(`SELECT post_id,SUM(vote_type='up') AS likes,MAX(CASE WHEN voter=? THEN vote_type END) AS mine FROM forum_post_votes WHERE post_id IN (${marks}) GROUP BY post_id`, [viewer || 0, ...ids]);
  const bookmarks = await select(`SELECT post_id,COUNT(*) AS total,MAX(user_id=?) AS mine FROM forum_post_bookmarks WHERE post_id IN (${marks}) GROUP BY post_id`, [viewer || 0, ...ids]);
  const voteMap = new Map(votes.map(row => [Number(row.post_id), row]));
  const bookMap = new Map(bookmarks.map(row => [Number(row.post_id), row]));
  for(const item of items){
    const itemVote = voteMap.get(Number(item.id));
    const itemBookmark = bookMap.get(Number(item.id));
    item.like_count = Number(itemVote?.likes || 0);
    item.vote_mine = itemVote?.mine === 'up'? 1: 0;
    item.bookmark_count = Number(itemBookmark?.total || 0);
    item.bookmarked = Boolean(Number(itemBookmark?.mine || 0));
  }
  return items;
}

/**
 * 帖子列表：按分类/关键词/作者筛，按最后活动或发布时间排，一页 20 条。
 *
 * `feed=following` 是「只看关注的人」的视图：未登录直接 401，而不是返回空列表 ——
 * 空列表会让人以为关注的人没发帖。
 * @param {object} [params] 查询参数（page / category / q / feed / author / sort）。
 * @param {number} [userId] 当前用户。
 * @returns {Promise<{items: Array<object>, total: number, page: number, pages: number}>} 一页帖子。
 */
export async function listPosts(params = {}, userId = 0){
  const page = pageOf(params.page);
  const where = [POST_VISIBLE];
  const args = [];
  if(params.category){
    categoryOf(params.category);
    where.push('p.category=?');
    args.push(params.category);
  }
  const keyword = String(params.q || '').trim().slice(0, 100);
  if(keyword){
    const escaped = '%' + keyword.replace(/[!%_]/g, char => '!' + char) + '%';
    where.push("(p.title LIKE ? ESCAPE '!' OR p.content LIKE ? ESCAPE '!')");
    args.push(escaped, escaped);
  }
  if(params.feed === 'following'){
    if(!userId)
      fail('unauthenticated', 401);
    where.push('EXISTS(SELECT 1 FROM forum_follows f WHERE f.followed_id=p.poster_id AND f.follower_id=?)');
    args.push(userId);
  }
  if(params.author){
    where.push('p.poster_id=?');
    args.push(idOf(params.author));
  }
  const clause = where.join(' AND ');
  const order = params.sort === 'new'? 'p.created_at': 'p.last_activity_at';
  const [{total}] = await select(`SELECT COUNT(*) AS total FROM forum_posts p WHERE ${clause}`, args);
  // 先判页存在、再拼 OFFSET：越界请求只付一次 COUNT，不会跑一遍大偏移的查询。
  const pages = ensurePage(page, total, PAGE_SIZE);
  const items = await select(`${listSelect} WHERE ${clause} ORDER BY ${order} DESC,p.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, args);
  await enrichPostRows(items, userId);
  return {items, total: Number(total), page, pages};
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
 * 帖子详情：帖子本身 + 当页回复 + 投票/收藏/作者信息。
 *
 * 这一页的取法比较绕，两个设计点：
 *   1. **一页最多 30 条正文**，不把整段讨论拉出来排序（热门帖可以上千楼）。
 *   2. **「只看楼主」和正常分页共用一套偏移**：`own_priority` 先在同一个查询里给楼主回复打标，
 *      所以锚定某条回复（?reply=）时能算出它在第几页，而不用全表扫描。
 *
 * 删掉的帖子（非 published）直接 404 —— 没有「已撤回」这种中间态。
 * @param {string|number} id 帖子编号。
 * @param {number} [userId] 当前用户。
 * @param {string|number} [page] 页码。
 * @param {object} [options] 参数。
 * @param {string|number} [options.target] 要定位的回复编号。
 * @returns {Promise<object>} 帖子、回复与统计。
 */
export async function getPost(id, userId = 0, page = 1, {target = 0} = {}){
  id = idOf(id);
  page = pageOf(page);
  // 短读事务：帖子、当页回复与投票状态要来自同一个快照。
  return transaction(async c => {
    const [post] = await rows(c, `${listSelect} WHERE p.id=?`, [id]);
    if(!post || post.status !== 'published')
      fail('not_found', 404);
    const [{total}] = await rows(c, 'SELECT COUNT(*) AS total FROM forum_post_replies WHERE post_id=?', [id]);
    // 只有「对帖子的直接回复」参与分页；楼中楼跟着它的父回复走。
    const ownCondition = "poster_id=? AND parent_reply IS NULL AND status='published'";
    const [{own_total: ownTotal}] = await rows(c, `SELECT COUNT(*) AS own_total FROM forum_post_replies WHERE post_id=? AND ${ownCondition}`, [id, userId]);
    if(target){
      const [reply] = await rows(c, 'SELECT poster_id,parent_reply,status,sequence FROM forum_post_replies WHERE id=? AND post_id=?', [idOf(target), id]);
      if(!reply)
        fail('not_found', 404);
      const own = Number(reply.poster_id) === Number(userId) && !reply.parent_reply && reply.status === 'published';
      const [{before}] = await rows(c, `SELECT COUNT(*) AS \`before\` FROM forum_post_replies WHERE post_id=? AND ${own? `(${ownCondition}) AND sequence>?`: `NOT(${ownCondition}) AND sequence<?`}`, [id, userId, reply.sequence]);
      page = Math.floor((Number(before) + (own? 0: Number(ownTotal))) / REPLY_PAGE_SIZE) + 1;
    }
    const offset = (page - 1) * REPLY_PAGE_SIZE;
    // 同上：页码先过 ensurePage（?reply= 反推出来的页一定在范围内），越界就不必再取回复。
    const pages = ensurePage(page, total, REPLY_PAGE_SIZE);
    const ownLimit = Math.max(0, Math.min(REPLY_PAGE_SIZE, Number(ownTotal) - offset));
    // 回复行同样用别名回到旧字段名：author_id / body / parent_id。
    const replySelect = `SELECT r.*,r.poster_id AS author_id,r.parent_reply AS parent_id,r.content AS body,u.nickname,? AS own_priority,p.status AS parent_status,p.sequence AS parent_sequence,CASE WHEN p.status='published' THEN LEFT(p.content,160) ELSE '' END AS parent_excerpt,pu.nickname AS parent_name FROM forum_post_replies r JOIN users u ON u.id=r.poster_id LEFT JOIN forum_post_replies p ON p.id=r.parent_reply LEFT JOIN users pu ON pu.id=p.poster_id WHERE r.post_id=?`;
    const replies = ownLimit? await rows(c, `${replySelect} AND r.poster_id=? AND r.parent_reply IS NULL AND r.status='published' ORDER BY r.sequence DESC LIMIT ${ownLimit} OFFSET ${offset}`, [1, id, userId]): [];
    if(ownLimit < REPLY_PAGE_SIZE)
      replies.push(...await rows(c, `${replySelect} AND NOT(r.poster_id=? AND r.parent_reply IS NULL AND r.status='published') ORDER BY r.sequence LIMIT ${REPLY_PAGE_SIZE - ownLimit} OFFSET ${Math.max(0, offset - Number(ownTotal))}`, [0, id, userId]));
    const ids = replies.map(reply => reply.id);
    const voteRows = ids.length? await rows(c, `SELECT reply_id,COALESCE(SUM(vote_type='up'),0) AS up,COALESCE(SUM(vote_type='down'),0) AS down,COALESCE(MAX(CASE WHEN voter=? THEN vote_type END),'') AS mine FROM forum_reply_votes WHERE reply_id IN (${ids.map(() => '?').join(',')}) GROUP BY reply_id`, [userId, ...ids]): [];
    const voteMap = new Map(voteRows.map(row => [Number(row.reply_id), {up: Number(row.up), down: Number(row.down), mine: row.mine === 'up'? 1: row.mine === 'down'? -1: 0}]));
    for(const reply of replies){
      // 删掉的回复只留「有人在这里说过话」的位置，正文与昵称都不返回。
      if(reply.status !== 'published'){
        reply.body = '';
        reply.nickname = '';
      }
      reply.votes = voteMap.get(Number(reply.id)) || {up: 0, down: 0, mine: 0};
    }
    const [book] = await rows(c, 'SELECT 1 FROM forum_post_bookmarks WHERE user_id=? AND post_id=?', [userId, id]);
    return {
      topic: post,
      replies,
      page,
      pages,
      votes: await voteState(c, 'post', id, userId),
      bookmarked: Boolean(book),
      author: await authorInfo(c, post.poster_id, userId)
    };
  });
}

/**
 * 由回复编号反查它所在的地址（`/forum/replies/<id>/` 是回复的固定链接，跳到帖子 + 锚点）。
 * @param {string|number} id 回复编号。
 * @returns {Promise<string>} 帖子地址 + 锚点。
 */
export async function locateReply(id){
  const [reply] = await select('SELECT r.id,r.post_id FROM forum_post_replies r JOIN forum_posts p ON p.id=r.post_id WHERE r.id=? AND p.status=\'published\'', [idOf(id)]);
  if(!reply)
    fail('not_found', 404);
  return `/forum/topics/${reply.post_id}/?reply=${reply.id}#reply-${reply.id}`;
}

/**
 * 「我的」内容：帖子 / 回复 / 关注 / 粉丝 / 收藏 / 举报，一页 20 条。
 *
 * 五个分支的 SQL 差别很大，所以这里是一个显式的 if 链而不是拼通用的 where ——
 * 拼出来的 SQL 反而更难读，也更容易写出没走索引的查询。
 * 举报分栏要把两张表 UNION 起来，并带上 `kind` —— 两张表各自自增，编号会撞。
 * @param {number} userId 用户编号。
 * @param {string} tab 分栏。
 * @param {string|number} [page] 页码。
 * @returns {Promise<object>} 一页内容。
 */
export async function myContent(userId, tab, page = 1){
  page = pageOf(page);
  const offset = (page - 1) * PAGE_SIZE;
  let items;
  let total;
  let pages;
  if(tab === 'reports'){
    [{total}] = await select('SELECT (SELECT COUNT(*) FROM forum_post_reports WHERE reporter_id=?)+(SELECT COUNT(*) FROM forum_reply_reports WHERE reporter_id=?) AS total', [userId, userId]);
    pages = ensurePage(page, total, PAGE_SIZE);
    items = await select(`SELECT r.id,'post' AS kind,COALESCE(t.title,'内容已不可见') AS title,r.post_id AS topic_id,r.category AS reason,r.detail AS details,r.status,r.resolution,r.updated_at,r.created_at FROM forum_post_reports r LEFT JOIN forum_posts t ON t.id=r.post_id WHERE r.reporter_id=?
      UNION ALL
      SELECT r.id,'reply' AS kind,COALESCE(t.title,'内容已不可见') AS title,r.post_id AS topic_id,r.category AS reason,r.detail AS details,r.status,r.resolution,r.updated_at,r.created_at FROM forum_reply_reports r LEFT JOIN forum_posts t ON t.id=r.post_id WHERE r.reporter_id=?
      ORDER BY id DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`, [userId, userId]);
  }
  else if(tab === 'following' || tab === 'fans'){
    const own = tab === 'following'? 'follower_id': 'followed_id';
    const other = tab === 'following'? 'followed_id': 'follower_id';
    [{total}] = await select(`SELECT COUNT(*) AS total FROM forum_follows WHERE ${own}=?`, [userId]);
    pages = ensurePage(page, total, PAGE_SIZE);
    items = await select(`SELECT u.id,u.nickname,u.bio FROM forum_follows f JOIN users u ON u.id=f.${other} WHERE f.${own}=? ORDER BY f.created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`, [userId]);
  }
  else{
    let where = 'p.poster_id=?';
    let order = 'p.created_at';
    if(tab === 'replies'){
      // 「我回复过的帖子」按我最后一次回复的时间排，而不是帖子最后活动时间。
      where = "p.status='published' AND EXISTS(SELECT 1 FROM forum_post_replies r WHERE r.post_id=p.id AND r.poster_id=?)";
      order = '(SELECT MAX(r.created_at) FROM forum_post_replies r WHERE r.post_id=p.id AND r.poster_id=' + Number(userId) + ')';
    }
    if(tab === 'bookmarks')
      where = 'EXISTS(SELECT 1 FROM forum_post_bookmarks b WHERE b.post_id=p.id AND b.user_id=?)';
    [{total}] = await select(`SELECT COUNT(*) AS total FROM forum_posts p WHERE ${where}`, [userId]);
    pages = ensurePage(page, total, PAGE_SIZE);
    items = await select(`${listSelect} WHERE ${where} ORDER BY ${order} DESC,p.id DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`, [userId]);
    // 自己删掉的帖子在「我的」里留一个占位标题，正文不外露。
    for(const item of items){
      if(item.status !== 'published'){
        item.title = '已删除的讨论';
        item.body = '';
      }
    }
    if(tab === 'replies'){
      for(const item of items){
        const [reply] = await select("SELECT id FROM forum_post_replies WHERE post_id=? AND poster_id=? AND status='published' ORDER BY id DESC LIMIT 1", [item.id, userId]);
        if(reply)
          item.jump = `/forum/replies/${reply.id}/`;
      }
    }
    await enrichPostRows(items, userId);
  }
  return {items, total: Number(total), page, pages};
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
 * 某人回复过的帖子（公开主页的「回复」tab）。
 * @param {string|number} id 用户编号。
 * @param {string|number} [page] 页码。
 * @param {number} [viewer] 当前用户。
 * @returns {Promise<object>} 一页帖子。
 */
export async function publicReplies(id, page = 1, viewer = 0){
  id = idOf(id);
  page = pageOf(page);
  const where = `${POST_VISIBLE} AND EXISTS(SELECT 1 FROM forum_post_replies r WHERE r.post_id=p.id AND r.poster_id=? AND r.status='published')`;
  const [{total}] = await select(`SELECT COUNT(*) AS total FROM forum_posts p WHERE ${where}`, [id]);
  const pages = ensurePage(page, total, PAGE_SIZE);
  const items = await select(`${listSelect} WHERE ${where} ORDER BY p.last_activity_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, [id]);
  await enrichPostRows(items, viewer);
  return {items, total: Number(total), page, pages};
}

// ======================= 通知 =======================

/**
 * 通知列表。**文案是读的时候算的**，不是写入时存一份 ——
 * 帖子被删、点赞被撤回、关注被取消之后，旧通知不该继续显示已经不存在的内容。
 *
 * 四种目标各有一套取标题/链接的逻辑：私信举报、帖子/回复、举报结果、用户。
 * 算不出来时统一落到「相关内容已不可见」，并且不给链接。
 * 数据库里是 receiver / sender / category，SELECT 时别名回 user_id / actor_id / kind 供模板使用。
 * @param {number} userId 用户编号。
 * @param {string} [filter] all / replies / social / system / activity。
 * @param {string|number} [page] 页码。
 * @returns {Promise<{items: Array<object>, unread: number, total: number, page: number, pages: number}>} 一页通知。
 */
export async function notifications(userId, filter = 'all', page = 1){
  page = pageOf(page);
  const conditions = ['n.receiver=?',
    "(n.category<>'follow' OR EXISTS(SELECT 1 FROM forum_follows f WHERE f.follower_id=n.sender AND f.followed_id=n.receiver))",
    "(n.category<>'like' OR (n.target_type='post' AND EXISTS(SELECT 1 FROM forum_post_votes v JOIN forum_posts p ON p.id=v.post_id WHERE v.post_id=n.target_id AND v.voter=n.sender AND v.vote_type='up' AND p.status='published')) OR (n.target_type='reply' AND EXISTS(SELECT 1 FROM forum_reply_votes v JOIN forum_post_replies r ON r.id=v.reply_id JOIN forum_posts p ON p.id=r.post_id WHERE v.reply_id=n.target_id AND v.voter=n.sender AND v.vote_type='up' AND r.status='published' AND p.status='published')))"
  ];
  if(filter === 'replies')
    conditions.push("n.category='reply'");
  if(filter === 'social')
    conditions.push("n.category IN('like','follow')");
  // system 是「除社交以外」，用 NOT IN 覆盖（含未来新增的类型）。
  if(filter === 'system')
    conditions.push("n.category NOT IN('reply','like','follow')");
  if(filter === 'activity')
    conditions.push("n.category IN('reply','like','follow')");
  const clause = conditions.join(' AND ');
  const [{total}] = await select(`SELECT COUNT(*) AS total FROM forum_notifications n WHERE ${clause}`, [userId]);
  // 未读数只按前三条（本人 + 关注/点赞是否还有效）算，不跟着分栏变。
  const [{unread}] = await select(`SELECT COUNT(*) AS unread FROM forum_notifications n WHERE ${conditions.slice(0, 3).join(' AND ')} AND n.read_at IS NULL`, [userId]);
  const pages = ensurePage(page, total, PAGE_SIZE);
  const items = await select(`SELECT n.*,n.sender AS actor_id,n.category AS kind,u.nickname AS actor_name FROM forum_notifications n LEFT JOIN users u ON u.id=n.sender WHERE ${clause} ORDER BY n.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, [userId]);
  for(const item of items){
    item.href = '';
    item.title = '相关内容已不可见';
    if(item.target_type === 'dm_report'){
      const [row] = await select('SELECT r.reporter_id,r.resolution,r.conversation_id,m.sender_id FROM forum_dm_reports r JOIN forum_dm_messages m ON m.id=r.message_id WHERE r.id=?', [item.target_id]);
      // 只有举报人和被举报人能看这条结果通知，其他人拿到的是兜底文案。
      if(row && (Number(row.reporter_id) === Number(userId) || Number(row.sender_id) === Number(userId))){
        item.title = row.resolution || '举报处理结果';
        item.href = Number(row.reporter_id) === Number(userId)? '/profile/?tab=reports&kind=dm&report=' + item.target_id + '#dm-report-' + item.target_id: '/forum/messages/conversations/' + row.conversation_id + '/';
      }
    }
    if(item.target_type === 'user'){
      item.title = item.actor_name || '社区伙伴';
      item.href = `/forum/users/${item.target_id}/`;
    }
    if(item.target_type === 'post_report' || item.target_type === 'reply_report'){
      const table = item.target_type === 'post_report'? 'forum_post_reports': 'forum_reply_reports';
      const kind = item.target_type === 'post_report'? 'post': 'reply';
      const [row] = await select(`SELECT resolution,status FROM ${table} WHERE id=? AND reporter_id=?`, [item.target_id, userId]);
      item.title = row?.resolution || '举报处理结果';
      item.href = '/profile/?tab=reports&kind=' + kind + '#report-' + kind + '-' + item.target_id;
    }
    if(item.target_type === 'post' || item.target_type === 'reply'){
      const [target] = item.target_type === 'post'? await select('SELECT id,title,status FROM forum_posts WHERE id=?', [item.target_id]): await select('SELECT p.id,p.title,p.status,r.status AS reply_status FROM forum_post_replies r JOIN forum_posts p ON p.id=r.post_id WHERE r.id=?', [item.target_id]);
      if(target?.status === 'published' && (!target.reply_status || target.reply_status === 'published')){
        item.title = target.title;
        item.href = target.reply_status? `/forum/replies/${item.target_id}/`: `/forum/topics/${target.id}/`;
      }
      if(['content_deleted', 'content_restored'].includes(item.kind))
        item.title = item.kind === 'content_deleted'? '你的内容已被删除': '你的内容已恢复';
    }
  }
  return {items, unread: Number(unread), total: Number(total), page, pages};
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
  return write(user, key, 'notifications.read', async c => {
    if(ids === 'all')
      await rows(c, `UPDATE forum_notifications SET read_at=? WHERE receiver=? AND read_at IS NULL ${filter === 'all'? '': filter === 'system'? "AND category NOT IN('reply','like','follow')": "AND category IN('reply','like','follow')"}`, [new Date(), user.id]);
    else if(values.length)
      await rows(c, `UPDATE forum_notifications SET read_at=? WHERE receiver=? AND id IN (${values.map(() => '?').join(',')})`, [new Date(), user.id, ...values]);
    return {ok: true};
  });
}
