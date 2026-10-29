// 运维用的命令行工具：站点不提供任何公开的管理接口。
//
//   node scripts/forum-moderate.mjs actor=<uid>                      列出待处理举报
//   node scripts/forum-moderate.mjs actor=<uid> kind=post report=<id> 看一条举报与内容
//   node scripts/forum-moderate.mjs actor=<uid> kind=post report=<id> version=<v> action=uphold reason=…
//   node scripts/forum-moderate.mjs actor=<uid> kind=dm …            私信举报
//   node scripts/forum-moderate.mjs bootstrap=<uid>                  第一个管理员
//
// `kind` 有两个用途：dm 表示私信举报，post / reply 表示帖子或回复举报（两张表编号会撞，必须指明）。
import {moderation, listReports} from '../backend/forum/index.mjs';
import {select, transaction, closePool} from '../backend/db.mjs';
import {moderate as moderateDm, reviewReports} from '../backend/forum/dm.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const index = value.indexOf('=');
  return [value.slice(0, index), value.slice(index + 1)];
}));

try{
  if(args.kind === 'dm'){
    console.log(args.action? await moderateDm(args.actor, {reportId: args.report, version: args.version, action: args.action, reason: args.reason}): await reviewReports(args.actor, args.report));
  }
  else if(args.bootstrap){
    await transaction(async c => {
      const [[lock]] = await c.query("SELECT GET_LOCK('nanocamp_forum_bootstrap',10) AS ok");
      if(!lock.ok)
        throw Error('Bootstrap locked');
      try{
        // 判「有没有在任版务」也把过期算进去；时间由 Node 传，不用 NOW()（连接是 UTC，会话时区可能不同）。
        const [[count]] = await c.execute("SELECT COUNT(*) AS n FROM forum_member_roles WHERE type IN ('admin','moderator') AND (expired_at IS NULL OR expired_at > ?)", [new Date()]);
        if(count.n)
          throw Error('A maintainer already exists; bootstrap is disabled');
        const [[user]] = await c.execute('SELECT id FROM users WHERE id=?', [args.bootstrap]);
        if(!user)
          throw Error('User not found');
        // 永久管理员：expired_at 留 NULL。已经有行（比如正被封）时直接改成本次任命。
        const now = new Date();
        await c.execute("INSERT INTO forum_member_roles(member_id,type,created_at) VALUES (?,'admin',?) ON DUPLICATE KEY UPDATE type='admin',expired_at=NULL,created_at=?", [user.id, now, now]);
        console.log('Initial forum administrator assigned to user', user.id);
      }
      finally{
        await c.query("SELECT RELEASE_LOCK('nanocamp_forum_bootstrap')");
      }
    });
  }
  else if(args.action){
    console.log(await moderation(args.actor, {kind: args.kind || 'post', reportId: args.report, version: args.version, action: args.action, reason: args.reason}));
  }
  else{
    const reports = await listReports(args.actor, args.report, args.kind);
    console.table(reports);
    if(args.report && reports[0]){
      const row = reports[0];
      const table = row.kind === 'post'? 'forum_posts': 'forum_post_replies';
      console.table(await select(`SELECT id,poster_id AS author_id,content AS body,status FROM ${table} WHERE id=?`, [row.target_id]));
    }
  }
}
catch(error){
  console.error('[forum:moderate]', error.code || '', error.message);
  process.exitCode = 1;
}
finally{
  await closePool();
}
