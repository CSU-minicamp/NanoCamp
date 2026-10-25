import {createHash} from 'node:crypto';
import {select,transaction} from './db.mjs';
import {checkMember,fail,idOf,reportReasons,ForumError} from './forum.mjs';
import {missingFields} from './auth.mjs';
import {loadConfig} from './config.mjs';
const rows=async(c,sql,args=[])=>{const [r]=await c.execute(sql,args);return r;};
const keyOf=key=>{if(!/^[\w-]{8,80}$/.test(String(key||'')))fail('idempotency_required');return key;};
const bodyOf=body=>{if(typeof body!=='string'||!body.trim()||Array.from(body.trim()).length>2000)fail('invalid_content');return body.trim();};
const auth=user=>{if(!user)fail('unauthenticated',401);};
const enabled=()=>loadConfig().messages?.enabled!==false;
const rate=(code,seconds)=>{const error=new ForumError(code,429);error.retryAfter=seconds;throw error;};
const pair=(a,b)=>[Math.min(a,b),Math.max(a,b)];
async function change(user,key,action,payload,work,passive=false){
 auth(user);keyOf(key);const digest=createHash('sha256').update(JSON.stringify({action,payload})).digest('hex');
 return transaction(async c=>{
  await checkMember(c,user,passive);
  const [prior]=await rows(c,'SELECT digest,result FROM forum_write_requests WHERE user_id=? AND request_key=?',[user.id,key]);
  if(prior){if(prior.digest!==digest)fail('request_conflict',409);return JSON.parse(prior.result);}
  const result=await work(c);
  await rows(c,'INSERT INTO forum_write_requests(user_id,request_key,digest,action,result,created_at) VALUES (?,?,?,?,?,?)',[user.id,key,digest,action,JSON.stringify(result),new Date()]);
  return result;
 });
}
async function member(c,id,user,lock=false){
 const [conversation]=await rows(c,`SELECT d.*,m.last_read_seq,m.hidden_through_seq FROM forum_dm_conversations d JOIN forum_dm_members m ON m.conversation_id=d.id AND m.user_id=? WHERE d.id=? ${lock?'FOR UPDATE':''}`,[user.id,idOf(id)]);
 if(!conversation)fail('not_found',404);return conversation;
}
const peerId=(d,user)=>Number(d.user_low)===Number(user.id)?Number(d.user_high):Number(d.user_low);
async function flags(c,d,user){
 const peer=peerId(d,user),blocks=await rows(c,'SELECT blocker_id FROM forum_user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)',[user.id,peer,peer,user.id]);
 const states=await rows(c,'SELECT user_id,banned_at,suspended_until FROM forum_members WHERE user_id IN (?,?)',[user.id,peer]);
 const restricted=states.some(s=>s.banned_at||s.suspended_until&&new Date(s.suspended_until)>new Date());
 return {blocked:blocks.length>0,blocked_by_me:blocks.some(b=>Number(b.blocker_id)===Number(user.id)),can_send:enabled()&&!restricted&&!missingFields(user).length&&!blocks.length,restricted};
}
export async function recipient(user,id){
 auth(user);id=idOf(id);if(id===Number(user.id))fail('self_message',403);
 const [peer]=await select("SELECT id,nickname,bio FROM users WHERE id=? AND nickname<>''",[id]);if(!peer)fail('not_found',404);
 const [d]=await select('SELECT id FROM forum_dm_conversations WHERE user_low=? AND user_high=?',pair(user.id,id));
 return {peer,conversation_id:d?.id||null,enabled:enabled()};
}
export async function recipients(user,q){
 auth(user);q=String(q||'').trim().slice(0,60);if(!q)return {items:[]};
 const like='%'+q.replace(/[!%_]/g,c=>'!'+c)+'%';
 return {items:await select("SELECT u.id,u.nickname FROM users u LEFT JOIN forum_members m ON m.user_id=u.id WHERE u.id<>? AND u.nickname LIKE ? ESCAPE '!' AND m.banned_at IS NULL ORDER BY u.nickname,u.id LIMIT 10",[user.id,like])};
}
export async function conversations(user,{cursor}={}){
 auth(user);const args=[user.id,user.id,user.id,user.id,user.id];
 let boundary='';
 if(cursor){let parsed;try{parsed=JSON.parse(Buffer.from(String(cursor),'base64url').toString());}catch{fail('invalid_state');}if(!Array.isArray(parsed)||!Number.isFinite(Date.parse(parsed[0])))fail('invalid_state');boundary=' AND (d.last_message_at<? OR (d.last_message_at=? AND d.id<?))';args.push(new Date(parsed[0]),new Date(parsed[0]),idOf(parsed[1]));}
 const items=await select(`SELECT d.id,d.last_seq,d.last_message_at,m.last_read_seq,u.id AS peer_id,u.nickname,
 CASE WHEN last.status='published' THEN LEFT(last.body,100) ELSE '消息已隐藏' END AS preview,
 (SELECT COUNT(*) FROM forum_dm_messages x WHERE x.conversation_id=d.id AND x.sender_id<>? AND x.seq>m.last_read_seq) AS unread,
 EXISTS(SELECT 1 FROM forum_user_blocks b WHERE (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)) AS blocked
 FROM forum_dm_conversations d JOIN forum_dm_members m ON m.conversation_id=d.id AND m.user_id=?
 JOIN users u ON u.id=IF(d.user_low=?,d.user_high,d.user_low)
 JOIN forum_dm_messages last ON last.conversation_id=d.id AND last.seq=d.last_seq
 WHERE (m.hidden_through_seq IS NULL OR d.last_seq>m.hidden_through_seq) ${boundary}
 ORDER BY d.last_message_at DESC,d.id DESC LIMIT 21`,args);
 const more=items.length>20;items.splice(20);const last=items.at(-1);
 return {items,next_cursor:more?Buffer.from(JSON.stringify([last.last_message_at,last.id])).toString('base64url'):null,enabled:enabled()};
}
export async function messages(user,id,{before_seq,after_seq}={}){
 auth(user);if(before_seq&&after_seq)fail('invalid_state');
 return transaction(async c=>{
  const d=await member(c,id,user),[peer]=await rows(c,'SELECT id,nickname,bio FROM users WHERE id=?',[peerId(d,user)]);
  const cursor=before_seq||after_seq,limit=cursor?idOf(cursor):0;
  let items=await rows(c,`SELECT id,seq,sender_id,client_message_id,CASE WHEN status='published' THEN body ELSE '消息已隐藏' END AS body,status,created_at FROM forum_dm_messages WHERE conversation_id=? ${cursor?`AND seq${before_seq?'<':'>'}?`:''} ORDER BY seq ${after_seq?'ASC':'DESC'} LIMIT 31`,cursor?[d.id,limit]:[d.id]);
  const more=items.length>30;items.splice(30);if(!after_seq)items.reverse();
  const state={...d,...await flags(c,d,user)};
  return {conversation:state,peer,items,has_more:more,next_cursor:items.length?(after_seq?items.at(-1).seq:items[0].seq):null,enabled:enabled()};
 });
}
export async function send(user,key,id,data){
 const body=bodyOf(data.body),client=keyOf(data.client_message_id||key);const target=id?idOf(id):idOf(data.to_user_id);
 return change(user,key,'dm.send',{id:id||null,target,body,client},async c=>{
  if(!enabled())fail('messaging_disabled',409);
  const [prior]=await rows(c,'SELECT * FROM forum_dm_messages WHERE sender_id=? AND client_message_id=?',[user.id,client]);
  if(prior){if(prior.body!==body||id&&Number(prior.conversation_id)!==target)fail('request_conflict',409);const d=await member(c,prior.conversation_id,user);if(!id&&peerId(d,user)!==target)fail('request_conflict',409);return {id:prior.id,seq:prior.seq,conversation_id:prior.conversation_id,client_message_id:client,sender_id:prior.sender_id,body:prior.status==='published'?body:'消息已隐藏',status:prior.status,created_at:prior.created_at};}
  const [{n}]=await rows(c,"SELECT COUNT(*) AS n FROM forum_dm_messages WHERE sender_id=? AND created_at>?",[user.id,new Date(Date.now()-60000)]);if(n>=20)rate('rate_limited',60);
  let d;
  if(id)d=await member(c,id,user,true);
  else{
   if(target===Number(user.id))fail('self_message',403);
   const [peer]=await rows(c,"SELECT id FROM users WHERE id=? AND nickname<>''",[target]);if(!peer)fail('not_found',404);
   const [existing]=await rows(c,'SELECT id FROM forum_dm_conversations WHERE user_low=? AND user_high=?',pair(user.id,target));
   if(existing)d=await member(c,existing.id,user,true);
   else{
    await rows(c,"INSERT INTO forum_dm_conversations(user_low,user_high,last_message_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",[...pair(user.id,target),new Date()]);
    const [created]=await rows(c,'SELECT id FROM forum_dm_conversations WHERE user_low=? AND user_high=? FOR UPDATE',pair(user.id,target));
    await rows(c,'INSERT IGNORE INTO forum_dm_members(conversation_id,user_id) VALUES (?,?),(?,?)',[created.id,user.id,created.id,target]);d=await member(c,created.id,user,true);
   }
  }
  const f=await flags(c,d,user);if(f.blocked||f.restricted)fail('cannot_message',409);
  const seq=Number(d.last_seq)+1,now=new Date();const r=await rows(c,'INSERT INTO forum_dm_messages(conversation_id,seq,sender_id,client_message_id,body,created_at) VALUES (?,?,?,?,?,?)',[d.id,seq,user.id,client,body,now]);
  await rows(c,'UPDATE forum_dm_conversations SET last_seq=?,last_message_at=? WHERE id=?',[seq,now,d.id]);
  await rows(c,'UPDATE forum_dm_members SET hidden_through_seq=NULL WHERE conversation_id=? AND user_id=?',[d.id,user.id]);
  return {id:r.insertId,conversation_id:d.id,seq,sender_id:user.id,client_message_id:client,body,status:'published',created_at:now};
 });
}
export async function act(user,key,id,action,data={}){
 if(!['read','hide','block','unblock'].includes(action))fail('not_found',404);
 return change(user,key,'dm.'+action,{...data,id:idOf(id)},async c=>{
  const d=await member(c,id,user,true);
  if(action==='read'){
   const seq=idOf(data.last_visible_seq);if(seq>d.last_seq)fail('invalid_state');
   await rows(c,'UPDATE forum_dm_members SET last_read_seq=GREATEST(last_read_seq,?) WHERE conversation_id=? AND user_id=?',[seq,d.id,user.id]);
  }else if(action==='hide')await rows(c,'UPDATE forum_dm_members SET hidden_through_seq=? WHERE conversation_id=? AND user_id=?',[d.last_seq,d.id,user.id]);
  else if(action==='block')await rows(c,'INSERT IGNORE INTO forum_user_blocks(blocker_id,blocked_id,created_at) VALUES (?,?,?)',[user.id,peerId(d,user),new Date()]);
  else await rows(c,'DELETE FROM forum_user_blocks WHERE blocker_id=? AND blocked_id=?',[user.id,peerId(d,user)]);
  return {ok:true};
 },true);
}
export async function summary(user){
 auth(user);
 const [dm]=await select(`SELECT COUNT(*) AS dm_unread FROM forum_dm_members m
 JOIN forum_dm_conversations d ON d.id=m.conversation_id JOIN forum_dm_messages x ON x.conversation_id=d.id
 WHERE m.user_id=? AND x.sender_id<>? AND x.seq>m.last_read_seq
 AND (m.hidden_through_seq IS NULL OR d.last_seq>m.hidden_through_seq)`,[user.id,user.id]);
 const [notices]=await select(`SELECT COALESCE(SUM(n.kind IN ('reply','follow','like')),0) AS activity_unread,COALESCE(SUM(n.kind NOT IN ('reply','follow','like')),0) AS system_unread FROM forum_notifications n WHERE n.user_id=? AND n.read_at IS NULL
 AND (n.kind<>'follow' OR EXISTS(SELECT 1 FROM forum_follows f WHERE f.follower_id=n.actor_id AND f.followed_id=n.user_id))
 AND (n.kind<>'like' OR (n.target_type='topic' AND EXISTS(SELECT 1 FROM forum_topic_votes v JOIN forum_topics t ON t.id=v.target_id WHERE v.target_id=n.target_id AND v.user_id=n.actor_id AND v.value=1 AND t.status='published')) OR (n.target_type='reply' AND EXISTS(SELECT 1 FROM forum_reply_votes v JOIN forum_replies r ON r.id=v.target_id JOIN forum_topics t ON t.id=r.topic_id WHERE v.target_id=n.target_id AND v.user_id=n.actor_id AND v.value=1 AND r.status='published' AND t.status='published')))`,[user.id]);
 const result=Object.fromEntries(Object.entries({...dm,...notices}).map(([k,v])=>[k,Number(v)]));return {...result,total_unread:Object.values(result).reduce((a,b)=>a+b,0)};
}
export async function report(user,key,data){
 const message=idOf(data.message_id),reason=String(data.reason||''),details=String(data.details||'').trim();if(!reportReasons.includes(reason)||Array.from(details).length>1000)fail('invalid_reason');
 return change(user,key,'dm.report',{message,reason,details},async c=>{
  const [m]=await rows(c,'SELECT * FROM forum_dm_messages WHERE id=?',[message]);if(!m)fail('not_found',404);await member(c,m.conversation_id,user,true);if(Number(m.sender_id)===Number(user.id))fail('self_report',403);
  const [prior]=await rows(c,"SELECT id FROM forum_dm_reports WHERE reporter_id=? AND message_id=? AND status IN ('open','reviewing')",[user.id,message]);if(prior)return {id:prior.id};
  const [{n}]=await rows(c,'SELECT COUNT(*) AS n FROM forum_dm_reports WHERE reporter_id=? AND created_at>?',[user.id,new Date(Date.now()-3600000)]);if(n>=10)rate('rate_limited',3600);
  const now=new Date(),r=await rows(c,'INSERT INTO forum_dm_reports(reporter_id,conversation_id,message_id,reason,details,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[user.id,m.conversation_id,message,reason,details,now,now]);return {id:r.insertId};
 },true);
}
export async function reports(user,query={}){
 auth(user);let page=Math.max(1,Math.min(10000,parseInt(query.page,10)||1));
 if(query.report){const [target]=await select('SELECT id FROM forum_dm_reports WHERE reporter_id=? AND id=?',[user.id,idOf(query.report)]);if(!target)fail('not_found',404);const [{n}]=await select('SELECT COUNT(*) AS n FROM forum_dm_reports WHERE reporter_id=? AND id>?',[user.id,target.id]);page=Math.floor(Number(n)/20)+1;}
 const [{total}]=await select('SELECT COUNT(*) AS total FROM forum_dm_reports WHERE reporter_id=?',[user.id]);
 return {items:await select(`SELECT id,reason,details,status,resolution,created_at,conversation_id,version FROM forum_dm_reports WHERE reporter_id=? ORDER BY id DESC LIMIT 20 OFFSET ${(page-1)*20}`,[user.id]),page,pages:Math.max(1,Math.ceil(Number(total)/20))};
}
export async function withdrawReport(user,key,id){return change(user,key,'dm.report.withdraw',{id:idOf(id)},async c=>{const [r]=await rows(c,'SELECT * FROM forum_dm_reports WHERE id=? AND reporter_id=? FOR UPDATE',[id,user.id]);if(!r)fail('not_found',404);if(r.status!=='open'&&r.status!=='withdrawn')fail('report_in_progress',409);await rows(c,"UPDATE forum_dm_reports SET status='withdrawn',version=version+1,updated_at=? WHERE id=?",[new Date(),id]);return {ok:true};},true);}
async function operator(c,actor){const [u]=await rows(c,"SELECT role FROM forum_members WHERE user_id=? AND role IN ('moderator','admin')",[idOf(actor)]);if(!u)fail('forbidden',403);return u;}
export async function moderate(actor,{reportId,version,action,reason}){
 actor=idOf(actor);reportId=idOf(reportId);reason=String(reason||'').trim();if(reason.length<3||reason.length>1000||!['claim','uphold','dismiss','restore'].includes(action))fail('invalid_state');
 return transaction(async c=>{
  const op=await operator(c,actor);const [r]=await rows(c,'SELECT * FROM forum_dm_reports WHERE id=? FOR UPDATE',[reportId]);if(!r)fail('not_found',404);if(Number(version)!==r.version)fail('version_conflict',409);
  if(action==='claim'&&r.status!=='open'||['uphold','dismiss'].includes(action)&&(r.status!=='reviewing'||Number(r.assigned_to)!==actor)||action==='restore'&&(r.status!=='upheld'||op.role!=='admin'))fail('invalid_state',409);
  const [m]=await rows(c,'SELECT * FROM forum_dm_messages WHERE id=?',[r.message_id]);
  await rows(c,'SELECT id FROM forum_dm_conversations WHERE id=? FOR UPDATE',[r.conversation_id]);
  let status=action==='claim'?'reviewing':action==='uphold'?'upheld':'dismissed';
  await rows(c,'UPDATE forum_dm_reports SET status=?,assigned_to=?,resolution=?,version=version+1,updated_at=? WHERE id=?',[status,action==='claim'?actor:r.assigned_to,reason,new Date(),r.id]);
  let before={status:m.status},after={status:m.status};
  if(action==='uphold'){
   const [state]=await rows(c,'SELECT suspended_until FROM forum_members WHERE user_id=?',[m.sender_id]);
   before.suspended_until=state?.suspended_until||null;const until=new Date(Math.max(Date.now()+86400000,new Date(state?.suspended_until||0).getTime()));until.setMilliseconds(0);
   await rows(c,"UPDATE forum_dm_messages SET status='hidden' WHERE id=?",[m.id]);
   await rows(c,'INSERT INTO forum_members(user_id,suspended_until) VALUES (?,?) ON DUPLICATE KEY UPDATE suspended_until=?',[m.sender_id,until,until]);after={status:'hidden',suspended_until:until};
  }else if(action==='restore'){
   await rows(c,"UPDATE forum_dm_messages SET status='published' WHERE id=?",[m.id]);after.status='published';
   const [audit]=await rows(c,"SELECT before_state,after_state FROM forum_audit WHERE target_type='dm_report' AND target_id=? AND action='uphold' ORDER BY id DESC LIMIT 1",[r.id]);
   if(audit){const old=JSON.parse(audit.before_state),applied=JSON.parse(audit.after_state);await rows(c,'UPDATE forum_members SET suspended_until=? WHERE user_id=? AND suspended_until=?',[old.suspended_until?new Date(old.suspended_until):null,m.sender_id,new Date(applied.suspended_until)]);}
  }
  const audit=await rows(c,'INSERT INTO forum_audit(actor_id,action,target_type,target_id,reason,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?)',[actor,action,'dm_report',r.id,reason,JSON.stringify(before),JSON.stringify(after),new Date()]);
  if(action!=='claim'){
   for(const [uid,kind]of [[r.reporter_id,'dm_report_result'],...(action==='dismiss'?[]:[[m.sender_id,action==='restore'?'dm_content_restored':'dm_content_hidden']])])
    await rows(c,'INSERT IGNORE INTO forum_notifications(user_id,actor_id,kind,target_type,target_id,event_key,created_at) VALUES (?,?,?,?,?,?,?)',[uid,actor,kind,'dm_report',r.id,`dm:${r.id}:${Number(version)+1}:${uid}:${audit.insertId}`,new Date()]);
  }
  return {ok:true,status,version:Number(version)+1};
 });
}
export async function reviewReports(actor,id){
 return transaction(async c=>{
  await operator(c,actor);
  if(!id)return rows(c,"SELECT id,reason,status,version,assigned_to,created_at FROM forum_dm_reports WHERE status IN ('open','reviewing') ORDER BY id LIMIT 100");
  const [r]=await rows(c,'SELECT * FROM forum_dm_reports WHERE id=?',[idOf(id)]);if(!r||Number(r.assigned_to)!==Number(actor)||r.status==='open')fail('forbidden',403);
  const [m]=await rows(c,'SELECT seq FROM forum_dm_messages WHERE id=?',[r.message_id]);
  await rows(c,'INSERT INTO forum_audit(actor_id,action,target_type,target_id,reason,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?)',[actor,'evidence.read','dm_report',r.id,'查看领取举报的有限上下文','{}','{}',new Date()]);
  return {report:r,evidence:await rows(c,'SELECT id,seq,sender_id,body,status,created_at FROM forum_dm_messages WHERE conversation_id=? AND seq BETWEEN ? AND ? ORDER BY seq',[r.conversation_id,Math.max(1,m.seq-5),m.seq+5])};
 });
}
