// 可重复执行的本地手测数据准备：每次新建一批，不清空也不重置已有批次。
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {loadConfig} from '../backend/config.mjs';
import {transaction,select,closePool,ping} from '../backend/db.mjs';
import {hashPassword} from '../backend/auth.mjs';

const config=loadConfig();
if(config.db?.host!=='127.0.0.1'||Number(config.db?.port)!==3318||config.db?.database!=='nanocamp_local'||config.host!=='127.0.0.1'||config.port!==4187){
  throw Error('E2E fixtures require the isolated local configuration: 127.0.0.1:3318/nanocamp_local, app 127.0.0.1:4187');
}
const manifestUrl=new URL('../data/forum-e2e.json',import.meta.url);
const specs=[['author','作者','完整资料的发帖人'],['participant','参与者','完整资料的回复人'],['reporter','举报人','核对举报隐私和处理结果'],['incomplete','待完善','缺少昵称'],['muted','禁言账号','可阅读，不能进行论坛互动'],['operator','处理人员','仅通过服务器命令行处理举报']];
async function writeGuide(manifest){
  const accounts=specs.map(([key,name])=>`| ${name} | ${manifest.accounts[key].email} | ${manifest.accounts[key].id} |`).join('\n');
  let guide;
  try{guide=await readFile(new URL('../docs/forum-qa-plan.md',import.meta.url),'utf8');}
  catch(error){
    if(error.code!=='ENOENT')
      throw error;
    console.log('（docs/forum-qa-plan.md 不存在，跳过生成手测指南）');
    return;
  }
  const variables={BASE:manifest.base,RUN:manifest.run,PASSWORD:manifest.password,ACCOUNTS:accounts,OPERATOR:manifest.accounts.operator.id,AUTHOR:manifest.accounts.author.id,REPORT_REPLY:manifest.replies.report,LAST_REPLY:manifest.replies.lastPage};
  for(const [key,t]of Object.entries(manifest.topics))variables[key.toUpperCase()]=t.url;
  guide=guide.replace(/^这是测试流程模板。.*$/m,'本文件已填入当前本地批次的账号、密码和数据链接，可直接按顺序测试。');
  guide=guide.replace(/\{\{([A-Z_]+)\}\}/g,(_,key)=>variables[key]??(()=>{throw Error('Unknown guide variable '+key);})());
  await writeFile(new URL('../data/forum-e2e-guide.md',import.meta.url),guide);
}
try {
  if(!(await ping()).ok)throw Error('Local MySQL is not ready');
  let existing;
  try{existing=JSON.parse(await readFile(manifestUrl,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing&&!process.argv.includes('--new-run')){
    const [user]=await select('SELECT id FROM users WHERE id=? AND email=?',[existing.accounts.author.id,existing.accounts.author.email]);
    if(!user)throw Error('Saved fixtures no longer exist. Run with --new-run to prepare a fresh batch.');
    await writeGuide(existing);
    console.log('Existing E2E batch retained:',existing.run,'See data/forum-e2e-guide.md. Use --new-run for a fresh batch.');
  }else{
    const run=new Date().toISOString().replace(/\D/g,'').slice(0,14)+'-'+randomBytes(2).toString('hex');
    const password='Nc-E2E-'+randomBytes(9).toString('base64url')+'!';
    const passwordHash=await hashPassword(password),now=new Date();
    const manifest={run,createdAt:now.toISOString(),base:'http://127.0.0.1:4187',database:'nanocamp_local',password,accounts:{},topics:{},replies:{}};
    await transaction(async c=>{
      for(const [key,name,bio]of specs){
        const email=`e2e-${run}-${key}@example.test`,nickname=key==='incomplete'?'':`端测${name}`;
        const [r]=await c.execute('INSERT INTO users(email,nickname,bio,password_hash,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[email,nickname,bio,passwordHash,now,now,now]);
        manifest.accounts[key]={id:r.insertId,email,nickname,role:key==='operator'?'moderator':key==='muted'?'ban':'member'};
        // 有这一行才不是「完全普通的成员」：operator 是永久版务，muted 是到 2099 年的禁言。
        if(key === 'operator' || key === 'muted')
          await c.execute('INSERT INTO forum_member_roles(member_id,type,expired_at,created_at) VALUES (?,?,?,?)', [r.insertId, key === 'operator'? 'moderator': 'ban', key === 'muted'? new Date('2099-01-01T00:00:00Z'): null, now]);
      }
      const topics=[
        ['main','交流主帖','questions','准备参加 minicamp，想找伙伴一起做校园工具。\n\n## 想讨论的问题\n\n- 如何选择第一版功能？\n- 如何分工？\n\n欢迎分享你的经验。'],
        ['edit','发布后不可修改','projects','这是独立的发布后修改拒绝测试帖子。请确认作者和其他用户都无法修改，旧编辑地址不可用，PATCH 请求会被拒绝。'],
        ['withdraw','撤回与上下文','teams','这是独立的撤回测试帖子。先增加一条回复，再撤回正文，确认已有回复仍保留且不能新增回复。'],
        ['pages','回复分页','questions','这个帖子预置 31 条回复。检查第二页、楼层跳转，以及隐藏或撤回后回复定位是否稳定。'],
        ['dismiss','举报驳回','projects','这是用于举报驳回的正常内容。与交流主帖分开测试，避免同一内容举报的 24 小时限制影响流程。'],
        ['cancel','举报撤回','teams','这是用于领取前撤回举报的独立测试内容。撤回后不在同一账号下立即重新举报此内容。']
      ];
      for(const [key,title,category,body]of topics){
        const [r]=await c.execute('INSERT INTO forum_posts(poster_id,category,title,content,last_activity_at,created_at) VALUES (?,?,?,?,?,?)',[manifest.accounts.author.id,category,`[E2E ${run}] ${title}`,body,now,now]);
        manifest.topics[key]={id:r.insertId,title:`[E2E ${run}] ${title}`,url:`${manifest.base}/forum/topics/${r.insertId}/`};
      }
      const addReply=async(key,body,seq)=>{
        const [r]=await c.execute('INSERT INTO forum_post_replies(post_id,poster_id,content,sequence,created_at) VALUES (?,?,?,?,?)',[manifest.topics[key].id,manifest.accounts.participant.id,body,seq,now]);return r.insertId;
      };
      // 直接写库绕过了发号器，所以要把 next_sequence 与 reply_count 一起对齐，否则后续回复会撞唯一键。
      const syncPost=async key=>c.execute('UPDATE forum_posts SET reply_count=(SELECT COUNT(*) FROM forum_post_replies WHERE post_id=?),next_sequence=(SELECT COALESCE(MAX(sequence),0)+1 FROM forum_post_replies WHERE post_id=?) WHERE id=?',[manifest.topics[key].id,manifest.topics[key].id,manifest.topics[key].id]);
      manifest.replies.report=await addReply('main','[E2E] 这条回复专门用于举报成立、删除和恢复测试，不包含真实违规内容。',1);
      await syncPost('main');
      for(let i=1;i<=31;i++)manifest.replies.lastPage=await addReply('pages',`[E2E] 分页测试回复 ${String(i).padStart(2,'0')}`,i);
      await syncPost('pages');
    });
    // 这些数据直接写库（不走接口），免得把手工测试账号的发帖额度用光。
    await mkdir(new URL('../data/e2e-runs/',import.meta.url),{recursive:true});
    await writeFile(manifestUrl,JSON.stringify(manifest,null,2)+'\n');
    await writeFile(new URL(`../data/e2e-runs/${run}.json`,import.meta.url),JSON.stringify(manifest,null,2)+'\n');
    await writeGuide(manifest);
    console.log('E2E batch prepared:',run,'Accounts:',specs.length,'Topics:',Object.keys(manifest.topics).length,'Replies: 32');
    console.log('Local credentials and runnable guide: data/forum-e2e-guide.md; manifest: data/forum-e2e.json');
  }
}catch(error){console.error('[forum:e2e:prepare]',error.code||'',error.message);process.exitCode=1;}
finally{await closePool();}
