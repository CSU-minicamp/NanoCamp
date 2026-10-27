// 部署时的建表入口：先账号基础表，再头像存储，最后论坛与私信。
// 用有 DDL 权限的账号跑，配置取自目标实例自己的 data/config.json。
import {migrate,closePool} from '../backend/db.mjs';
import {migrateAvatars} from '../backend/avatar/index.mjs';
import {migrateForum} from '../backend/forum/index.mjs';
import {dbConfig} from '../backend/config.mjs';
const config=dbConfig();
console.log(`Database sync target: ${config.host}:${config.port}/${config.database}`);
let stage='base';
try{
 await migrate();console.log('[db:sync] base ready');
 stage='avatars';await migrateAvatars();console.log('[db:sync] avatars ready');
 stage='forum';await migrateForum();console.log('[db:sync] forum and private messages ready');
}catch(error){console.error('[db:sync]',stage,error.code||'',error.message);process.exitCode=1;}
finally{await closePool();}
