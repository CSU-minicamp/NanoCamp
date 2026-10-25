// Operator-only CLI. No public administration endpoint is provided.
import {moderation,listReports} from '../backend/forum.mjs';
import {select,transaction,closePool} from '../backend/db.mjs';
import {moderate as moderateDm,reviewReports} from '../backend/dm.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];}));
try {
  if(args.kind==='dm'){
    console.log(args.action?await moderateDm(args.actor,{reportId:args.report,version:args.version,action:args.action,reason:args.reason}):await reviewReports(args.actor,args.report));
  }else if(args.bootstrap){
    await transaction(async c=>{
      const [[lock]]=await c.query("SELECT GET_LOCK('nanocamp_forum_bootstrap',10) AS ok");if(!lock.ok)throw Error('Bootstrap locked');
      try {
        const [[count]]=await c.query("SELECT COUNT(*) AS n FROM forum_members WHERE role IN ('admin','moderator')");if(count.n)throw Error('A maintainer already exists; bootstrap is disabled');
        const [[user]]=await c.execute('SELECT id FROM users WHERE id=?',[args.bootstrap]);if(!user)throw Error('User not found');
        await c.execute("INSERT INTO forum_members(user_id,role) VALUES (?,'admin') ON DUPLICATE KEY UPDATE role='admin'",[user.id]);
        await c.execute('INSERT INTO forum_audit(actor_id,action,target_type,target_id,reason,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?)',[user.id,'bootstrap','user',user.id,'Local operator bootstrap','member','admin',new Date()]);
        console.log('Initial forum administrator assigned to user',user.id);
      }finally{await c.query("SELECT RELEASE_LOCK('nanocamp_forum_bootstrap')");}
    });
  }else if(args.action){
    console.log(await moderation(args.actor,{reportId:args.report,version:args.version,action:args.action,reason:args.reason}));
  }else{
    const reports=await listReports(args.actor,args.report);console.table(reports);
    if(args.report&&reports[0]){
      const r=reports[0];const table=r.target_type==='topic'?'forum_topics':'forum_replies';
      console.table(await select(`SELECT id,author_id,body,status FROM ${table} WHERE id=?`,[r.target_id]));
    }
  }
}catch(error){console.error('[forum:moderate]',error.code||'',error.message);process.exitCode=1;}
finally{await closePool();}
