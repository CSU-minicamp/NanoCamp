import * as dm from './dm.mjs';
import {fail} from './forum.mjs';
export async function getDm(user,path,query){
 if(path==='/api/forum/message-summary')return dm.summary(user);
 if(path==='/api/forum/dm/recipients')return dm.recipients(user,query.q);
 if(path==='/api/forum/dm/conversations')return dm.conversations(user,query);
 if(path==='/api/forum/dm/reports')return dm.reports(user,query);
 const m=path.match(/^\/api\/forum\/dm\/conversations\/(\d+)\/messages$/);if(m)return dm.messages(user,m[1],query);
 fail('not_found',404);
}
export async function postDm(user,key,path,data){
 if(path==='/api/forum/dm/conversations')return dm.send(user,key,null,data);
 if(path==='/api/forum/dm/reports')return dm.report(user,key,data);
 let m=path.match(/^\/api\/forum\/dm\/conversations\/(\d+)\/(messages|read|hide|block|unblock)$/);
 if(m)return m[2]==='messages'?dm.send(user,key,m[1],data):dm.act(user,key,m[1],m[2],data);
 m=path.match(/^\/api\/forum\/dm\/reports\/(\d+)\/withdraw$/);if(m)return dm.withdrawReport(user,key,m[1]);
 fail('not_found',404);
}
