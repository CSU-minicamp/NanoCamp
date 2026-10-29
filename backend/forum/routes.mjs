// 论坛的 HTTP 边界：/forum/* 的页面与 /api/forum/* 的接口。
//
// 这里只做「解析请求 → 调业务 → 拼响应」，不含任何 SQL。放在单独文件的理由很实际：
// 加页面、加接口是最高频的改动，而它们与写入逻辑、读逻辑的检查方式完全不同
// （这里看的是状态码、cookie、参数校验，业务层看的是事务与权限）。
// 依赖方向：本文件 → index.mjs / read.mjs / images.mjs，三个都不认识它。
import {CommunityError, fail, idOf} from './base.mjs';
import {missingFields, readSession} from '../auth.mjs';
import {parseCookies, sameOrigin} from '../base.mjs';
import {dbReady, isUnavailable} from '../db.mjs';
import * as dm from './dm.mjs';
import {authorPage, composePage, forumDocument, forumIndex, messagePage, personalAccountPage, personalPage, personalTabs, topicDetail} from '../../src/forum.mjs';
import {renderMarkdown} from '../../src/markdown.mjs';
import {dmReportPage, messageCenter} from '../../src/messages.mjs';
import {createPost, createReply, deleteContent, vote, follow, bookmark, report, withdrawReport} from './index.mjs';
import {listPosts, publicUser, getPost, locateReply, myContent, relations, publicReplies, notifications, markRead} from './read.mjs';
import {uploadForumImage, readForumImage} from './images.mjs';

// ======================= 页面 =======================

/** 303 跳转（表单页与回复固定链接都走它）。 */
const redirect = href => ({status: 303, headers: {location: href, 'cache-control': 'no-store'}, body: Buffer.alloc(0)});

/** 页面响应一律 no-store：每条都带当前用户。 */
const htmlResponse = body => ({status: 200, headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}, body: Buffer.from(body)});

/**
 * 论坛的页面路由：/forum/* 与 /profile/ 的各个 tab。
 *
 * 三种情况先在服务端分流，而不是渲染一张用不了的表单：
 *   私人页面且未登录 → 303 登录页（带 next）
 *   需要完整资料且缺项 → 303 补全页（带 next）
 *   其余照常渲染
 *
 * @param {object} request 请求描述。
 * @param {string} request.url 原始地址（含查询串）。
 * @param {object} request.headers 请求头。
 * @returns {Promise<object>} 响应描述。
 */
export async function handleForumPage({url, headers}){
  const target = new URL(url, 'http://localhost');
  const path = target.pathname;
  if(!path.endsWith('/'))
    return redirect(path + '/' + target.search);
  try{
    if(!dbReady())
      fail('unavailable', 503);
    const token = parseCookies(headers.cookie).nc_sid;
    const session = token? await readSession(token): null;
    const user = session?.user || null;
    const params = Object.fromEntries(target.searchParams);
    // 「只看关注/收藏…」是登录后才有的视图，未登录看首页时不该被拦，所以这里单独判断。
    const forumView = ['topics', 'replies', 'following', 'bookmarks'].includes(params.view)? params.view: '';
    const privatePage = path.startsWith('/forum/messages/') || path === '/forum/new/' || path === '/profile/' || params.feed === 'following' || path === '/forum/' && Boolean(forumView);
    if(privatePage && !user)
      return redirect('/login/?next=' + encodeURIComponent(path + target.search));
    if((path === '/forum/new/' || path === '/profile/') && missingFields(user).length)
      return redirect('/profile/force/?next=' + encodeURIComponent(path + target.search));
    let body;
    let title = '社区论坛';
    let topicId = 0;
    if(path.startsWith('/forum/messages/')){
      title = '消息';
      const match = path.match(/^\/forum\/messages\/conversations\/(\d+)\/$/);
      if(path === '/forum/messages/' && ['activity', 'system'].includes(params.tab)){
        const filter = params.tab === 'system'? 'system': ['replies', 'social'].includes(params.filter)? params.filter: 'activity';
        body = messagePage(await notifications(user.id, filter, params.page), filter, user, url);
      }
      else if(path === '/forum/messages/' || path === '/forum/messages/new/' || match){
        if(path.endsWith('/new/') && missingFields(user).length)
          return redirect('/profile/force/?next=' + encodeURIComponent(path + target.search));
        const chat = match? await dm.messages(user, match[1]): null;
        let peer = null;
        if(path === '/forum/messages/new/' && params.to){
          const recipient = await dm.recipient(user, params.to);
          if(recipient.conversation_id)
            return redirect('/forum/messages/conversations/' + recipient.conversation_id + '/');
          peer = recipient.peer;
        }
        body = messageCenter({user, list: await dm.conversations(user), chat, peer, select: path === '/forum/messages/new/'});
      }
      else
        fail('not_found', 404);
    }
    else if(path === '/forum/')
      body = forumIndex(forumView? await myContent(user.id, forumView, params.page): await listPosts(params, user?.id), {...params, view: forumView}, user, url);
    else if(path === '/forum/new/'){
      body = composePage();
      title = '发起讨论';
    }
    else if(path === '/profile/'){
      const tab = params.tab === 'security'? 'security': personalTabs.some(entry => entry[0] === params.tab)? params.tab: 'profile';
      // 参与类 tab 其实是论坛列表，统一交给 /forum/?view= 渲染，个人中心只留资料相关的那几个。
      if(['topics', 'replies', 'following', 'bookmarks'].includes(tab)){
        const next = new URL('/forum/', 'http://localhost');
        next.searchParams.set('view', tab);
        if(params.page)
          next.searchParams.set('page', params.page);
        if(params.fragment === '1')
          next.searchParams.set('fragment', '1');
        return redirect(next.pathname + next.search);
      }
      body = tab === 'reports' && params.kind === 'dm'
        ? dmReportPage(await dm.reports(user, params), user)
        : ['profile', 'security'].includes(tab)? personalAccountPage(user, tab): personalPage(await myContent(user.id, tab, params.page), tab, user, url);
      title = '个人中心';
    }
    else if(path.match(/^\/forum\/replies\/\d+\/$/))
      return redirect(await locateReply(path.split('/')[3]));
    else if(path.match(/^\/forum\/users\/\d+\/$/)){
      const id = idOf(path.split('/')[3]);
      const author = await publicUser(id, user?.id);
      const tab = ['topics', 'replies', 'following', 'fans'].includes(params.tab)? params.tab: 'topics';
      let data;
      if(tab === 'topics')
        data = await listPosts({author: id, page: params.page}, user?.id);
      else if(tab === 'following' || tab === 'fans')
        data = await relations(id, tab, params.page);
      else
        data = await publicReplies(id, params.page, user?.id);
      // canMessage 由这一层决定：模板不该自己去读 config（那是后端的事）。
      body = authorPage(author, {...data, canMessage: dm.messagesEnabled()}, tab, user, url);
      title = author.nickname + '的主页';
    }
    else if(path.match(/^\/forum\/topics\/\d+\/$/)){
      topicId = idOf(path.split('/')[3]);
      const data = await getPost(topicId, user?.id, params.page, {target: params.reply});
      body = topicDetail({...data, canMessage: dm.messagesEnabled()}, user, url);
      title = data.topic.title;
    }
    else
      fail('not_found', 404);
    // fragment=1 是无限滚动的局部刷新：只回列表片段，不回整页。
    if(params.fragment === '1'){
      if(!body.includes('data-stream-items'))
        fail('not_found', 404);
      return htmlResponse(body);
    }
    // 个人中心不属于任何一个主导航项：active 给 'account'（navLinks 里没有这个 key）⇒ 九项都不高亮。
    // 不用 'profile'（force 页用的那个值）是因为 documentPage 会给它额外加载 auth.css，个人中心的样式在 forum.css / messages.css 里。
    const html = forumDocument({body, title, user, route: path, topicId, active: path === '/profile/'? 'account': 'forum'});
    // 个人中心页面额外加载账号脚本（头像圆要按会话状态初始化）。
    return htmlResponse(path === '/profile/'? html.replace('</head>', '<script defer src="/account.js"></script></head>'): html);
  }
  catch(error){
    const status = error instanceof CommunityError? error.status: isUnavailable(error) || error.code === 'ER_NO_SUCH_TABLE'? 503: 500;
    if(status >= 500)
      console.error('[forum:page]', path, error.code || '', error.message);
    const title = status === 404? '内容不存在或已隐藏': status === 403? '你没有权限访问': status === 409? '内容状态已变化': status === 503? '论坛暂时不可用': '页面暂时无法打开';
    return {
      status,
      headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'},
      body: Buffer.from(forumDocument({title, route: path, body: `<section class="f-empty"><h1>${title}</h1><a class="f-primary" href="/forum/">返回论坛</a></section>`}))
    };
  }
}

// ======================= 接口 =======================

/**
 * 接口响应。论坛接口一律 no-store（都带会话状态）。
 * @param {number} status 状态码。
 * @param {object} data 响应体。
 * @returns {object} 响应描述。
 */
const response = (status, data) => ({status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}, body: Buffer.from(JSON.stringify(data))});

/**
 * 论坛的接口路由：/api/forum/*。
 *
 * 读接口（GET）不要求登录，但会带上会话以决定"我有没有点过赞"；写接口（POST）过两道闸（同源 + CSRF），
 * 并且必须有幂等键 —— 网络重试不能写出两条帖子。
 *
 * @param {object} request 请求描述。
 * @param {string} request.method HTTP 方法。
 * @param {string} request.url 原始地址（含查询串）。
 * @param {object} [request.headers] 请求头。
 * @param {string|Buffer|null} [request.body] 原始请求体。
 * @returns {Promise<object>} 响应描述。
 */
export async function handleForumApi({method, url, headers = {}, body}){
  try{
    if(!dbReady())
      return response(503, {error: 'unavailable'});
    const target = new URL(url, 'http://localhost');
    const path = target.pathname.replace(/\/$/, '');
    const query = Object.fromEntries(target.searchParams);
    const cookies = parseCookies(headers.cookie);
    const session = cookies.nc_sid? await readSession(cookies.nc_sid): null;
    const user = session?.user || null;
    // 图片是二进制，单独一条（要处理 HEAD 与 304），所以放在 JSON 路由之前。
    // 编号是自增数字（字节对象的 key 在库里另存，不出现在 URL 上）。
    const imageMatch = path.match(/^\/api\/forum\/images\/([1-9]\d{0,14})$/);
    if(imageMatch && ['GET', 'HEAD'].includes(method)){
      const image = await readForumImage(imageMatch[1], user?.id);
      const etag = `"${image.meta.etag}"`;
      const imageHeaders = {'content-type': image.meta.content_type, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline', etag};
      if(headers['if-none-match'] === etag)
        return {status: 304, headers: imageHeaders, body: Buffer.alloc(0)};
      return {status: 200, headers: {...imageHeaders, 'content-length': String(image.bytes.length)}, body: method === 'HEAD'? Buffer.alloc(0): image.bytes};
    }
    if(method === 'GET'){
      // 私信的两组读接口交给 dm.mjs：它自己的数据自己负责分页与可见性。
      if(path.startsWith('/api/forum/dm/') || path === '/api/forum/message-summary')
        return response(200, await dm.getDm(user, path, query));
      if(path === '/api/forum/topics')
        return response(200, await listPosts(query, user?.id));
      if(path.match(/^\/api\/forum\/topics\/\d+$/))
        return response(200, await getPost(path.split('/').at(-1), user?.id, query.page, {target: query.reply}));
      if(path === '/api/forum/me'){
        if(!user)
          fail('unauthenticated', 401);
        return response(200, await myContent(user.id, query.tab, query.page));
      }
      if(path === '/api/forum/notifications'){
        if(!user)
          fail('unauthenticated', 401);
        return response(200, await notifications(user.id, query.filter, query.page));
      }
      const author = path.match(/^\/api\/forum\/users\/(\d+)$/);
      if(author)
        return response(200, await publicUser(author[1], user?.id));
      return response(404, {error: 'not_found'});
    }
    if(method !== 'POST')
      return response(405, {error: 'method_not_allowed'});
    // 写接口两道闸：同源 Origin + double-submit 令牌。
    if(!sameOrigin(headers) || !cookies.nc_csrf || headers['x-nc-csrf'] !== cookies.nc_csrf)
      return response(403, {error: 'csrf_invalid'});
    if(!user)
      fail('unauthenticated', 401);
    if(path === '/api/forum/images')
      return response(201, await uploadForumImage(user, headers['idempotency-key'], body, headers['content-type']));
    // 下面是 JSON 接口：先限长再解析，别让 1 MB 的垃圾 JSON 进 JSON.parse。
    const raw = Buffer.isBuffer(body)? body.toString(): String(body || '');
    if(Buffer.byteLength(raw) > 64 * 1024)
      return response(413, {error: 'request_too_large'});
    let data;
    try{
      data = JSON.parse(raw);
    }
    catch{
      return response(400, {error: 'invalid_json'});
    }
    if(!data || typeof data !== 'object' || Array.isArray(data))
      return response(400, {error: 'invalid_json'});
    const key = headers['idempotency-key'];
    if(path.startsWith('/api/forum/dm/'))
      return response(200, await dm.postDm(user, key, path, data));
    if(path === '/api/forum/preview')
      // 预览只渲染，不落库；images 关掉，避免草稿图在预览阶段就被当成"已发布"。
      return response(200, {html: renderMarkdown(String(data.body || '').slice(0, 15000), {images: data.images === true})});
    if(path === '/api/forum/topics')
      return response(200, await createPost(user, key, data));
    let match = path.match(/^\/api\/forum\/(topics|replies)\/(\d+)(?:\/(vote|withdraw|bookmark|replies))?$/);
    if(match){
      // URL 仍叫 topics/replies（前端与旧链接都不动），业务层的种类叫 post/reply（与表名一致）。
      const kind = match[1] === 'topics'? 'post': 'reply';
      const id = match[2];
      const action = match[3];
      if(action === 'vote')
        return response(200, await vote(user, key, kind, id, data.value));
      if(action === 'withdraw')
        return response(200, await deleteContent(user, key, kind, id));
      if(kind === 'post' && action === 'bookmark')
        return response(200, await bookmark(user, key, id, data.enabled));
      if(kind === 'post' && action === 'replies')
        return response(200, await createReply(user, key, id, data));
    }
    match = path.match(/^\/api\/forum\/users\/(\d+)\/follow$/);
    if(match)
      return response(200, await follow(user, key, match[1], data.enabled));
    if(path === '/api/forum/reports')
      return response(200, await report(user, key, data));
    match = path.match(/^\/api\/forum\/reports\/(post|reply)\/(\d+)\/withdraw$/);
    if(match)
      return response(200, await withdrawReport(user, key, match[1], match[2]));
    if(path === '/api/forum/notifications/read')
      return response(200, await markRead(user, key, data.ids, data.filter));
    return response(404, {error: 'not_found'});
  }
  catch(error){
    if(error instanceof CommunityError){
      const result = response(error.status, {error: error.code, ...(error.retryAfter? {retry_after: error.retryAfter}: {})});
      if(error.retryAfter)
        result.headers['retry-after'] = String(error.retryAfter);
      return result;
    }
    console.error('[forum:api]', method, url, error.code || '', error.message);
    // 表还没建（ER_NO_SUCH_TABLE）算"暂时不可用"：部署顺序可能先起服务后跑迁移。
    const unavailable = isUnavailable(error) || error.code === 'ER_NO_SUCH_TABLE';
    return response(unavailable? 503: 500, {error: unavailable? 'unavailable': 'internal_error'});
  }
}
