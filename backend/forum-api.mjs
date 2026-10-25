import {parseCookies,sameOrigin} from './api.mjs';
import {readSession} from './auth.mjs';
import {isUnavailable,dbReady} from './db.mjs';
import * as forum from './forum.mjs';
import {renderMarkdown} from './forum-markdown.mjs';
import {uploadForumImage,readForumImage} from './forum-images.mjs';
import {getDm,postDm} from './dm-api.mjs';

const response=(status,data)=>({status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'},body:Buffer.from(JSON.stringify(data))});
export async function handleForumApi({method,url,headers={},body}){
  try {
    if(!dbReady())return response(503,{error:'unavailable'});
    const path=new URL(url,'http://localhost').pathname.replace(/\/$/,''),query=Object.fromEntries(new URL(url,'http://localhost').searchParams);
    const cookies=parseCookies(headers.cookie);
    const session=cookies.nc_sid?await readSession(cookies.nc_sid):null,user=session?.user||null;
    const imageMatch=path.match(/^\/api\/forum\/images\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/);
    if(imageMatch&&['GET','HEAD'].includes(method)){
      const image=await readForumImage(imageMatch[1],user?.id),etag=`"${image.meta.etag}"`;
      const imageHeaders={'content-type':image.meta.content_type,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-disposition':'inline',etag};
      if(headers['if-none-match']===etag)return {status:304,headers:imageHeaders,body:Buffer.alloc(0)};
      return {status:200,headers:{...imageHeaders,'content-length':String(image.bytes.length)},body:method==='HEAD'?Buffer.alloc(0):image.bytes};
    }
    if(method==='GET'){
      if(path.startsWith('/api/forum/dm/')||path==='/api/forum/message-summary')return response(200,await getDm(user,path,query));
      if(path==='/api/forum/topics')return response(200,await forum.listTopics(query,user?.id));
      if(path.match(/^\/api\/forum\/topics\/\d+$/))return response(200,await forum.getTopic(path.split('/').at(-1),user?.id,query.page,{target:query.reply}));
      if(path==='/api/forum/me'){if(!user)forum.fail('unauthenticated',401);return response(200,await forum.myContent(user.id,query.tab,query.page));}
      if(path==='/api/forum/notifications'){if(!user)forum.fail('unauthenticated',401);return response(200,await forum.notifications(user.id,query.filter,query.page));}
      const author=path.match(/^\/api\/forum\/users\/(\d+)$/);if(author)return response(200,await forum.publicUser(author[1],user?.id));
      return response(404,{error:'not_found'});
    }
    if(method!=='POST')return response(405,{error:'method_not_allowed'});
    if(!sameOrigin(headers)||!cookies.nc_csrf||headers['x-nc-csrf']!==cookies.nc_csrf)return response(403,{error:'csrf_invalid'});
    if(!user)forum.fail('unauthenticated',401);
    if(path==='/api/forum/images')return response(201,await uploadForumImage(user,headers['idempotency-key'],body,headers['content-type']));
    const raw=Buffer.isBuffer(body)?body.toString():String(body||'');if(Buffer.byteLength(raw)>64*1024)return response(413,{error:'request_too_large'});
    let data;try{data=JSON.parse(raw);}catch{return response(400,{error:'invalid_json'});}
    if(!data||typeof data!=='object'||Array.isArray(data))return response(400,{error:'invalid_json'});
    const key=headers['idempotency-key'];
    if(path.startsWith('/api/forum/dm/'))return response(200,await postDm(user,key,path,data));
    if(path==='/api/forum/preview'&&method==='POST')return response(200,{html:renderMarkdown(String(data.body||'').slice(0,15000),{images:data.images===true})});
    if(path==='/api/forum/topics'&&method==='POST')return response(200,await forum.createTopic(user,key,data));
    let m=path.match(/^\/api\/forum\/(topics|replies)\/(\d+)(?:\/(vote|withdraw|bookmark|replies))?$/);
    if(m){const kind=m[1]==='topics'?'topic':'reply',id=m[2],action=m[3];
      if(method==='POST'){
        if(action==='vote')return response(200,await forum.vote(user,key,kind,id,data.value));
        if(action==='withdraw')return response(200,await forum.withdrawContent(user,key,kind,id));
        if(kind==='topic'&&action==='bookmark')return response(200,await forum.bookmark(user,key,id,data.enabled));
        if(kind==='topic'&&action==='replies')return response(200,await forum.createReply(user,key,id,data));
      }
    }
    m=path.match(/^\/api\/forum\/users\/(\d+)\/follow$/);
    if(m&&method==='POST')return response(200,await forum.follow(user,key,m[1],data.enabled));
    if(path==='/api/forum/reports'&&method==='POST')return response(200,await forum.report(user,key,data));
    m=path.match(/^\/api\/forum\/reports\/(\d+)\/withdraw$/);
    if(m&&method==='POST')return response(200,await forum.withdrawReport(user,key,m[1]));
    if(path==='/api/forum/notifications/read'&&method==='POST')return response(200,await forum.markRead(user,key,data.ids,data.filter));
    return response(404,{error:'not_found'});
  }catch(error){
    if(error instanceof forum.ForumError){const result=response(error.status,{error:error.code,...(error.retryAfter?{retry_after:error.retryAfter}:{})});if(error.retryAfter)result.headers['retry-after']=String(error.retryAfter);return result;}
    console.error('[forum:api]',method,url,error.code||'',error.message);
    return response(isUnavailable(error)||error.code==='ER_NO_SUCH_TABLE'?503:500,{error:isUnavailable(error)||error.code==='ER_NO_SUCH_TABLE'?'unavailable':'internal_error'});
  }
}
