import {migrateAvatars} from '../backend/avatar.mjs';
import {closePool} from '../backend/db.mjs';
try{await migrateAvatars();console.log('Avatar schema ready (mysql storage).');}
catch(error){console.error('[avatar:migrate]',error.code||'',error.message);process.exitCode=1;}
finally{await closePool();}
