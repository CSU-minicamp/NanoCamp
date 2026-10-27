import {migrateForum} from '../backend/forum/index.mjs';
import {closePool} from '../backend/db.mjs';
try { await migrateForum(); console.log('Forum schema ready (including post images and private messages).'); }
catch(error) { console.error('[forum:migrate]',error.message); process.exitCode=1; }
finally { await closePool(); }
