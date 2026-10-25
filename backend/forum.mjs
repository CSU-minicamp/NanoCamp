import {createHash} from 'node:crypto';
import {select,transaction} from './db.mjs';
import {missingFields} from './auth.mjs';
import {postImageSources,forumImagePath} from './forum-markdown.mjs';

export const categories=[{id:'questions',name:'提问交流'},{id:'projects',name:'作品实践'},{id:'teams',name:'组队招募'}];
export const reportReasons=['垃圾推广','人身攻击或骚扰','隐私泄露','违法或不当内容','其他'];
export class ForumError extends Error { constructor(code,status=422){super(code);this.code=code;this.status=status;} }
export const fail=(code,status=422)=>{throw new ForumError(code,status);};
export const idOf=value=>{const s=String(value??'');if(!/^[1-9]\d{0,14}$/.test(s))fail('not_found',404);return Number(s);};
const rows=async(c,sql,args=[])=>{const [result]=await c.execute(sql,args);return result;};
const pageOf=value=>Math.min(500,Math.max(1,Number.parseInt(value,10)||1));
const text=(value,min,max)=>{if(typeof value!=='string')fail('invalid_content');const s=value.trim();const n=Array.from(s).length;if(n<min||n>max)fail('invalid_content');return s;};
const categoryOf=value=>{if(!categories.some(c=>c.id===value))fail('invalid_category');return value;};
const tableOf=kind=>kind==='topic'?'forum_topics':kind==='reply'?'forum_replies':fail('not_found',404);
const voteTable=kind=>kind==='topic'?'forum_topic_votes':'forum_reply_votes';
export const checkMember=async(c,user,passive=false)=>{
  if(!user)fail('unauthenticated',401);
  // Lock the user first in every write: serializes rate checks and retries per actor.
  const [actor]=await rows(c,'SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);
  if(!actor)fail('unauthenticated',401);
  if(passive)return;
  if(missingFields(user).length)fail('profile_incomplete',403);
  const [state]=await rows(c,'SELECT * FROM forum_members WHERE user_id=?',[user.id]);
  if(state?.banned_at||state?.suspended_until&&new Date(state.suspended_until)>new Date())fail('posting_suspended',403);
};

async function notice(c,user,actor,kind,type,id,key){
  if(Number(user)===Number(actor)&&['reply','like','follow'].includes(kind))return;
  await rows(c,`INSERT IGNORE INTO forum_notifications(user_id,actor_id,kind,target_type,target_id,event_key,created_at) VALUES (?,?,?,?,?,?,?)`,[user,actor,kind,type,id,key,new Date()]);
}
async function topicLocked(c,id){
  const [topic]=await rows(c,'SELECT * FROM forum_topics WHERE id=? FOR UPDATE',[id]);
  if(!topic||topic.status==='hidden')fail('not_found',404);
  return topic;
}
async function targetLocked(c,kind,id){
  if(kind==='topic')return {item:await topicLocked(c,id),topic:null};
  tableOf(kind);
  const [ref]=await rows(c,'SELECT topic_id FROM forum_replies WHERE id=?',[id]);
  if(!ref)fail('not_found',404);
  const topic=await topicLocked(c,ref.topic_id);
  const [item]=await rows(c,'SELECT * FROM forum_replies WHERE id=? FOR UPDATE',[id]);
  if(!item||item.status==='hidden')fail('not_found',404);
  return {item,topic};
}
async function limit(c,user,action,max,seconds=3600){
  const [count]=await rows(c,'SELECT COUNT(*) AS n FROM forum_write_requests WHERE user_id=? AND action=? AND created_at>?',[user.id,action,new Date(Date.now()-seconds*1000)]);
  if(count.n>=max)fail('rate_limited',429);
}
export async function write(user,key,action,payload,work){
  if(!/^[\w-]{8,80}$/.test(String(key??'')))fail('idempotency_required');
  const digest=createHash('sha256').update(JSON.stringify({action,payload})).digest('hex');
  return transaction(async c=>{
    await checkMember(c,user,action==='notifications.read');
    const [prior]=await rows(c,'SELECT * FROM forum_write_requests WHERE user_id=? AND request_key=?',[user.id,key]);
    if(prior){if(prior.digest!==digest)fail('request_conflict',409);return JSON.parse(prior.result);}
    await limit(c,user,action,120);
    const result=await work(c);
    await rows(c,'INSERT INTO forum_write_requests(user_id,request_key,digest,action,result,created_at) VALUES (?,?,?,?,?,?)',[user.id,key,digest,action,JSON.stringify(result),new Date()]);
    return result;
  });
}

export async function createTopic(user,key,data){
  const title=text(data.title,4,80),body=text(data.body,10,15000),category=categoryOf(data.category);
  const sources=postImageSources(body);
  if(sources.length>9)fail('too_many_images');
  const imageIds=[...new Set(sources.map(src=>{const match=String(src).match(forumImagePath);if(!match)fail('invalid_image_reference');return match[1];}))];
  return write(user,key,'topic.create',{title,body,category},async c=>{
    await limit(c,user,'topic.create',3);const now=new Date();
    if(imageIds.length){
      const images=await rows(c,`SELECT id,owner_id,topic_id,created_at FROM forum_images WHERE id IN (${imageIds.map(()=>'?').join(',')}) ORDER BY id FOR UPDATE`,imageIds);
      if(images.length!==imageIds.length||images.some(i=>Number(i.owner_id)!==Number(user.id)||i.topic_id||new Date(i.created_at)<new Date(Date.now()-7*86400000)))fail('invalid_image_reference');
    }
    const result=await rows(c,'INSERT INTO forum_topics(author_id,category,title,body,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[user.id,category,title,body,now,now,now]);
    if(imageIds.length)await rows(c,`UPDATE forum_images SET topic_id=? WHERE id IN (${imageIds.map(()=>'?').join(',')})`,[result.insertId,...imageIds]);
    return {id:result.insertId,href:`/forum/topics/${result.insertId}/`};
  });
}
export async function createReply(user,key,id,data){
  id=idOf(id);const body=text(data.body,1,3000),parent=data.parentId?idOf(data.parentId):null;
  return write(user,key,'reply.create',{id,body,parent},async c=>{
    await limit(c,user,'reply.create',20);const topic=await topicLocked(c,id);
    if(topic.status!=='published')fail('topic_closed',409);
    if(parent){const [p]=await rows(c,'SELECT * FROM forum_replies WHERE id=? AND topic_id=?',[parent,id]);if(!p||p.status!=='published')fail('invalid_reply_target');}
    const [{n}]=await rows(c,'SELECT COALESCE(MAX(sequence),0)+1 AS n FROM forum_replies WHERE topic_id=?',[id]);
    const now=new Date();const r=await rows(c,'INSERT INTO forum_replies(topic_id,author_id,parent_id,body,sequence,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[id,user.id,parent,body,n,now,now]);
    await rows(c,'UPDATE forum_topics SET reply_count=reply_count+1,last_activity_at=? WHERE id=?',[now,id]);
    const recipients=new Set([Number(topic.author_id)]);
    if(parent){const [p]=await rows(c,'SELECT author_id FROM forum_replies WHERE id=?',[parent]);recipients.add(Number(p.author_id));}
    for(const recipient of recipients)await notice(c,recipient,user.id,'reply','reply',r.insertId,`reply:${r.insertId}`);
    return {id:r.insertId,href:`/forum/topics/${id}/#reply-${r.insertId}`};
  });
}
async function recalcTopic(c,id){
  const [row]=await rows(c,"SELECT COUNT(*) AS n,MAX(created_at) AS latest FROM forum_replies WHERE topic_id=? AND status='published'",[id]);
  await rows(c,'UPDATE forum_topics SET reply_count=?,last_activity_at=COALESCE(?,created_at) WHERE id=?',[row.n,row.latest,id]);
}
export async function withdrawContent(user,key,kind,id){
  id=idOf(id);return write(user,key,`${kind}.withdraw`,{id},async c=>{
    const {item}=await targetLocked(c,kind,id);
    if(Number(item.author_id)!==Number(user.id))fail('forbidden',403);
    if(item.status==='withdrawn')return {ok:true};
    await rows(c,`UPDATE ${tableOf(kind)} SET status='withdrawn',version=version+1,updated_at=? WHERE id=?`,[new Date(),id]);
    if(kind==='reply')await recalcTopic(c,item.topic_id);
    return {ok:true};
  });
}
export async function vote(user,key,kind,id,value){
  id=idOf(id);if(![-1,0,1].includes(value))fail('invalid_vote');
  return write(user,key,`${kind}.vote`,{id,value},async c=>{
    const {item,topic}=await targetLocked(c,kind,id);
    if(item.status!=='published'||topic&&topic.status!=='published')fail('content_unavailable',409);
    if(Number(item.author_id)===Number(user.id))fail('self_vote',403);
    if(value===0)await rows(c,`DELETE FROM ${voteTable(kind)} WHERE target_id=? AND user_id=?`,[id,user.id]);
    else await rows(c,`INSERT INTO ${voteTable(kind)}(target_id,user_id,value) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)`,[id,user.id,value]);
    if(value===1)await notice(c,item.author_id,user.id,'like',kind,id,`like:${kind}:${id}:${user.id}`);
    return await voteState(c,kind,id,user.id);
  });
}
async function voteState(c,kind,id,userId){
  const [v]=await rows(c,`SELECT COALESCE(SUM(value=1),0) AS up,COALESCE(SUM(value=-1),0) AS down,COALESCE(MAX(CASE WHEN user_id=? THEN value END),0) AS mine FROM ${voteTable(kind)} WHERE target_id=?`,[userId||0,id]);
  return {up:Number(v.up),down:Number(v.down),mine:Number(v.mine)};
}
export async function follow(user,key,id,enabled){
  id=idOf(id);if(typeof enabled!=='boolean')fail('invalid_state');
  return write(user,key,'follow',{id,enabled},async c=>{
    if(id===Number(user.id))fail('self_follow',403);
    const [target]=await rows(c,'SELECT u.id,m.banned_at FROM users u LEFT JOIN forum_members m ON m.user_id=u.id WHERE u.id=?',[id]);
    if(!target||target.banned_at)fail('not_found',404);
    if(enabled){await rows(c,'INSERT IGNORE INTO forum_follows(follower_id,followed_id,created_at) VALUES (?,?,?)',[user.id,id,new Date()]);await notice(c,id,user.id,'follow','user',user.id,`follow:${user.id}`);}
    else await rows(c,'DELETE FROM forum_follows WHERE follower_id=? AND followed_id=?',[user.id,id]);
    return {enabled};
  });
}
export async function bookmark(user,key,id,enabled){
  id=idOf(id);if(typeof enabled!=='boolean')fail('invalid_state');
  return write(user,key,'bookmark',{id,enabled},async c=>{
    if(enabled){const topic=await topicLocked(c,id);if(topic.status!=='published')fail('content_unavailable',409);await rows(c,'INSERT IGNORE INTO forum_bookmarks(user_id,topic_id,created_at) VALUES (?,?,?)',[user.id,id,new Date()]);}
    else await rows(c,'DELETE FROM forum_bookmarks WHERE user_id=? AND topic_id=?',[user.id,id]);
    const [{total}]=await rows(c,'SELECT COUNT(*) AS total FROM forum_bookmarks WHERE topic_id=?',[id]);
    return {enabled,count:Number(total)};
  });
}
export async function report(user,key,data){
  const kind=data.type;tableOf(kind);const id=idOf(data.id),reason=text(data.reason,1,32),details=text(data.details||'',reason==='其他'?5:0,1000);
  if(!reportReasons.includes(reason))fail('invalid_reason');
  return write(user,key,'report',{kind,id,reason,details},async c=>{
    const {item,topic}=await targetLocked(c,kind,id);
    if(item.status!=='published')fail('content_unavailable',409);
    const [prior]=await rows(c,"SELECT id FROM forum_reports WHERE reporter_id=? AND target_type=? AND target_id=? AND status IN('open','reviewing')",[user.id,kind,id]);
    if(prior)return {id:prior.id};
    await limit(c,user,'report',10);
    const [recent]=await rows(c,'SELECT created_at FROM forum_reports WHERE reporter_id=? AND target_type=? AND target_id=? ORDER BY id DESC LIMIT 1',[user.id,kind,id]);
    if(recent&&Date.now()-new Date(recent.created_at)<86400000)fail('report_cooldown',429);
    const now=new Date();const r=await rows(c,'INSERT INTO forum_reports(reporter_id,target_type,target_id,topic_id,reason,details,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',[user.id,kind,id,topic?.id||item.id,reason,details,now,now]);
    return {id:r.insertId};
  });
}
export async function withdrawReport(user,key,id){
  id=idOf(id);return write(user,key,'report.withdraw',{id},async c=>{
    const [r]=await rows(c,'SELECT * FROM forum_reports WHERE id=? FOR UPDATE',[id]);
    if(!r||Number(r.reporter_id)!==Number(user.id))fail('not_found',404);
    if(r.status==='withdrawn')return {ok:true};if(r.status!=='open')fail('report_in_progress',409);
    await rows(c,"UPDATE forum_reports SET status='withdrawn',version=version+1,updated_at=? WHERE id=?",[new Date(),id]);return {ok:true};
  });
}

const listSelect=`SELECT t.*,u.nickname FROM forum_topics t JOIN users u ON u.id=t.author_id`;
async function enrichTopicRows(items,viewer=0){
  if(!items.length)return items;
  const ids=items.map(t=>t.id),marks=ids.map(()=>'?').join(',');
  const votes=await select(`SELECT target_id,SUM(value=1) AS likes,MAX(CASE WHEN user_id=? THEN value END) AS mine FROM forum_topic_votes WHERE target_id IN (${marks}) GROUP BY target_id`,[viewer||0,...ids]);
  const bookmarks=await select(`SELECT topic_id,COUNT(*) AS total,MAX(user_id=?) AS mine FROM forum_bookmarks WHERE topic_id IN (${marks}) GROUP BY topic_id`,[viewer||0,...ids]);
  const voteMap=new Map(votes.map(v=>[Number(v.target_id),v])),bookMap=new Map(bookmarks.map(b=>[Number(b.topic_id),b]));
  for(const item of items){const v=voteMap.get(Number(item.id)),b=bookMap.get(Number(item.id));item.like_count=Number(v?.likes||0);item.vote_mine=Number(v?.mine||0);item.bookmark_count=Number(b?.total||0);item.bookmarked=Boolean(Number(b?.mine||0));}
  return items;
}
export async function listTopics(params={},userId=0){
  const page=pageOf(params.page),where=["t.status='published'"],args=[];
  if(params.category){categoryOf(params.category);where.push('t.category=?');args.push(params.category);}
  const q=String(params.q||'').trim().slice(0,100);
  if(q){const escaped='%'+q.replace(/[!%_]/g,c=>'!'+c)+'%';where.push("(t.title LIKE ? ESCAPE '!' OR t.body LIKE ? ESCAPE '!')");args.push(escaped,escaped);}
  if(params.feed==='following'){if(!userId)fail('unauthenticated',401);where.push('EXISTS(SELECT 1 FROM forum_follows f WHERE f.followed_id=t.author_id AND f.follower_id=?)');args.push(userId);}
  if(params.author){where.push('t.author_id=?');args.push(idOf(params.author));}
  const clause=where.join(' AND '),order=params.sort==='new'?'t.created_at':'t.last_activity_at';
  const [{total}]=await select(`SELECT COUNT(*) AS total FROM forum_topics t WHERE ${clause}`,args);
  const items=await select(`${listSelect} WHERE ${clause} ORDER BY ${order} DESC,t.id DESC LIMIT 20 OFFSET ${(page-1)*20}`,args);
  await enrichTopicRows(items,userId);
  return {items,total:Number(total),page,pages:Math.max(1,Math.ceil(total/20))};
}
async function authorInfo(c,id,viewer=0){
  const [user]=await rows(c,'SELECT id,nickname,bio FROM users WHERE id=?',[id]);if(!user)fail('not_found',404);
  const [[stats]]=await c.execute('SELECT (SELECT COUNT(*) FROM forum_follows WHERE followed_id=?) AS fans,(SELECT COUNT(*) FROM forum_follows WHERE follower_id=?) AS following,EXISTS(SELECT 1 FROM forum_follows WHERE follower_id=? AND followed_id=?) AS followed',[id,id,viewer,id]);
  return {...user,...stats,followed:Boolean(stats.followed)};
}
export async function publicUser(id,viewer=0){return transaction(c=>authorInfo(c,idOf(id),viewer));}
export async function getTopic(id,userId=0,page=1,{target=0}={}){
  id=idOf(id);page=pageOf(page);
  // Short read transaction keeps topic, reply page and vote state consistent.
  return transaction(async c=>{
    const [topic]=await rows(c,`${listSelect} WHERE t.id=?`,[id]);if(!topic||topic.status==='hidden')fail('not_found',404);
    if(topic.status!=='published'){topic.body='';topic.title='已撤回的讨论';}
    const [{total}]=await rows(c,'SELECT COUNT(*) AS total FROM forum_replies WHERE topic_id=?',[id]);
    // Only the viewer's direct replies to the topic are promoted; targeted replies stay in context.
    const ownCondition="author_id=? AND parent_id IS NULL AND status='published'";
    const [{own_total:ownTotal}]=await rows(c,`SELECT COUNT(*) AS own_total FROM forum_replies WHERE topic_id=? AND ${ownCondition}`,[id,userId]);
    if(target){
      const [reply]=await rows(c,'SELECT author_id,parent_id,status,sequence FROM forum_replies WHERE id=? AND topic_id=?',[idOf(target),id]);
      if(!reply)fail('not_found',404);
      const own=Number(reply.author_id)===Number(userId)&&!reply.parent_id&&reply.status==='published';
      const [{before}]=await rows(c,`SELECT COUNT(*) AS \`before\` FROM forum_replies WHERE topic_id=? AND ${own?`(${ownCondition}) AND sequence>?`:`NOT(${ownCondition}) AND sequence<?`}`,[id,userId,reply.sequence]);
      page=Math.floor((Number(before)+(own?0:Number(ownTotal)))/30)+1;
    }
    // Fetch at most 30 bodies in total; do not fetch/sort the entire discussion.
    const offset=(page-1)*30,ownLimit=Math.max(0,Math.min(30,Number(ownTotal)-offset));
    const replySelect=`SELECT r.*,u.nickname,? AS own_priority,p.status AS parent_status,p.sequence AS parent_sequence,CASE WHEN p.status='published' THEN LEFT(p.body,160) ELSE '' END AS parent_excerpt,pu.nickname AS parent_name FROM forum_replies r JOIN users u ON u.id=r.author_id LEFT JOIN forum_replies p ON p.id=r.parent_id LEFT JOIN users pu ON pu.id=p.author_id WHERE r.topic_id=?`;
    const replies=ownLimit?await rows(c,`${replySelect} AND r.author_id=? AND r.parent_id IS NULL AND r.status='published' ORDER BY r.sequence DESC LIMIT ${ownLimit} OFFSET ${offset}`,[1,id,userId]):[];
    if(ownLimit<30)replies.push(...await rows(c,`${replySelect} AND NOT(r.author_id=? AND r.parent_id IS NULL AND r.status='published') ORDER BY r.sequence LIMIT ${30-ownLimit} OFFSET ${Math.max(0,offset-Number(ownTotal))}`,[0,id,userId]));
    const ids=replies.map(r=>r.id);
    const voteRows=ids.length?await rows(c,`SELECT target_id,COALESCE(SUM(value=1),0) AS up,COALESCE(SUM(value=-1),0) AS down,COALESCE(MAX(CASE WHEN user_id=? THEN value END),0) AS mine FROM forum_reply_votes WHERE target_id IN (${ids.map(()=>'?').join(',')}) GROUP BY target_id`,[userId,...ids]):[];
    const voteMap=new Map(voteRows.map(v=>[Number(v.target_id),{up:Number(v.up),down:Number(v.down),mine:Number(v.mine)}]));
    for(const reply of replies){if(reply.status!=='published'){reply.body='';reply.nickname='';}reply.votes=voteMap.get(Number(reply.id))||{up:0,down:0,mine:0};}
    const [book]=await rows(c,'SELECT 1 FROM forum_bookmarks WHERE user_id=? AND topic_id=?',[userId,id]);
    return {topic,replies,page,pages:Math.max(1,Math.ceil(total/30)),votes:await voteState(c,'topic',id,userId),bookmarked:Boolean(book),author:await authorInfo(c,topic.author_id,userId)};
  });
}
export async function locateReply(id){
  const [r]=await select("SELECT r.*,t.status AS topic_status FROM forum_replies r JOIN forum_topics t ON t.id=r.topic_id WHERE r.id=?",[idOf(id)]);
  if(!r||r.topic_status==='hidden')fail('not_found',404);
  return `/forum/topics/${r.topic_id}/?reply=${r.id}#reply-${r.id}`;
}
export async function myContent(userId,tab,page=1){
  page=pageOf(page);const offset=(page-1)*20;let items,total;
  if(tab==='reports'){
    items=await select(`SELECT r.*,CASE WHEN t.status='published' THEN t.title ELSE '内容已不可见' END AS title FROM forum_reports r JOIN forum_topics t ON t.id=r.topic_id WHERE r.reporter_id=? ORDER BY r.id DESC LIMIT 20 OFFSET ${offset}`,[userId]);
    [{total}]=await select('SELECT COUNT(*) AS total FROM forum_reports WHERE reporter_id=?',[userId]);
  }else if(tab==='following'||tab==='fans'){
    const own=tab==='following'?'follower_id':'followed_id',other=tab==='following'?'followed_id':'follower_id';
    items=await select(`SELECT u.id,u.nickname,u.bio FROM forum_follows f JOIN users u ON u.id=f.${other} WHERE f.${own}=? ORDER BY f.created_at DESC LIMIT 20 OFFSET ${offset}`,[userId]);
    [{total}]=await select(`SELECT COUNT(*) AS total FROM forum_follows WHERE ${own}=?`,[userId]);
  }else {
    let where='t.author_id=?',order='t.created_at';
    if(tab==='replies'){where="t.status<>'hidden' AND EXISTS(SELECT 1 FROM forum_replies r WHERE r.topic_id=t.id AND r.author_id=?)";order='(SELECT MAX(r.created_at) FROM forum_replies r WHERE r.topic_id=t.id AND r.author_id='+Number(userId)+')';}
    if(tab==='bookmarks')where='EXISTS(SELECT 1 FROM forum_bookmarks b WHERE b.topic_id=t.id AND b.user_id=?)';
    items=await select(`${listSelect} WHERE ${where} ORDER BY ${order} DESC,t.id DESC LIMIT 20 OFFSET ${offset}`,[userId]);
    [{total}]=await select(`SELECT COUNT(*) AS total FROM forum_topics t WHERE ${where}`,[userId]);
    for(const t of items){if(t.status!=='published'){t.title=t.status==='hidden'?'内容已隐藏':'已撤回的讨论';t.body='';}}
    if(tab==='replies')for(const t of items){const [r]=await select("SELECT id,sequence FROM forum_replies WHERE topic_id=? AND author_id=? AND status='published' ORDER BY id DESC LIMIT 1",[t.id,userId]);if(r)t.jump=`/forum/replies/${r.id}/`;}
    await enrichTopicRows(items,userId);
  }
  return {items,total:Number(total),page,pages:Math.max(1,Math.ceil(total/20))};
}
export async function relations(id,tab,page=1){
  await publicUser(id);if(!['following','fans'].includes(tab))fail('not_found',404);return myContent(idOf(id),tab,page);
}
export async function publicReplies(id,page=1,viewer=0){
  id=idOf(id);page=pageOf(page);
  const where="t.status='published' AND EXISTS(SELECT 1 FROM forum_replies r WHERE r.topic_id=t.id AND r.author_id=? AND r.status='published')";
  const items=await select(`${listSelect} WHERE ${where} ORDER BY t.last_activity_at DESC LIMIT 20 OFFSET ${(page-1)*20}`,[id]);
  const [{total}]=await select(`SELECT COUNT(*) AS total FROM forum_topics t WHERE ${where}`,[id]);
  await enrichTopicRows(items,viewer);
  return {items,total:Number(total),page,pages:Math.max(1,Math.ceil(total/20))};
}

// Notification text is computed on read, never a stale stored copy of hidden content.
export async function notifications(userId,filter='all',page=1){
  page=pageOf(page);const conditions=["n.user_id=?",
    "(n.kind<>'follow' OR EXISTS(SELECT 1 FROM forum_follows f WHERE f.follower_id=n.actor_id AND f.followed_id=n.user_id))",
    "(n.kind<>'like' OR (n.target_type='topic' AND EXISTS(SELECT 1 FROM forum_topic_votes v JOIN forum_topics t ON t.id=v.target_id WHERE v.target_id=n.target_id AND v.user_id=n.actor_id AND v.value=1 AND t.status='published')) OR (n.target_type='reply' AND EXISTS(SELECT 1 FROM forum_reply_votes v JOIN forum_replies r ON r.id=v.target_id JOIN forum_topics t ON t.id=r.topic_id WHERE v.target_id=n.target_id AND v.user_id=n.actor_id AND v.value=1 AND r.status='published' AND t.status='published')))"
  ];
  if(filter==='replies')conditions.push("n.kind='reply'");if(filter==='social')conditions.push("n.kind IN('like','follow')");if(filter==='system')conditions.push("n.kind IN('report_result','content_hidden','content_restored')");
  if(filter==='activity')conditions.push("n.kind IN('reply','like','follow')");
  if(filter==='system')conditions[conditions.length-1]="n.kind NOT IN('reply','like','follow')";
  const clause=conditions.join(' AND ');
  const [{total}]=await select(`SELECT COUNT(*) AS total FROM forum_notifications n WHERE ${clause}`,[userId]);
  const [{unread}]=await select(`SELECT COUNT(*) AS unread FROM forum_notifications n WHERE ${conditions.slice(0,3).join(' AND ')} AND n.read_at IS NULL`,[userId]);
  const items=await select(`SELECT n.*,u.nickname AS actor_name FROM forum_notifications n LEFT JOIN users u ON u.id=n.actor_id WHERE ${clause} ORDER BY n.id DESC LIMIT 20 OFFSET ${(page-1)*20}`,[userId]);
  for(const n of items){
    n.href='';n.title='相关内容已不可见';
    if(n.target_type==='dm_report'){
      const [r]=await select('SELECT r.reporter_id,r.resolution,r.conversation_id,m.sender_id FROM forum_dm_reports r JOIN forum_dm_messages m ON m.id=r.message_id WHERE r.id=?',[n.target_id]);
      if(r&&(Number(r.reporter_id)===Number(userId)||Number(r.sender_id)===Number(userId))){
        const auditId=n.event_key.split(':')[4];const [audit]=auditId?await select("SELECT reason FROM forum_audit WHERE id=? AND target_type='dm_report' AND target_id=?",[idOf(auditId),n.target_id]):[];
        n.title=audit?.reason||r.resolution||'举报处理结果';n.href=Number(r.reporter_id)===Number(userId)?'/forum/me/?tab=reports&kind=dm&report='+n.target_id+'#dm-report-'+n.target_id:'/forum/messages/conversations/'+r.conversation_id+'/';
      }
    }
    if(n.target_type==='user'){n.title=n.actor_name||'社区伙伴';n.href=`/forum/users/${n.target_id}/`;}
    if(n.target_type==='report'){
      const [r]=await select('SELECT resolution,status FROM forum_reports WHERE id=? AND reporter_id=?',[n.target_id,userId]);
      const auditId=n.event_key.split(':')[3];
      const [audit]=auditId?await select('SELECT reason FROM forum_audit WHERE id=?',[idOf(auditId)]):[];
      n.title=audit?.reason||r?.resolution||'举报处理结果';n.href='/forum/me/?tab=reports#report-'+n.target_id;
    }
    if(n.target_type==='topic'||n.target_type==='reply'){
      const [t]=n.target_type==='topic'?await select("SELECT id,title,status FROM forum_topics WHERE id=?",[n.target_id]):await select('SELECT t.id,t.title,t.status,r.status AS reply_status,r.sequence FROM forum_replies r JOIN forum_topics t ON t.id=r.topic_id WHERE r.id=?',[n.target_id]);
      if(t?.status==='published'&&(!t.reply_status||t.reply_status==='published')){n.title=t.title;n.href=t.sequence?`/forum/replies/${n.target_id}/`:`/forum/topics/${t.id}/`;}
      if(n.kind==='content_hidden'||n.kind==='content_restored'){
        const auditId=n.event_key.split(':')[3];
        const [audit]=auditId?await select('SELECT reason FROM forum_audit WHERE id=?',[idOf(auditId)]):await select('SELECT reason FROM forum_audit WHERE target_type=? AND target_id=? AND action=? AND created_at<=? ORDER BY id DESC LIMIT 1',[n.target_type,n.target_id,n.kind==='content_hidden'?'uphold':'restore',n.created_at]);n.title=audit?.reason||'内容状态已更新';
      }
    }
  }
  return {items,unread:Number(unread),total:Number(total),page,pages:Math.max(1,Math.ceil(total/20))};
}
export async function markRead(user,key,ids,filter='all'){
  if(!['all','activity','system'].includes(filter))fail('invalid_state');
  if(ids!=='all'&&(!Array.isArray(ids)||ids.length>100))fail('invalid_state');
  const values=ids==='all'?[]:ids.map(idOf);
  return write(user,key,'notifications.read',{ids,filter},async c=>{
    if(ids==='all')await rows(c,`UPDATE forum_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL ${filter==='all'?'':filter==='system'?"AND kind NOT IN('reply','like','follow')":"AND kind IN('reply','like','follow')"}`,[new Date(),user.id]);
    else if(values.length)await rows(c,`UPDATE forum_notifications SET read_at=? WHERE user_id=? AND id IN (${values.map(()=>'?').join(',')})`,[new Date(),user.id,...values]);
    return {ok:true};
  });
}

export async function moderation(actorId,{reportId,version,action,reason}){
  actorId=idOf(actorId);reportId=idOf(reportId);reason=text(reason,3,1000);
  if(!['claim','uphold','dismiss','restore'].includes(action))fail('invalid_action');
  return transaction(async c=>{
    const [role]=await rows(c,'SELECT role,banned_at FROM forum_members WHERE user_id=?',[actorId]);
    if(!role||role.banned_at||!['moderator','admin'].includes(role.role))fail('forbidden',403);
    const [ref]=await rows(c,'SELECT * FROM forum_reports WHERE id=?',[reportId]);if(!ref)fail('not_found',404);
    // Always lock topic before report, matching every content mutation.
    const [topic]=await rows(c,'SELECT * FROM forum_topics WHERE id=? FOR UPDATE',[ref.topic_id]);
    const [r]=await rows(c,'SELECT * FROM forum_reports WHERE id=? FOR UPDATE',[reportId]);
    if(r.version!==Number(version))fail('version_conflict',409);
    if(action!=='restore'&&!['open','reviewing'].includes(r.status))fail('report_closed',409);
    if(action==='restore'&&r.status!=='upheld')fail('report_closed',409);
    if(r.assigned_to&&Number(r.assigned_to)!==actorId&&role.role!=='admin')fail('report_assigned',403);
    const [target]=await rows(c,`SELECT * FROM ${tableOf(r.target_type)} WHERE id=? FOR UPDATE`,[r.target_id]);if(!target)fail('not_found',404);
    const status=action==='claim'?'reviewing':action==='uphold'?'upheld':action==='dismiss'?'dismissed':r.status;
    if(action==='restore'&&target.status!=='hidden')fail('content_unavailable',409);
    if(action==='uphold'&&target.status==='published')await rows(c,`UPDATE ${tableOf(r.target_type)} SET status='hidden',version=version+1,updated_at=? WHERE id=?`,[new Date(),target.id]);
    if(action==='restore')await rows(c,`UPDATE ${tableOf(r.target_type)} SET status='published',version=version+1,updated_at=? WHERE id=?`,[new Date(),target.id]);
    if(r.target_type==='reply')await recalcTopic(c,topic.id);
    await rows(c,'UPDATE forum_reports SET status=?,resolution=?,assigned_to=?,version=version+1,updated_at=? WHERE id=?',[status,reason,actorId,new Date(),reportId]);
    const before=JSON.stringify({report:r.status,content:target.status}),after=JSON.stringify({report:status,action});
    const audit=await rows(c,'INSERT INTO forum_audit(actor_id,action,target_type,target_id,reason,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?)',[actorId,action,r.target_type,r.target_id,reason,before,after,new Date()]);
    if(action!=='claim')await notice(c,r.reporter_id,actorId,'report_result','report',reportId,`report:${reportId}:${r.version+1}:${audit.insertId}`);
    if(action==='restore'||action==='uphold'&&target.status==='published')await notice(c,target.author_id,actorId,action==='restore'?'content_restored':'content_hidden',r.target_type,r.target_id,`moderation:${reportId}:${r.version+1}:${audit.insertId}`);
    return {id:reportId,status,version:r.version+1};
  });
}
export async function listReports(actorId,id){
  const [role]=await select('SELECT role,banned_at FROM forum_members WHERE user_id=?',[idOf(actorId)]);
  if(!role||role.banned_at||!['admin','moderator'].includes(role.role))fail('forbidden',403);
  if(id)return select('SELECT * FROM forum_reports WHERE id=?',[idOf(id)]);
  return select("SELECT id,target_type,target_id,reason,status,version,assigned_to,created_at FROM forum_reports WHERE status IN('open','reviewing') ORDER BY id LIMIT 100");
}
