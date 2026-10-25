// Deployment entrypoint: base account tables, avatar storage, then forum/messages.
// Run with a DDL-capable account using the target instance's local config.
import {migrate,closePool} from '../backend/db.mjs';
import {migrateAvatars} from '../backend/avatar.mjs';
import {migrateForum} from '../backend/forum-schema.mjs';
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
