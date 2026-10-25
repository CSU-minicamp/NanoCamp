import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {handleRequest} from '../backend/app.mjs';
import {select,execute,closePool,dbReady} from '../backend/db.mjs';
import {hashPassword} from '../backend/auth.mjs';
import {moderation} from '../backend/forum.mjs';
import {renderMarkdown} from '../backend/forum-markdown.mjs';

test('论坛 Markdown 保留代码并阻止 HTML、图片、危险协议',()=>{
  const html=renderMarkdown('<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![image](https://x.test/a.png)\n\n```js\nconst x = "<img onerror=alert(1)>";\n```');
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('<pre>'));assert.ok(html.includes('&lt;img'));
});

test('真实 MySQL 论坛闭环、所有权、幂等、投票与举报处理',{skip:!dbReady()},async t=>{
  const salt=randomBytes(6).toString('hex'),users=[],password='Forum-test-password-2026';
  const cookies=new Map();
  async function call(actor,path,data,method=data?'POST':'GET',key=randomUUID()){
    const jar=cookies.get(actor)||new Map(),headers={host:'localhost:4187',origin:'http://localhost:4187',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),'x-nc-csrf':jar.get('nc_csrf')||'','idempotency-key':key};
    const response=await handleRequest({method,url:path,headers,body:data?JSON.stringify(data):null,ip:'127.0.0.1'});
    for(const cookie of [response.headers['set-cookie']||[]].flat()){const [name,...value]=cookie.split(';')[0].split('=');if(value.join('='))jar.set(name,value.join('='));else jar.delete(name);}
    cookies.set(actor,jar);const text=response.body.toString();return {...response,text,json:response.headers['content-type']?.includes('json')?JSON.parse(text):null};
  }
  let a,b,c,topic,reply,reportId;
  try{
    const hash=await hashPassword(password);
    for(const nickname of ['甲','乙','丙']){
      const email=`forum-${salt}-${nickname.codePointAt(0)}@example.test`,now=new Date();
      const r=await execute('INSERT INTO users(email,password_hash,nickname,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?)',[email,hash,nickname,now,now,now]);users.push(r.insertId);
      await call(r.insertId,'/api/session');assert.equal((await call(r.insertId,'/api/auth/login',{email,password})).status,200);
    }
    [a,b,c]=users;
    await t.test('公开浏览和登录回跳，私有页面不缓存',async()=>{
      assert.equal((await call(0,'/forum/')).status,200);
      const privatePage=await call(0,'/forum/me/');assert.equal(privatePage.status,303);assert.match(privatePage.headers.location,/login/);
      assert.equal((await call(a,'/forum/me/')).headers['cache-control'],'no-store');
      const center=await call(a,'/forum/me/');
      assert.ok(center.text.includes('data-account-profile'));
      assert.ok(center.text.includes('aria-label="个人中心"'));
      assert.ok(center.text.includes('/forum/me/?tab=profile'));
      assert.ok(!center.text.includes('header-notifications'));
      assert.ok(!center.text.includes('data-notifications-link'));
      assert.ok(center.text.includes('/login/?next=%2Fforum%2Fme%2F%3Ftab%3Dprofile'));
      assert.equal((await call(a,'/forum/notifications/')).status,303);
      const messages=await call(a,'/forum/messages/?tab=activity');
      assert.equal(messages.status,200);
      assert.ok(messages.text.includes('aria-label="论坛导航"'));
      assert.ok(messages.text.includes('href="/forum/messages/"')); 
      assert.ok(!center.text.includes('class="auth-panel"'));
      assert.equal((await call(a,'/forum/me/?tab=topics')).headers.location,'/forum/?view=topics');
      const feed=(await call(a,'/forum/')).text;
      assert.ok(feed.includes('aria-label="论坛导航"'));assert.ok(feed.includes('/forum/?view=topics'));assert.ok(feed.includes('/forum/?view=replies'));assert.ok(feed.includes('/forum/?view=following'));assert.ok(feed.includes('/forum/?view=bookmarks'));
      assert.ok(feed.indexOf('class="f-feed-search"')<feed.indexOf('aria-label="讨论分类"'));
      assert.ok(feed.includes('class="f-primary f-sidebar-compose"'));assert.ok(!feed.includes('<div class="f-top"><h1>社区论坛</h1><a'));
      assert.ok(!(await call(a,'/forum/me/')).text.includes('href="/forum/me/?tab=topics"'));
      for(const view of ['topics','replies','following','bookmarks']){assert.equal((await call(0,'/forum/?view='+view)).status,303);assert.equal((await call(a,'/forum/?view='+view)).status,200);}
      const csrf=await handleRequest({method:'POST',url:'/api/forum/topics',headers:{host:'localhost:4187'},body:'{}'});assert.equal(csrf.status,403);
    });
    await t.test('发布幂等、请求重用校验与安全渲染',async()=>{
      const key=randomUUID(),data={title:`测试讨论 ${salt}`,body:'这是完整的测试内容。\n\n<script>alert(1)</script>',category:'questions'};
      const created=await call(a,'/api/forum/topics',data,'POST',key);assert.equal(created.status,200);topic=created.json.id;
      assert.equal((await call(a,'/api/forum/topics',data,'POST',key)).json.id,topic);
      assert.equal((await call(a,'/api/forum/topics',{...data,title:'修改请求体'},'POST',key)).status,409);
      const page=await call(0,`/forum/topics/${topic}/`);assert.equal(page.status,200);assert.ok(!page.text.includes('<script>alert(1)</script>'));
    });
    await t.test('回复、定位、通知，以及错误引用回滚',async()=>{
      const r=await call(b,`/api/forum/topics/${topic}/replies`,{body:'这是一条明确的回复。'});assert.equal(r.status,200);reply=r.json.id;
      assert.equal((await call(b,`/api/forum/topics/${topic}/replies`,{body:'错误父级',parentId:999999999})).status,422);
      const data=(await call(a,`/api/forum/topics/${topic}`)).json;assert.equal(data.topic.reply_count,1);
      const authorView=(await call(a,`/forum/topics/${topic}/`)).text;
      assert.ok(authorView.includes(`class="f-withdraw" data-withdraw="topic:${topic}"`));
      assert.ok(!authorView.includes(`data-withdraw="reply:${reply}"`));
      assert.ok(authorView.indexOf('data-reply-composer')<authorView.indexOf('class="f-replies-heading"'));
      const replyAuthorView=(await call(b,`/forum/topics/${topic}/`)).text;
      assert.ok(replyAuthorView.includes(`class="f-withdraw" data-withdraw="reply:${reply}"`));
      assert.ok(!replyAuthorView.includes(`data-withdraw="topic:${topic}"`));
      assert.ok(!(await call(0,`/forum/topics/${topic}/`)).text.includes('class="f-withdraw"'));
      const messages=(await call(a,'/api/forum/notifications')).json;assert.ok(messages.items.some(n=>n.kind==='reply'&&n.target_id===reply));
      assert.match((await call(0,`/forum/replies/${reply}/`)).headers.location,new RegExp('#reply-'+reply));
    });
    await t.test('赞踩互斥、取消、匿名拒绝、不能自赞',async()=>{
      assert.equal((await call(a,`/api/forum/topics/${topic}/vote`,{value:1})).status,403);
      let v=await call(b,`/api/forum/topics/${topic}/vote`,{value:1});assert.deepEqual(v.json,{up:1,down:0,mine:1});
      v=await call(b,`/api/forum/topics/${topic}/vote`,{value:-1});assert.deepEqual(v.json,{up:0,down:1,mine:-1});
      assert.ok(!(await call(a,'/api/forum/notifications')).json.items.some(n=>n.kind==='like'));
      v=await call(b,`/api/forum/topics/${topic}/vote`,{value:0});assert.deepEqual(v.json,{up:0,down:0,mine:0});
      await Promise.all([call(b,`/api/forum/topics/${topic}/vote`,{value:1}),call(b,`/api/forum/topics/${topic}/vote`,{value:1})]);
      assert.equal((await call(b,`/api/forum/topics/${topic}`)).json.votes.up,1);
      assert.equal((await select('SELECT COUNT(*) n FROM forum_notifications WHERE user_id=? AND kind=?',[a,'like']))[0].n,1);
      assert.equal((await call(a,`/api/forum/replies/${reply}/vote`,{value:-1})).json.down,1);
    });
    await t.test('关注动态与关系、收藏可回访，取消后过滤',async()=>{
      assert.equal((await call(a,`/api/forum/users/${a}/follow`,{enabled:true})).status,403);
      await call(b,`/api/forum/users/${a}/follow`,{enabled:true});assert.ok((await call(b,'/api/forum/topics?feed=following')).json.items.some(t=>t.id===topic));
      assert.ok((await call(b,'/api/forum/me?tab=following')).json.items.some(u=>u.id===a));
      await call(b,`/api/forum/users/${a}/follow`,{enabled:false});assert.equal((await call(b,'/api/forum/topics?feed=following')).json.total,0);
      await call(b,`/api/forum/users/${a}/follow`,{enabled:true});assert.equal((await select('SELECT COUNT(*) n FROM forum_notifications WHERE user_id=? AND kind=?',[a,'follow']))[0].n,1);
      await call(b,`/api/forum/topics/${topic}/bookmark`,{enabled:true});assert.ok((await call(b,'/api/forum/me?tab=bookmarks')).json.items.some(t=>t.id===topic));
      const row=(await call(b,'/api/forum/topics?q='+encodeURIComponent(salt))).json.items.find(t=>t.id===topic);
      assert.equal(row.like_count,1);assert.equal(row.vote_mine,1);assert.equal(row.bookmark_count,1);assert.equal(row.bookmarked,true);
      const publicRow=(await call(0,'/api/forum/topics?q='+encodeURIComponent(salt))).json.items.find(t=>t.id===topic);
      assert.equal(publicRow.like_count,1);assert.equal(publicRow.vote_mine,0);assert.equal(publicRow.bookmark_count,1);assert.equal(publicRow.bookmarked,false);
      const saved=(await call(b,'/forum/?view=bookmarks')).text;assert.ok(saved.includes(`data-bookmark="${topic}" data-enabled="true"`));assert.ok(saved.includes('data-bookmark-count>1</span>'));
      assert.equal((await call(b,`/api/forum/topics/${topic}/bookmark`,{enabled:false})).json.count,0);
      await call(b,`/api/forum/topics/${topic}/bookmark`,{enabled:true});
    });
    await t.test('发布后帖子与评论不可修改，旧地址和修改接口关闭',async()=>{
      const data={title:'更新后的测试讨论',body:'更新后正文保留足够文字。',category:'projects',version:1};
      for(const actor of [0,a,b,c]){
        assert.equal((await call(actor,`/api/forum/topics/${topic}`,data,'PATCH')).status,405);
        assert.equal((await call(actor,`/api/forum/replies/${reply}`,{body:'不允许覆盖评论',version:1},'PATCH')).status,405);
        assert.equal((await call(actor,`/forum/topics/${topic}/edit/`)).status,404);
      }
      const result=(await call(a,`/api/forum/topics/${topic}`)).json;
      assert.equal(result.topic.title,`测试讨论 ${salt}`);assert.equal(result.topic.category,'questions');assert.equal(result.topic.version,1);
      assert.equal(result.replies[0].body,'这是一条明确的回复。');assert.equal(result.replies[0].version,1);
      const html=(await call(a,`/forum/topics/${topic}/`)).text;
      assert.ok(html.includes('data-withdraw="topic:'+topic+'"'));
      assert.ok(!html.includes('/edit/'));assert.ok(!html.includes('data-edit-reply'));assert.ok(!html.includes('forum-edit-dialog'));
    });
    await t.test('举报去重、非管理拒绝、结案反馈、隐藏和恢复',async()=>{
      const request={type:'reply',id:reply,reason:'其他',details:'需要社区核实的具体测试问题'};
      const report=await call(c,'/api/forum/reports',request);assert.equal(report.status,200);reportId=report.json.id;
      assert.equal((await call(c,'/api/forum/reports',request)).json.id,reportId);
      assert.equal((await call(a,'/api/forum/me?tab=reports')).json.total,0);
      await assert.rejects(()=>moderation(a,{reportId,version:1,action:'claim',reason:'开始检查这条测试内容'}),e=>e.code==='forbidden');
      await execute("INSERT INTO forum_members(user_id,role) VALUES (?,'admin')",[a]);
      assert.equal((await moderation(a,{reportId,version:1,action:'claim',reason:'开始检查这条测试内容'})).status,'reviewing');
      assert.equal((await call(c,`/api/forum/reports/${reportId}/withdraw`,{})).status,409);
      await moderation(a,{reportId,version:2,action:'uphold',reason:'已核实测试内容，隐藏该回复'});
      const detail=(await call(0,`/api/forum/topics/${topic}`)).json;assert.equal(detail.replies[0].body,'');assert.equal(detail.topic.reply_count,0);
      const reports=(await call(c,'/api/forum/me?tab=reports')).json;assert.equal(reports.items[0].status,'upheld');assert.match(reports.items[0].resolution,/已核实/);
      assert.ok((await call(c,'/api/forum/notifications')).json.items.some(n=>n.kind==='report_result'));
      await moderation(a,{reportId,version:3,action:'restore',reason:'测试完成，恢复公开回复'});
      assert.equal((await call(0,`/api/forum/topics/${topic}`)).json.topic.reply_count,1);
      const resultNotes=(await call(c,'/api/forum/notifications')).json.items.filter(n=>n.kind==='report_result');
      assert.ok(resultNotes.some(n=>n.title==='已核实测试内容，隐藏该回复'));
      assert.ok(resultNotes.some(n=>n.title==='测试完成，恢复公开回复'));
      const authorNotes=(await call(b,'/api/forum/notifications')).json.items;
      assert.equal(authorNotes.find(n=>n.kind==='content_hidden').title,'已核实测试内容，隐藏该回复');
      assert.equal(authorNotes.find(n=>n.kind==='content_restored').title,'测试完成，恢复公开回复');
    });
    await t.test('私有消息已读隔离与撤回内容保留上下文',async()=>{
      const notes=(await call(a,'/api/forum/notifications')).json.items;assert.ok(notes.length);
      await call(b,'/api/forum/notifications/read',{ids:notes.map(n=>n.id)});
      assert.ok((await call(a,'/api/forum/notifications')).json.unread>0);
      await call(a,'/api/forum/notifications/read',{ids:'all'});assert.equal((await call(a,'/api/forum/notifications')).json.unread,0);
      await call(a,`/api/forum/topics/${topic}/withdraw`,{});
      assert.equal((await call(b,`/api/forum/topics/${topic}/replies`,{body:'关闭后不能继续回复'})).status,409);
      const detail=(await call(0,`/api/forum/topics/${topic}`)).json;assert.equal(detail.topic.body,'');assert.equal(detail.replies[0].body,'这是一条明确的回复。');
      assert.ok(!(await call(0,'/api/forum/topics?q='+encodeURIComponent(`测试讨论 ${salt}`))).json.items.some(t=>t.id===topic));
    });
    await t.test('作者可撤回评论，主帖撤回后评论仍可自行撤回',async()=>{
      assert.equal((await call(a,`/api/forum/replies/${reply}/withdraw`,{})).status,403);
      assert.equal((await call(b,`/api/forum/topics/${topic}/withdraw`,{})).status,403);
      assert.equal((await call(b,`/api/forum/replies/${reply}/withdraw`,{})).status,200);
      assert.equal((await call(b,`/api/forum/replies/${reply}/withdraw`,{})).status,200);
      const detail=(await call(0,`/api/forum/topics/${topic}`)).json;
      assert.equal(detail.replies[0].body,'');assert.equal(detail.replies[0].status,'withdrawn');assert.equal(detail.topic.reply_count,0);
      const page=(await call(b,`/forum/topics/${topic}/`)).text;assert.ok(page.includes('这条回复已由作者撤回。'));
    });
    await t.test('滚动续载、跨批次回复层级、直达定位与隐藏过滤',async()=>{
      const created=await call(a,'/api/forum/topics',{title:'分页测试主题 '+salt,body:'用于验证分页下的稳定回复定位。',category:'projects'});assert.equal(created.status,200);const id=created.json.id;
      let last,first;
      for(let i=1;i<=31;i++){const now=new Date();const r=await execute('INSERT INTO forum_replies(topic_id,author_id,parent_id,body,sequence,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[id,b,i===31?first:null,'分页回复 '+i,i,now,now]);last=r.insertId;if(i===1)first=last;}
      await execute('UPDATE forum_topics SET reply_count=31 WHERE id=?',[id]);
      assert.equal((await call(0,`/api/forum/topics/${id}?page=2`)).json.replies.length,1);
      assert.equal((await call(0,`/forum/replies/${last}/`)).headers.location,`/forum/topics/${id}/?reply=${last}#reply-${last}`);
      const initial=await call(0,`/forum/topics/${id}/`);
      assert.equal((initial.text.match(/data-reply-id=/g)||[]).length,30);
      assert.ok(initial.text.includes('data-stream-next'));assert.ok(!initial.text.includes('class="f-pagination"'));
      const fragment=await call(0,`/forum/topics/${id}/?page=2&fragment=1`);
      assert.equal(fragment.status,200);assert.equal(fragment.headers['cache-control'],'no-store');
      assert.equal((fragment.text.match(/data-reply-id=/g)||[]).length,1);
      assert.ok(fragment.text.includes(`data-parent-id="${first}"`));assert.ok(fragment.text.includes('f-parent-excerpt'));assert.ok(!fragment.text.includes('<!doctype'));
      const detail=await call(0,`/forum/topics/${id}/?page=2`);assert.equal(detail.status,200);assert.ok(detail.text.includes('reply-'+last));assert.ok(!detail.text.includes('>发起讨论</a>'));
      assert.equal((detail.text.match(/data-reply-id=/g)||[]).length,1);
      assert.equal((await call(b,`/api/forum/topics/${id}`)).json.replies[0].sequence,30);
      assert.equal((await call(a,`/api/forum/topics/${id}`)).json.replies[0].id,first);
      await execute("UPDATE forum_replies SET status='hidden' WHERE id=?",[first]);
      const redacted=(await call(0,`/api/forum/topics/${id}?page=2`)).json.replies[0];
      assert.equal(redacted.parent_excerpt,'');assert.equal(redacted.parent_status,'hidden');
      assert.ok(!(await call(0,`/forum/topics/${id}/?page=2&fragment=1`)).text.includes('分页回复 1</span>'));
      await execute("UPDATE forum_replies SET status='hidden' WHERE id=?",[last]);
      assert.equal((await call(0,`/api/forum/topics/${id}?page=2`)).json.replies[0].body,'');
      const author=await call(0,`/forum/users/${a}/`);assert.equal(author.status,200);assert.ok(!author.text.includes('forum-'+salt));
    });
    await t.test('本人直接评论优先，定向回复不置顶，直达只读目标批次',async()=>{
      const now=new Date(),r=await execute('INSERT INTO forum_topics(author_id,category,title,body,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[a,'questions','评论优先测试 '+salt,'验证自己的新评论无需加载历史所有楼层。',now,now,now]),id=r.insertId;
      let priorOwn,parent;
      for(let i=1;i<=72;i++){const r=await execute('INSERT INTO forum_replies(topic_id,author_id,body,sequence,created_at,updated_at) VALUES (?,?,?,?,?,?)',[id,i===71?a:b,'评论顺序测试 '+i,i,now,now]);if(i===71)priorOwn=r.insertId;if(i===72)parent=r.insertId;}
      await execute('UPDATE forum_topics SET reply_count=72 WHERE id=?',[id]);
      const created=await call(a,`/api/forum/topics/${id}/replies`,{body:'本人新发布的定向评论。',parentId:parent});assert.equal(created.status,200);const fresh=created.json.id;
      assert.equal(created.json.href,`/forum/topics/${id}/#reply-${fresh}`);
      const own=(await call(a,`/api/forum/topics/${id}`)).json.replies;
      assert.equal(own.length,30);assert.equal(own[0].id,priorOwn);assert.equal(own[0].own_priority,1);assert.equal(own[1].sequence,1);assert.ok(!own.some(r=>r.id===fresh));
      const page=(await call(a,`/forum/topics/${id}/`)).text;assert.equal((page.match(/data-reply-id=/g)||[]).length,30);assert.ok(!page.includes(`data-reply-id="${fresh}"`));
      assert.equal((await call(b,`/api/forum/topics/${id}`)).json.replies[0].id,parent);
      assert.equal((await call(c,`/api/forum/topics/${id}`)).json.replies[0].sequence,1);
      const target=(await call(c,`/api/forum/topics/${id}?reply=${fresh}`)).json;assert.equal(target.page,3);assert.equal(target.replies.length,13);assert.ok(target.replies.some(r=>r.id===fresh));assert.equal(target.replies.at(-1).parent_id,parent);
      const fragment=await call(a,`/forum/topics/${id}/?reply=${fresh}&fragment=1`);assert.ok(fragment.text.indexOf(`data-reply-id="${parent}"`)<fragment.text.indexOf(`data-reply-id="${fresh}"`));assert.ok(fragment.text.includes('f-reply-children'));assert.ok(fragment.text.includes('f-parent-excerpt'));
      assert.equal(((await call(c,`/forum/topics/${id}/?reply=${fresh}`)).text.match(/data-reply-id=/g)||[]).length,13);
      const second=(await call(a,`/forum/topics/${id}/?page=2&fragment=1`)).text;assert.ok(!second.includes(`data-reply-id="${fresh}"`));
      const direct=await call(a,`/api/forum/topics/${id}/replies`,{body:'直接回复主帖，在本人视角优先。'});assert.equal(direct.status,200);
      const promoted=(await call(a,`/api/forum/topics/${id}`)).json.replies;assert.equal(promoted.length,30);assert.equal(promoted[0].id,direct.json.id);assert.equal(promoted[1].id,priorOwn);assert.equal(promoted[0].parent_id,null);
      assert.equal((await call(c,`/api/forum/topics/${id}`)).json.replies[0].sequence,1);
      const directTarget=(await call(a,`/api/forum/topics/${id}?reply=${direct.json.id}`)).json;assert.equal(directTarget.page,1);assert.equal(directTarget.replies.length,30);
      await call(a,`/api/forum/replies/${fresh}/withdraw`,{});assert.equal((await call(a,`/api/forum/topics/${id}`)).json.replies[0].id,direct.json.id);
      await call(a,`/api/forum/replies/${direct.json.id}/withdraw`,{});assert.equal((await call(a,`/api/forum/topics/${id}`)).json.replies[0].id,priorOwn);
    });
    await t.test('帖子列表续载保留搜索条件且私有片段不能匿名读取',async()=>{
      const tag='滚动列表'+salt,now=new Date();
      for(let i=0;i<21;i++)await execute('INSERT INTO forum_topics(author_id,category,title,body,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[b,'projects',tag+' '+i,'滚动列表测试正文内容。',now,now,now]);
      const path='/forum/?q='+encodeURIComponent(tag)+'&category=projects&sort=new';
      const first=await call(0,path),second=await call(0,path+'&page=2&fragment=1');
      assert.equal((first.text.match(/class="f-topic-row"/g)||[]).length,20);
      assert.equal((second.text.match(/class="f-topic-row"/g)||[]).length,1);
      assert.ok(!first.text.includes('class="f-pagination"'));assert.ok(first.text.includes('fragment=1'));
      assert.equal((await call(0,'/forum/me/?tab=topics&page=2&fragment=1')).status,303);
      assert.equal((await call(0,'/forum/?feed=following&page=2&fragment=1')).status,303);
    });
    await t.test('举报撤回和驳回有终态；禁言不妨碍阅读和消息已读',async()=>{
      const id=(await call(a,'/api/forum/topics',{title:'举报终态测试 '+salt,body:'用于验证举报撤回与驳回的独立内容。',category:'questions'})).json.id;
      const r=(await call(b,'/api/forum/reports',{type:'topic',id,reason:'其他',details:'测试举报撤回过程'})).json.id;
      assert.equal((await call(b,`/api/forum/reports/${r}/withdraw`,{})).status,200);
      const r2=(await call(c,'/api/forum/reports',{type:'topic',id,reason:'其他',details:'测试举报驳回过程'})).json.id;
      assert.equal((await moderation(a,{reportId:r2,version:1,action:'dismiss',reason:'核对后未发现需要处理的问题'})).status,'dismissed');
      await execute('INSERT INTO forum_members(user_id,suspended_until) VALUES (?,?)',[c,new Date(Date.now()+3600000)]);
      assert.equal((await call(c,`/api/forum/topics/${id}/vote`,{value:1})).status,403);
      assert.equal((await call(c,`/forum/topics/${id}/`)).status,200);
      assert.equal((await call(c,'/api/forum/notifications/read',{ids:'all'})).status,200);
    });
  }finally{
    // Remove only this run's fixture users and their dependent records.
    if(users.length){const marks=users.map(()=>'?').join(',');
      const own=await select(`SELECT id FROM forum_topics WHERE author_id IN (${marks})`,users),topicIds=own.map(t=>t.id);
      if(topicIds.length){const ts=topicIds.map(()=>'?').join(',');const rs=await select(`SELECT id FROM forum_replies WHERE topic_id IN (${ts})`,topicIds);
        if(rs.length)await execute(`DELETE FROM forum_reply_votes WHERE target_id IN (${rs.map(()=>'?').join(',')})`,rs.map(r=>r.id));
        await execute(`DELETE FROM forum_topic_votes WHERE target_id IN (${ts})`,topicIds);await execute(`DELETE FROM forum_bookmarks WHERE topic_id IN (${ts})`,topicIds);await execute(`DELETE FROM forum_reports WHERE topic_id IN (${ts})`,topicIds);
        await execute(`UPDATE forum_replies SET parent_id=NULL WHERE topic_id IN (${ts})`,topicIds);
        await execute(`DELETE FROM forum_replies WHERE topic_id IN (${ts})`,topicIds);await execute(`DELETE FROM forum_topics WHERE id IN (${ts})`,topicIds);
      }
      for(const table of ['forum_audit','forum_revisions'])await execute(`DELETE FROM ${table} WHERE actor_id IN (${marks})`,users);
      await execute(`DELETE FROM users WHERE id IN (${marks})`,users);
    }
    await closePool();
  }
});
