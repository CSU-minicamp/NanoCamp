// 部署时的建表入口：全部 DDL 在 backend/schema.mjs，每次把全部语句跑一遍（全幂等，无版本表）。
// 用有 DDL 权限的账号跑，配置取自目标实例自己的 data/config.json。
import {migrateSchema} from '../backend/schema.mjs';
import {closePool} from '../backend/db.mjs';
import {dbConfig} from '../backend/config.mjs';

const config = dbConfig();
console.log(`Database sync target: ${config.host}:${config.port}/${config.database}`);
try{
  await migrateSchema();
  console.log('[db:sync] schema 已同步（幂等，无版本记录）');
}
catch(error){
  console.error('[db:sync]', error.code || '', error.message);
  process.exitCode = 1;
}
finally{
  await closePool();
}
