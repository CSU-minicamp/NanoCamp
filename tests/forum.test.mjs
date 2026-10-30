import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {handleRequest} from '../backend/app.mjs';
import {select,execute,closePool,dbReady} from '../backend/db.mjs';
import {hashPassword} from '../backend/auth.mjs';
import {moderation} from '../backend/forum/index.mjs';
import {renderMarkdown} from '../src/markdown.mjs';

test('读路径不给旧名别名：模板与 JSON 直接用物理列名',()=>{
  const source=readFileSync(new URL('../backend/forum/read.mjs',import.meta.url),'utf8');
  // 别名少写一个不会报错，只会让页面静默空白 —— 所以这里钉住「不许再把 poster_id 翻译回 author_id」。
  // 只放行「同一行两个角色撞名」的消歧别名（parent_status / parent_sequence / reply_status 这类）。
  for(const alias of ['author_id','body','parent_id','actor_id','actor_name','details','reason','topic_id'])
    assert.ok(!source.includes(`AS ${alias}`),`read.mjs 里不该再出现 AS ${alias}`);
});

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
      const privatePage=await call(0,'/profile/');assert.equal(privatePage.status,303);assert.match(privatePage.headers.location,/login/);
      assert.equal((await call(a,'/profile/')).headers['cache-control'],'no-store');
      const center=await call(a,'/profile/');
      assert.ok(center.text.includes('data-account-profile'));
      assert.ok(center.text.includes('aria-label="个人中心"'));
      assert.ok(center.text.includes('/profile/?tab=profile'));
      assert.ok(!center.text.includes('header-notifications'));
      assert.ok(center.text.includes('href="/login/" data-account-entry'));
      // 旧地址已经删掉：论坛/私信都还没上线过，没有需要照顾的外链。
      assert.equal((await call(a,'/forum/notifications/')).status,404);
      const messages=await call(a,'/forum/messages/?tab=activity');
      assert.equal(messages.status,200);
      assert.ok(messages.text.includes('aria-label="论坛导航"'));
      assert.equal((await call(a,'/forum/me/?tab=topics')).status,404);
      const feed=(await call(a,'/forum/')).text;
      assert.ok(feed.includes('/forum/?view=topics'));assert.ok(feed.includes('/forum/?view=bookmarks'));
      assert.ok(feed.indexOf('class="f-feed-search"')<feed.indexOf('aria-label="讨论分类"'));
      assert.ok(!(await call(a,'/profile/')).text.includes('href="/profile/?tab=topics"'));
      for(const view of ['topics','replies','following','bookmarks']){assert.equal((await call(0,'/forum/?view='+view)).status,303);assert.equal((await call(a,'/forum/?view='+view)).status,200);}
      const csrf=await handleRequest({method:'POST',url:'/api/forum/topics',headers:{host:'localhost:4187'},body:'{}'});assert.equal(csrf.status,403);
    });
    await t.test('发布幂等（client_request_key）、同键换内容仍拒绝',async()=>{
      const key=randomUUID(),data={title:`测试讨论 ${salt}`,body:'这是完整的测试内容。\n\n<script>alert(1)</script>',category:'questions'};
      const created=await call(a,'/api/forum/topics',data,'POST',key);assert.equal(created.status,200);topic=created.json.id;
      assert.equal((await call(a,'/api/forum/topics',data,'POST',key)).json.id,topic);
      // 同一个键换了内容：唯一键兜住，返回的仍是第一帖（不会写出第二条）
      assert.equal((await call(a,'/api/forum/topics',{...data,title:'修改请求体'},'POST',key)).json.id,topic);
      assert.equal((await select('SELECT COUNT(*) n FROM forum_posts WHERE client_request_key=?',[key]))[0].n,1);
      const page=await call(0,`/forum/topics/${topic}/`);assert.equal(page.status,200);assert.ok(!page.text.includes('<script>alert(1)</script>'));
    });
    await t.test('回复发号、定位、通知，以及错误父级',async()=>{
      const r=await call(b,`/api/forum/topics/${topic}/replies`,{body:'这是一条明确的回复。'});assert.equal(r.status,200);reply=r.json.id;
      assert.equal((await call(b,`/api/forum/topics/${topic}/replies`,{body:'错误父级',parentId:999999999})).status,422);
      const data=(await call(a,`/api/forum/topics/${topic}`)).json;assert.equal(data.topic.reply_count,1);
      assert.equal(data.replies[0].sequence,1);
      const authorView=(await call(a,`/forum/topics/${topic}/`)).text;
      assert.ok(authorView.includes(`class="f-withdraw" data-withdraw="post:${topic}"`));
      assert.ok(!authorView.includes(`data-withdraw="reply:${reply}"`));
      assert.ok(!(await call(0,`/forum/topics/${topic}/`)).text.includes('class="f-withdraw"'));
      assert.ok((await call(a,'/api/forum/notifications')).json.items.some(n=>n.category==='reply'&&n.target_id===reply));
      assert.match((await call(0,`/forum/replies/${reply}/`)).headers.location,new RegExp('#reply-'+reply));
    });
    await t.test('赞踩互斥、取消、匿名拒绝、不能自赞',async()=>{
      assert.equal((await call(a,`/api/forum/topics/${topic}/vote`,{value:1})).status,403);
      let v=await call(b,`/api/forum/topics/${topic}/vote`,{value:1});assert.deepEqual(v.json,{up:1,down:0,mine:1});
      v=await call(b,`/api/forum/topics/${topic}/vote`,{value:-1});assert.deepEqual(v.json,{up:0,down:1,mine:-1});
      assert.ok(!(await call(a,'/api/forum/notifications')).json.items.some(n=>n.category==='like'));
      v=await call(b,`/api/forum/topics/${topic}/vote`,{value:0});assert.deepEqual(v.json,{up:0,down:0,mine:0});
      await Promise.all([call(b,`/api/forum/topics/${topic}/vote`,{value:1}),call(b,`/api/forum/topics/${topic}/vote`,{value:1})]);
      assert.equal((await call(b,`/api/forum/topics/${topic}`)).json.votes.up,1);
      assert.equal((await select('SELECT COUNT(*) n FROM forum_notifications WHERE receiver=? AND category=?',[a,'like']))[0].n,1);
      assert.equal((await call(a,`/api/forum/replies/${reply}/vote`,{value:-1})).json.down,1);
    });
    await t.test('关注动态与关系、收藏可回访，取消后过滤',async()=>{
      assert.equal((await call(a,`/api/forum/user/${a}/follow`,{enabled:true})).status,403);
      await call(b,`/api/forum/user/${a}/follow`,{enabled:true});assert.ok((await call(b,'/api/forum/topics?feed=following')).json.items.some(x=>x.id===topic));
      assert.ok((await call(b,'/api/forum/me?tab=following')).json.items.some(u=>u.id===a));
      await call(b,`/api/forum/user/${a}/follow`,{enabled:false});assert.equal((await call(b,'/api/forum/topics?feed=following')).json.total,0);
      await call(b,`/api/forum/user/${a}/follow`,{enabled:true});assert.equal((await select('SELECT COUNT(*) n FROM forum_notifications WHERE receiver=? AND category=?',[a,'follow']))[0].n,1);
      await call(b,`/api/forum/topics/${topic}/bookmark`,{enabled:true});assert.ok((await call(b,'/api/forum/me?tab=bookmarks')).json.items.some(x=>x.id===topic));
      const row=(await call(b,'/api/forum/topics?q='+encodeURIComponent(salt))).json.items.find(x=>x.id===topic);
      assert.equal(row.like_count,1);assert.equal(row.vote_mine,1);assert.equal(row.bookmark_count,1);assert.equal(row.bookmarked,true);
      const publicRow=(await call(0,'/api/forum/topics?q='+encodeURIComponent(salt))).json.items.find(x=>x.id===topic);
      assert.equal(publicRow.vote_mine,0);assert.equal(publicRow.bookmarked,false);
      assert.equal((await call(b,`/api/forum/topics/${topic}/bookmark`,{enabled:false})).json.count,0);
      await call(b,`/api/forum/topics/${topic}/bookmark`,{enabled:true});
    });
    await t.test('发布后不可编辑：PATCH、编辑页、旧字段全部关闭',async()=>{
      const data={title:'更新后的测试讨论',body:'更新后正文保留足够文字。',category:'projects'};
      for(const actor of [0,a,b,c]){
        assert.equal((await call(actor,`/api/forum/topics/${topic}`,data,'PATCH')).status,405);
        assert.equal((await call(actor,`/api/forum/replies/${reply}`,{body:'不允许覆盖评论'},'PATCH')).status,405);
        assert.equal((await call(actor,`/forum/topics/${topic}/edit/`)).status,404);
      }
      const result=(await call(a,`/api/forum/topics/${topic}`)).json;
      assert.equal(result.topic.title,`测试讨论 ${salt}`);assert.equal(result.topic.category,'questions');
      assert.equal(result.topic.version,undefined,'帖子没有版本号了');
      assert.equal(result.replies[0].content,'这是一条明确的回复。');
      // 对外形状 = 物理列名：模板读 content / poster_id / parent_reply，不是 body / author_id / parent_id。
      const shape=result.replies[0];
      assert.ok('content' in shape&&'poster_id' in shape&&'parent_reply' in shape);
      assert.ok(!('body' in shape)&&!('author_id' in shape)&&!('parent_id' in shape),'旧名别名不许回来');
      const row=(await select('SELECT status FROM forum_posts WHERE id=?',[topic]))[0];
      assert.equal(row.status,'published','被拒绝的修改没有落库');
    });
    await t.test('举报去重、非管理拒绝、成立删除与管理员恢复',async()=>{
      const request={type:'reply',id:reply,reason:'其他',detail:'需要社区核实的具体测试问题'};
      const rep=await call(c,'/api/forum/reports',request);assert.equal(rep.status,200);reportId=rep.json.id;
      assert.equal((await call(c,'/api/forum/reports',request)).json.id,reportId);
      assert.equal((await call(a,'/api/forum/me?tab=reports')).json.total,0);
      await assert.rejects(()=>moderation(a,{kind:'reply',reportId,version:1,action:'claim',reason:'开始检查这条测试内容'}),e=>e.code==='forbidden');
      await execute("INSERT INTO forum_member_roles(member_id,type,created_at) VALUES (?,'admin',?)",[a,new Date()]);
      assert.equal((await moderation(a,{kind:'reply',reportId,version:1,action:'claim',reason:'开始检查这条测试内容'})).status,'reviewing');
      assert.equal((await call(c,`/api/forum/reports/reply/${reportId}/withdraw`,{})).status,409);
      await moderation(a,{kind:'reply',reportId,version:2,action:'uphold',reason:'已核实测试内容，删除该回复'});
      const detail=(await call(0,`/api/forum/topics/${topic}`)).json;
      assert.equal(detail.replies[0].content,'');assert.equal(detail.replies[0].status,'deleted_by_report');
      assert.equal(detail.topic.reply_count,0);
      const reports=(await call(c,'/api/forum/me?tab=reports')).json;assert.equal(reports.items[0].status,'upheld');assert.match(reports.items[0].resolution,/已核实/);
      assert.ok((await call(c,'/api/forum/notifications')).json.items.some(n=>n.category==='report_result'));
      await moderation(a,{kind:'reply',reportId,version:3,action:'restore',reason:'测试完成，恢复公开回复'});
      assert.equal((await call(0,`/api/forum/topics/${topic}`)).json.topic.reply_count,1);
      const resultNotes=(await call(c,'/api/forum/notifications')).json.items.filter(n=>n.category==='report_result');
      assert.ok(resultNotes.some(n=>n.title==='已核实测试内容，删除该回复'));
      const authorNotes=(await call(b,'/api/forum/notifications')).json.items;
      assert.equal(authorNotes.find(n=>n.category==='content_deleted').title,'你的内容已被删除');
      assert.equal(authorNotes.find(n=>n.category==='content_restored').title,'你的内容已恢复');
    });
    await t.test('通知已读只影响本人；删帖后整帖不可达',async()=>{
      const notes=(await call(a,'/api/forum/notifications')).json.items;assert.ok(notes.length);
      await call(b,'/api/forum/notifications/read',{ids:notes.map(n=>n.id)});
      assert.ok((await call(a,'/api/forum/notifications')).json.unread>0);
      await call(a,'/api/forum/notifications/read',{ids:'all'});assert.equal((await call(a,'/api/forum/notifications')).json.unread,0);
      assert.equal((await call(a,`/api/forum/topics/${topic}/withdraw`,{})).status,200);
      // 删掉就是没了：详情 404、不能回复、列表里也搜不到
      assert.equal((await call(0,`/forum/topics/${topic}/`)).status,404);
      assert.equal((await call(0,`/api/forum/topics/${topic}`)).status,404);
      assert.equal((await call(b,`/api/forum/topics/${topic}/replies`,{body:'删除后不能继续回复'})).status,404);
      assert.ok(!(await call(0,'/api/forum/topics?q='+encodeURIComponent(`测试讨论 ${salt}`))).json.items.some(x=>x.id===topic));
      const row=(await select('SELECT status FROM forum_posts WHERE id=?',[topic]))[0];
      assert.equal(row.status,'deleted_by_author');
    });
    await t.test('作者可删自己的回复；重复删除幂等',async()=>{
      assert.equal((await call(a,`/api/forum/replies/${reply}/withdraw`,{})).status,403);
      assert.equal((await call(b,`/api/forum/replies/${reply}/withdraw`,{})).status,200);
      assert.equal((await call(b,`/api/forum/replies/${reply}/withdraw`,{})).status,200);
      const row=(await select('SELECT status FROM forum_post_replies WHERE id=?',[reply]))[0];
      assert.equal(row.status,'deleted_by_author');
    });
    await t.test('滚动续载、跨批次回复层级、直达定位与删除过滤',async()=>{
      const created=await call(a,'/api/forum/topics',{title:'分页测试主题 '+salt,body:'用于验证分页下的稳定回复定位。',category:'projects'});assert.equal(created.status,200);const id=created.json.id;
      let last,first;
      for(let i=1;i<=31;i++){const now=new Date();const r=await execute('INSERT INTO forum_post_replies(post_id,poster_id,parent_reply,content,sequence,created_at) VALUES (?,?,?,?,?,?)',[id,b,i===31?first:null,'分页回复 '+i,i,now]);last=r.insertId;if(i===1)first=last;}
      await execute('UPDATE forum_posts SET reply_count=31,next_sequence=32 WHERE id=?',[id]);
      assert.equal((await call(0,`/api/forum/topics/${id}?page=2`)).json.replies.length,1);
      assert.equal((await call(0,`/forum/replies/${last}/`)).headers.location,`/forum/topics/${id}/?reply=${last}#reply-${last}`);
      const initial=await call(0,`/forum/topics/${id}/`);
      assert.equal((initial.text.match(/data-reply-id=/g)||[]).length,30);
      const fragment=await call(0,`/forum/topics/${id}/?page=2&fragment=1`);
      assert.equal(fragment.status,200);assert.equal((fragment.text.match(/data-reply-id=/g)||[]).length,1);
      assert.ok(fragment.text.includes(`data-parent-id="${first}"`));assert.ok(fragment.text.includes('f-parent-excerpt'));
      await execute("UPDATE forum_post_replies SET status='deleted_by_report' WHERE id=?",[first]);
      const redacted=(await call(0,`/api/forum/topics/${id}?page=2`)).json.replies[0];
      assert.equal(redacted.parent_excerpt,'');assert.equal(redacted.parent_status,'deleted_by_report');
      await execute("UPDATE forum_post_replies SET status='deleted_by_report' WHERE id=?",[last]);
      assert.equal((await call(0,`/api/forum/topics/${id}?page=2`)).json.replies[0].content,'');
      const author=await call(0,`/forum/user/${a}/`);assert.equal(author.status,200);assert.ok(!author.text.includes('forum-'+salt));
    });
    await t.test('本人直接回复优先，定向回复不置顶，直达只读目标批次',async()=>{
      const now=new Date(),r=await execute('INSERT INTO forum_posts(poster_id,category,title,content,last_activity_at,created_at) VALUES (?,?,?,?,?,?)',[a,'questions','评论优先测试 '+salt,'验证自己的新评论无需加载历史所有楼层。',now,now]),id=r.insertId;
      let priorOwn,parent;
      for(let i=1;i<=72;i++){const r2=await execute('INSERT INTO forum_post_replies(post_id,poster_id,content,sequence,created_at) VALUES (?,?,?,?,?)',[id,i===71?a:b,'评论顺序测试 '+i,i,now]);if(i===71)priorOwn=r2.insertId;if(i===72)parent=r2.insertId;}
      await execute('UPDATE forum_posts SET reply_count=72,next_sequence=73 WHERE id=?',[id]);
      const created=await call(a,`/api/forum/topics/${id}/replies`,{body:'本人新发布的定向评论。',parentId:parent});assert.equal(created.status,200);const fresh=created.json.id;
      assert.equal(created.json.href,`/forum/topics/${id}/#reply-${fresh}`);
      const own=(await call(a,`/api/forum/topics/${id}`)).json.replies;
      assert.equal(own.length,30);assert.equal(own[0].id,priorOwn);assert.equal(own[0].own_priority,1);assert.equal(own[1].sequence,1);assert.ok(!own.some(x=>x.id===fresh));
      const target=(await call(c,`/api/forum/topics/${id}?reply=${fresh}`)).json;assert.equal(target.page,3);assert.equal(target.replies.length,13);assert.ok(target.replies.some(x=>x.id===fresh));assert.equal(target.replies.at(-1).parent_reply,parent);
      const fragment=await call(a,`/forum/topics/${id}/?reply=${fresh}&fragment=1`);assert.ok(fragment.text.indexOf(`data-reply-id="${parent}"`)<fragment.text.indexOf(`data-reply-id="${fresh}"`));assert.ok(fragment.text.includes('f-reply-children'));
      const direct=await call(a,`/api/forum/topics/${id}/replies`,{body:'直接回复主帖，在本人视角优先。'});assert.equal(direct.status,200);
      const promoted=(await call(a,`/api/forum/topics/${id}`)).json.replies;assert.equal(promoted[0].id,direct.json.id);assert.equal(promoted[0].parent_reply,null);
      await call(a,`/api/forum/replies/${direct.json.id}/withdraw`,{});assert.equal((await call(a,`/api/forum/topics/${id}`)).json.replies[0].id,priorOwn);
    });
    await t.test('列表续载保留搜索条件且私有片段不能匿名读取',async()=>{
      const tag='滚动列表'+salt,now=new Date();
      for(let i=0;i<21;i++)await execute('INSERT INTO forum_posts(poster_id,category,title,content,last_activity_at,created_at) VALUES (?,?,?,?,?,?)',[b,'projects',tag+' '+i,'滚动列表测试正文内容。',now,now]);
      const path='/forum/?q='+encodeURIComponent(tag)+'&category=projects&sort=new';
      const first=await call(0,path),second=await call(0,path+'&page=2&fragment=1');
      assert.equal((first.text.match(/class="f-topic-row"/g)||[]).length,20);
      assert.equal((second.text.match(/class="f-topic-row"/g)||[]).length,1);
      assert.equal((await call(0,'/forum/me/?tab=topics&page=2&fragment=1')).status,404);
      assert.equal((await call(0,'/forum/?feed=following&page=2&fragment=1')).status,303);
    });
    await t.test('举报撤回和驳回有终态；禁言不妨碍阅读和已读',async()=>{
      const id=(await call(a,'/api/forum/topics',{title:'举报终态测试 '+salt,body:'用于验证举报撤回与驳回的独立内容。',category:'questions'})).json.id;
      const r=(await call(b,'/api/forum/reports',{type:'post',id,reason:'其他',detail:'测试举报撤回过程'})).json.id;
      assert.equal((await call(b,`/api/forum/reports/post/${r}/withdraw`,{})).status,200);
      // 不带 kind 的旧写法已经不认了：两张举报表编号会撞，靠遍历猜是错的做法。
      assert.equal((await call(b,`/api/forum/reports/${r}/withdraw`,{})).status,404);
      const r2=(await call(c,'/api/forum/reports',{type:'post',id,reason:'其他',detail:'测试举报驳回过程'})).json.id;
      assert.equal((await moderation(a,{kind:'post',reportId:r2,version:1,action:'dismiss',reason:'核对后未发现需要处理的问题'})).status,'dismissed');
      await execute('INSERT INTO forum_member_roles(member_id,type,expired_at,created_at) VALUES (?,\'ban\',?,?)',[c,new Date(Date.now()+3600000),new Date()]);
      assert.equal((await call(c,`/api/forum/topics/${id}/vote`,{value:1})).status,403);
      assert.equal((await call(c,`/forum/topics/${id}/`)).status,200);
      assert.equal((await call(c,'/api/forum/notifications/read',{ids:'all'})).status,200);
      // 过期处罚自动失效：改的是同一行的时间，不删行（库里留痕）。
      await execute('UPDATE forum_member_roles SET expired_at=? WHERE member_id=?',[new Date(Date.now()-60000),c]);
      assert.equal((await call(c,`/api/forum/topics/${id}/vote`,{value:1})).status,200);
      // 禁言（mute）只拦公开发言：投票、发帖不行，收藏照旧。
      await execute('UPDATE forum_member_roles SET type=\'mute\',expired_at=? WHERE member_id=?',[new Date(Date.now()+3600000),c]);
      assert.equal((await call(c,`/api/forum/topics/${id}/vote`,{value:1})).json.error,'posting_muted');
      assert.equal((await call(c,'/api/forum/topics',{title:'禁言期间不该能发帖 '+salt,body:'这是一条不该存在的帖子正文。',category:'questions'})).json.error,'posting_muted');
      assert.equal((await call(c,`/api/forum/topics/${id}/bookmark`,{enabled:true})).status,200);
      await execute('DELETE FROM forum_member_roles WHERE member_id=?',[c]);
    });
  }finally{
    // 只清本轮新建的测试账号及其从属记录，不碰库里既有数据。
    if(users.length){
      const marks=users.map(()=>'?').join(',');
      const own=await select(`SELECT id FROM forum_posts WHERE poster_id IN (${marks})`,users),postIds=own.map(p=>p.id);
      if(postIds.length){
        const ts=postIds.map(()=>'?').join(','),rs=await select(`SELECT id FROM forum_post_replies WHERE post_id IN (${ts})`,postIds),rids=rs.map(r=>r.id);
        if(rids.length)await execute(`DELETE FROM forum_reply_votes WHERE reply_id IN (${rids.map(()=>'?').join(',')})`,rids);
        await execute(`DELETE FROM forum_post_votes WHERE post_id IN (${ts})`,postIds);
        await execute(`DELETE FROM forum_post_bookmarks WHERE post_id IN (${ts})`,postIds);
        await execute(`DELETE FROM forum_post_reports WHERE post_id IN (${ts})`,postIds);
        await execute(`DELETE FROM forum_reply_reports WHERE post_id IN (${ts})`,postIds);
        await execute(`UPDATE forum_post_replies SET parent_reply=NULL WHERE post_id IN (${ts})`,postIds);
        await execute(`DELETE FROM forum_post_replies WHERE post_id IN (${ts})`,postIds);
        await execute(`DELETE FROM forum_posts WHERE id IN (${ts})`,postIds);
      }
      await execute(`DELETE FROM forum_notifications WHERE receiver IN (${marks}) OR sender IN (${marks})`,[...users,...users]);
      await execute(`DELETE FROM forum_follows WHERE follower_id IN (${marks}) OR followed_id IN (${marks})`,[...users,...users]);
      await execute(`DELETE FROM forum_member_roles WHERE member_id IN (${marks})`,users);
      await execute(`DELETE FROM users WHERE id IN (${marks})`,users);
    }
    await closePool();
  }
});
