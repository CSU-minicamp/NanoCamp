import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handleRequest} from '../backend/app.mjs';
import {execute,select,closePool,dbReady} from '../backend/db.mjs';
import {hashPassword} from '../backend/auth.mjs';
import {moderate,reviewReports} from '../backend/forum/dm.mjs';
import {loadConfig} from '../backend/config.mjs';
test('私信直接收发与隐私隔离',{skip:!dbReady()},async t=>{
 const users=[],jars=new Map(),tag=randomUUID().slice(0,8),password='Dm-test-password-2026';let a,b,c,conversation,message,report;
 async function call(actor,path,data,key=randomUUID()){
  const jar=jars.get(actor)||new Map();const response=await handleRequest({method:data?'POST':'GET',url:path,headers:{host:'localhost:4187',origin:'http://localhost:4187',cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'x-nc-csrf':jar.get('nc_csrf')||'','idempotency-key':key},body:data?JSON.stringify(data):null,ip:'127.0.0.1'});
  for(const cookie of [response.headers['set-cookie']||[]].flat()){const [k,...v]=cookie.split(';')[0].split('=');v.join('=')?jar.set(k,v.join('=')):jar.delete(k);}jars.set(actor,jar);
  return {...response,text:response.body.toString(),json:response.headers['content-type']?.includes('json')?JSON.parse(response.body):null};
 }
 try{
  const hash=await hashPassword(password),now=new Date();
  for(const name of ['甲','乙','丙']){const email=`dm-${tag}-${name.codePointAt(0)}@example.test`;const r=await execute('INSERT INTO users(email,password_hash,nickname,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?)',[email,hash,'私信'+name+tag,now,now,now]);users.push(r.insertId);await call(r.insertId,'/api/session');assert.equal((await call(r.insertId,'/api/auth/login',{email,password})).status,200);}
  [a,b,c]=users;
  await t.test('登录回跳与导航迁移',async()=>{
   assert.equal((await call(0,'/forum/messages/')).status,303);
   const page=await call(a,'/forum/messages/');assert.equal(page.status,200);assert.match(page.text,/data-dm-center/);assert.match(page.text,/messages\.js/);assert.match(page.text,/noindex/);assert.equal(page.headers['cache-control'],'no-store');
   const center=await call(a,'/profile/');assert.match(center.text,/\/profile\/\?tab=profile/);
   assert.equal((await call(a,'/forum/messages/new/?to='+a)).status,403);
  });
  await t.test('用户搜索与直接收发，幂等及访问隔离',async()=>{
   assert.equal((await call(0,'/api/forum/dm/recipients?q='+tag)).status,401);
   const people=await call(a,'/api/forum/dm/recipients?q='+tag);assert.equal(people.json.items.length,2);assert.ok(!JSON.stringify(people.json).includes('example.test'));
   const key=randomUUID(),body={to_user_id:b,body:'你好，讨论一下合作。',client_message_id:key};
   const first=await call(a,'/api/forum/dm/conversations',body,key);assert.equal(first.status,200);conversation=first.json.conversation_id;message=first.json.id;
   assert.equal((await call(a,'/api/forum/dm/conversations',body,key)).json.id,message);
   assert.equal((await call(a,'/api/forum/dm/conversations',{...body,body:'换内容'},key)).status,409);
   assert.equal((await call(c,`/api/forum/dm/conversations/${conversation}/messages`)).status,404);
   assert.equal((await call(c,`/api/forum/dm/conversations/${conversation}/read`,{last_visible_seq:1})).status,404);
   assert.equal((await call(b,'/api/forum/dm/conversations')).json.items[0].id,conversation);
   assert.equal((await call(b,'/api/forum/message-summary')).json.dm_unread,1);assert.equal((await call(a,'/api/forum/message-summary')).json.total_unread,0);
   assert.equal((await call(b,`/forum/messages/conversations/${conversation}/`)).status,200);
   assert.equal((await call(b,'/api/forum/message-summary')).json.dm_unread,1,'GET must not mark read');
  });
  await t.test('消息请求机制与旧接口删除，可连续发送且无需互关',async()=>{
   for(const action of ['accept','ignore'])assert.equal((await call(b,`/api/forum/dm/conversations/${conversation}/${action}`,{})).status,404);
   assert.equal((await call(a,`/api/forum/dm/conversations/${conversation}/messages`)).json.conversation.state,undefined);
   assert.equal((await call(a,`/api/forum/dm/conversations/${conversation}/messages`)).json.conversation.request_state,undefined);
   assert.equal((await call(a,'/api/forum/message-summary')).json.request_unread,undefined);
   assert.equal((await call(b,'/forum/messages/new/?to='+a)).headers.location,`/forum/messages/conversations/${conversation}/`);
   assert.equal((await call(a,`/api/forum/dm/conversations/${conversation}/messages`,{body:'无需等待回应，可继续发送'})).status,200);
   assert.equal((await call(b,'/api/forum/message-summary')).json.dm_unread,2);
   const page=(await call(b,'/forum/messages/')).text;assert.ok(!page.includes('私信分类'));assert.ok(!page.includes('消息请求'));assert.ok(!page.includes('class="dm-top"><h1>消息</h1><a'));
  });
  await t.test('双方收发、增量拉取、已读单调与隐藏恢复',async()=>{
   const sent=await call(b,`/api/forum/dm/conversations/${conversation}/messages`,{body:'<script>alert(1)</script>\n可以一起讨论。'});assert.equal(sent.status,200);
   assert.equal((await call(a,'/api/forum/message-summary')).json.dm_unread,1);
   assert.equal((await call(a,`/api/forum/dm/conversations/${conversation}/messages?after_seq=2`)).json.items.length,1);
   await call(a,`/api/forum/dm/conversations/${conversation}/read`,{last_visible_seq:3});await call(a,`/api/forum/dm/conversations/${conversation}/read`,{last_visible_seq:1});
   assert.equal((await call(a,'/api/forum/message-summary')).json.dm_unread,0);
   assert.equal((await call(a,`/api/forum/dm/conversations/${conversation}/read`,{last_visible_seq:99})).status,422);
   const page=await call(a,`/forum/messages/conversations/${conversation}/`);assert.ok(!page.text.includes('<script>alert(1)</script>'));assert.match(page.text,/&lt;script&gt;/);
   await call(a,`/api/forum/dm/conversations/${conversation}/hide`,{});assert.equal((await call(a,'/api/forum/dm/conversations')).json.items.length,0);
   await call(b,`/api/forum/dm/conversations/${conversation}/messages`,{body:'一条新的消息'});assert.equal((await call(a,'/api/forum/dm/conversations')).json.items.length,1);
   assert.equal((await select('SELECT COUNT(*) AS n FROM forum_notifications WHERE receiver IN (?,?) AND target_type=?',[a,b,'dm_message']))[0].n,0);
  });
  await t.test('双向屏蔽及解除隔离，禁言用户仍可防骚扰',async()=>{
   await call(a,`/api/forum/dm/conversations/${conversation}/block`,{});
   assert.equal((await call(b,`/api/forum/dm/conversations/${conversation}/messages`,{body:'被拦截'})).json.error,'cannot_message');
   await call(b,`/api/forum/dm/conversations/${conversation}/block`,{});await call(a,`/api/forum/dm/conversations/${conversation}/unblock`,{});
   assert.equal((await call(a,`/api/forum/dm/conversations/${conversation}/messages`,{body:'仍被拦截'})).status,409);
   await call(b,`/api/forum/dm/conversations/${conversation}/unblock`,{});
   await execute('INSERT INTO forum_member_roles(member_id,type,expired_at,created_at) VALUES (?,\'ban\',?,?)',[b,new Date(Date.now()+3600000),new Date()]);
   assert.equal((await call(b,`/api/forum/dm/conversations/${conversation}/messages`,{body:'禁言期间'})).status,403);
   // 禁言（mute）不影响私信：这一档只拦公开发言。
   // 发完把这条的时间往前挪 2 分钟，别占掉后面「20 条/分钟」测试的额度。
   await execute('UPDATE forum_member_roles SET type=\'mute\' WHERE member_id=?',[b]);
   const muted=await call(b,`/api/forum/dm/conversations/${conversation}/messages`,{body:'禁言期间仍可私信'});
   assert.equal(muted.status,200);
   await execute('UPDATE forum_dm_messages SET sent_at=? WHERE id=?',[new Date(Date.now()-120000),muted.json.id]);
   assert.equal((await call(b,`/api/forum/dm/conversations/${conversation}/block`,{})).status,200);
   await execute('DELETE FROM forum_member_roles WHERE member_id=?',[b]);await call(b,`/api/forum/dm/conversations/${conversation}/unblock`,{});
  });
  await t.test('私信举报、领取、有限证据、处理、系统反馈及恢复',async()=>{
   const reported=await call(b,'/api/forum/dm/reports',{message_id:message,reason:'人身攻击或骚扰',details:'测试举报'});assert.equal(reported.status,200);report=reported.json.id;
   assert.equal((await call(b,'/api/forum/dm/reports',{message_id:message,reason:'人身攻击或骚扰'})).json.id,report);
   assert.equal((await call(a,'/api/forum/dm/reports',{message_id:message,reason:'其他'})).status,403);
   assert.equal((await call(c,'/api/forum/dm/reports',{message_id:message,reason:'其他'})).status,404);
   await execute("INSERT INTO forum_member_roles(member_id,type,created_at) VALUES (?,'admin',?)",[c,new Date()]);
   await assert.rejects(reviewReports(a,report),e=>e.status===403);await assert.rejects(reviewReports(c,report),e=>e.status===403);
   await moderate(c,{reportId:report,version:1,action:'claim',reason:'领取测试举报'});const evidence=await reviewReports(c,report);assert.ok(evidence.evidence.length<=11);
   assert.equal((await call(b,`/api/forum/dm/reports/${report}/withdraw`,{})).status,409);
   await moderate(c,{reportId:report,version:2,action:'uphold',reason:'测试核实，删除消息'});
   assert.equal((await call(a,`/api/forum/dm/conversations/${conversation}/messages`)).json.items[0].body,'消息已删除');
   const notes=(await call(b,'/api/forum/notifications?filter=system')).json;assert.ok(notes.items.some(n=>n.kind==='dm_report_result'));
   assert.equal((await call(b,'/profile/?tab=reports&kind=dm')).status,200);
   await moderate(c,{reportId:report,version:3,action:'restore',reason:'复核通过，恢复消息'});
   assert.equal((await call(a,`/api/forum/dm/conversations/${conversation}/messages`)).json.items[0].body,'你好，讨论一下合作。');
   assert.equal((await call(a,'/api/forum/notifications?filter=system')).json.items.find(n=>n.kind==='dm_content_deleted').title,'测试核实，删除消息');
   for(let i=0;i<20;i++)await execute("INSERT INTO forum_dm_reports(reporter_id,conversation_id,message_id,reason,detail,status,created_at,updated_at) VALUES (?,?,?,?,?,'dismissed',?,?)",[b,conversation,message,'其他','历史举报 '+i,new Date(),new Date()]);
   assert.equal((await call(b,'/api/forum/dm/reports?report='+report)).json.page,2);
   assert.equal((await call(c,'/api/forum/dm/reports?report='+report)).status,404);
   assert.ok((await call(b,'/profile/?tab=reports&kind=dm&report='+report)).text.includes('id="dm-report-'+report+'"'));
  });
  await t.test('会话并发创建只保留一份，拒绝超长空白与跨会话幂等误用',async()=>{
   const result=await Promise.all([call(a,'/api/forum/dm/conversations',{to_user_id:c,body:'甲发起'}),call(c,'/api/forum/dm/conversations',{to_user_id:a,body:'丙回应'})]);assert.ok(result.every(r=>r.status===200),JSON.stringify(result.map(r=>({status:r.status,json:r.json}))));assert.equal(result[0].json.conversation_id,result[1].json.conversation_id);
   assert.equal((await call(a,`/api/forum/dm/conversations/${conversation}/messages`,{body:' '.repeat(10)})).status,422);
   assert.equal((await call(a,`/api/forum/dm/conversations/${conversation}/messages`,{body:'字'.repeat(2001)})).status,422);
   assert.equal((await call(a,`/api/forum/dm/conversations/${conversation}/messages?before_seq=2&after_seq=1`)).status,422);
   assert.equal((await call(a,'/api/forum/dm/conversations?cursor=bad')).status,422);
  });
  await t.test('历史只加载30条、游标无重复，通知全部已读不影响私信',async()=>{
   const [{last_seq}]=await select('SELECT last_seq FROM forum_dm_conversations WHERE id=?',[conversation]);
   for(let i=1;i<=40;i++)await execute('INSERT INTO forum_dm_messages(conversation_id,sequence,sender_id,client_message_id,body,sent_at) VALUES (?,?,?,?,?,?)',[conversation,last_seq+i,b,randomUUID(),'历史私信 '+i,new Date(Date.now()-120000)]);
   await execute('UPDATE forum_dm_conversations SET last_seq=? WHERE id=?',[last_seq+40,conversation]);
   const latest=(await call(a,`/api/forum/dm/conversations/${conversation}/messages`)).json;assert.equal(latest.items.length,30);assert.equal(latest.has_more,true);
   const older=(await call(a,`/api/forum/dm/conversations/${conversation}/messages?before_seq=${latest.items[0].seq}`)).json;assert.ok(older.items.at(-1).seq<latest.items[0].seq);
   await call(a,'/api/forum/notifications/read',{ids:'all',filter:'system'});assert.ok((await call(a,'/api/forum/message-summary')).json.dm_unread>=40);
  });
  await t.test('用户选择不建空记录、普通发送频率限制与只读开关',async()=>{
   const before=(await select('SELECT COUNT(*) AS n FROM forum_dm_conversations'))[0].n;
   assert.equal((await call(b,'/forum/messages/new/?to='+c)).status,200);assert.equal((await select('SELECT COUNT(*) AS n FROM forum_dm_conversations'))[0].n,before);
   const direct=await call(b,'/api/forum/dm/conversations',{to_user_id:c,body:'互关直聊'});assert.equal(direct.status,200);
   assert.equal((await call(b,`/api/forum/dm/conversations/${direct.json.conversation_id}/messages`)).json.conversation.state,undefined);
   assert.equal((await call(b,`/api/forum/dm/conversations/${direct.json.conversation_id}/messages`,{body:'无需等待接受'})).status,200);
   const raw=loadConfig(),old=raw.messages;raw.messages={enabled:false};
   try{
    assert.equal((await call(b,`/api/forum/dm/conversations/${conversation}/messages`,{body:'开关关闭'})).json.error,'messaging_disabled');
    const read=await call(b,`/api/forum/dm/conversations/${conversation}/messages`);assert.equal(read.status,200);assert.equal(read.json.conversation.can_send,false);
    assert.ok(!(await call(b,'/forum/messages/')).text.includes('href="/forum/messages/new/"'));
   }finally{raw.messages=old;}
   for(let i=0;i<6;i++){
    const now=new Date(),r=await execute('INSERT INTO users(email,password_hash,nickname,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?)',[`dm-${tag}-limit-${i}@example.test`,hash,'限流用户'+i,now,now,now]);users.push(r.insertId);
    const response=await call(b,'/api/forum/dm/conversations',{to_user_id:r.insertId,body:'请求测试'});assert.equal(response.status,200);
   }
   for(let i=0;i<11;i++){const response=await call(b,`/api/forum/dm/conversations/${conversation}/messages`,{body:'普通频率测试'});assert.equal(response.status,i<10?200:429);if(i===10){assert.equal(response.json.retry_after,60);assert.equal(response.headers['retry-after'],'60');}}
  });
 }finally{
  if(users.length){const marks=users.map(()=>'?').join(',');await execute(`DELETE FROM forum_dm_reports WHERE reporter_id IN (${marks}) OR conversation_id IN (SELECT id FROM forum_dm_conversations WHERE user_low IN (${marks}) OR user_high IN (${marks}))`,[...users,...users,...users]);await execute(`DELETE FROM users WHERE id IN (${marks})`,users);}await closePool();
 }
});
