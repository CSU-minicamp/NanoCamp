import {cleanupDraftImages} from '../backend/forum/images.mjs';
import {closePool} from '../backend/db.mjs';
try{const count=await cleanupDraftImages(process.argv[2]);console.log(`Removed ${count} expired, unpublished forum images.`);}
catch(error){console.error('[forum:image:cleanup]',error.code||'',error.message);process.exitCode=1;}
finally{await closePool();}
