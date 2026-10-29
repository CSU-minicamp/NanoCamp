// 建表（幂等，可反复执行）。DDL 全在 backend/schema.mjs，这里只是入口。
//
// 应用账号按设计只有 DML 权限，所以建表通常要由有 DDL 权限的账号执行：
//   node scripts/migrate.mjs                                  # 用 data/config.json 里的账号试一次
//   node scripts/migrate.mjs --print | sudo mysql 'Nanocamp-test'   # 没有 DDL 权限时走这条
import {dbReady, closePool} from '../backend/db.mjs';
import {migrateSchema, schemaStatements, migrationsTable} from '../backend/schema.mjs';
import {dbConfig} from '../backend/config.mjs';

if(!dbReady()){
  console.error('data/config.json 里没有 db.database —— 先配好数据库连接。');
  process.exit(1);
}

const config = dbConfig();

// --print：只把 DDL 打到 stdout，方便管道给 `sudo mysql <库名>` 执行。
// 开头带 SET NAMES utf8mb4：mysql 客户端在 Windows / 部分发行版默认 latin1，
// 中文列注释会被当成 latin1 存进去、永久变成乱码。
if(process.argv.includes('--print')){
  console.log('SET NAMES utf8mb4;\n');
  console.log([migrationsTable, ...schemaStatements].map(statement => `${statement};`).join('\n\n'));
  process.exit(0);
}

console.log(`目标：${config.user}@${config.host}:${config.port}/${config.database}`);
try{
  const applied = await migrateSchema();
  console.log(applied.length? `完成：执行了 ${applied.join('、')}（共 ${schemaStatements.length} 张表）`: '完成：已经是最新版本，没有需要执行的段');
}
catch(error){
  console.error(`建表失败：${error.message}`);
  if(['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_ERROR'].includes(error.code)){
    console.error('应用账号没有 DDL 权限 —— 这是设计如此。改用：');
    console.error(`  node scripts/migrate.mjs --print | sudo mysql '${config.database}'`);
  }
  process.exitCode = 1;
}
finally{
  await closePool();
}
