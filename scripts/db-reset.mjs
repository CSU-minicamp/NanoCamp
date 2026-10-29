// 重建库：把这个库里的表全删掉，再按 backend/schema.mjs 建回来。
//
//   npm run db:reset -- --yes
//
// ⚠️ 会清空数据，只该在本地/测试库用。b 版没有线上库，改字段的流程就是：
//   改 backend/schema.mjs → npm run db:reset -- --yes → 重新播种需要的测试数据
import {transaction, select, closePool, dbReady} from '../backend/db.mjs';
import {migrateSchema, tableNames} from '../backend/schema.mjs';
import {dbConfig} from '../backend/config.mjs';

if(!dbReady()){
  console.error('data/config.json 里没有 db.database —— 先配好数据库连接。');
  process.exit(1);
}
if(!process.argv.includes('--yes')){
  console.error('这会删掉库里所有表（不可恢复）。确认请加 --yes：');
  console.error('  npm run db:reset -- --yes');
  process.exit(1);
}

const config = dbConfig();
console.log(`目标：${config.user}@${config.host}:${config.port}/${config.database}`);

// 连库里已有的表一起删（不是只看 schema.mjs 里的清单）：重建的意义就是「只剩文件里那一套」。
const rows = await select("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
const stale = rows.map(row => row.name);
if(stale.length){
  await transaction(async c => {
    // 外键会让删除顺序变成一道难题，直接关掉检查；连接是同一条，finally 里记得开回来。
    await c.query('SET FOREIGN_KEY_CHECKS=0');
    try{
      for(const name of stale)await c.query(`DROP TABLE IF EXISTS \`${name}\``);
    }
    finally{
      await c.query('SET FOREIGN_KEY_CHECKS=1');
    }
  });
  console.log(`已删除 ${stale.length} 张表`);
}

const applied = await migrateSchema();
console.log(`已完成：${applied.join('、')}（${tableNames.length} 张表）`);

await closePool();
