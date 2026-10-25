import {parseCookies,sameOrigin} from './api.mjs';
import {readSession,missingFields,authAvailable} from './auth.mjs';
import {isUnavailable,dbReady} from './db.mjs';
import {AvatarError,avatarMetadata,avatarResult,replaceAvatar,removeAvatar,readAvatar,DEFAULT_AVATAR_URL} from './avatar.mjs';
const json=(status,data)=>({status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'},body:Buffer.from(JSON.stringify(data))});
export async function handleAvatarApi({method,pathname,headers,body}){
  try{
    if(!dbReady())return json(503,{error:'avatar_unavailable'});
    const publicMatch=pathname.match(/^\/api\/users\/([1-9]\d{0,14})\/avatar$/);
    if(publicMatch){
      if(!['GET','HEAD'].includes(method))return {...json(405,{error:'method_not_allowed'}),headers:{...json(405,{}).headers,allow:'GET, HEAD'}};
      const image=await readAvatar(publicMatch[1]);
      if(!image)return {status:302,headers:{location:DEFAULT_AVATAR_URL,'cache-control':'no-store'},body:Buffer.alloc(0)};
      const etag=`"${image.meta.etag}"`,responseHeaders={'content-type':image.meta.content_type,'cache-control':'public, no-cache','x-content-type-options':'nosniff','content-disposition':'inline',etag};
      if(headers['if-none-match']?.split(',').map(v=>v.trim()).includes(etag))return {status:304,headers:responseHeaders,body:Buffer.alloc(0)};
      return {status:200,headers:{...responseHeaders,'content-length':String(image.bytes.length)},body:method==='HEAD'?Buffer.alloc(0):image.bytes};
    }
    if(pathname!=='/api/profile/avatar')return json(404,{error:'not_found'});
    if(!authAvailable())return json(503,{error:'avatar_unavailable'});
    if(!['GET','PUT','DELETE'].includes(method))return { ...json(405,{error:'method_not_allowed'}),headers:{...json(405,{}).headers,allow:'GET, PUT, DELETE'}};
    const cookies=parseCookies(headers.cookie),session=await readSession(cookies.nc_sid);
    if(!session)return json(401,{error:'unauthenticated'});
    if(method==='GET')return json(200,avatarResult(session.user.id,await avatarMetadata(session.user.id)));
    if(!sameOrigin(headers)||!cookies.nc_csrf||headers['x-nc-csrf']!==cookies.nc_csrf)return json(403,{error:'csrf_invalid'});
    if(missingFields(session.user).length)return json(403,{error:'profile_incomplete'});
    return json(200,method==='PUT'?await replaceAvatar(session.user.id,body,headers['content-type']):await removeAvatar(session.user.id));
  }catch(error){
    if(error instanceof AvatarError)return json(error.status,{error:error.code});
    console.error('[avatar:api]',method,pathname,error.code||'',error.message);
    return json(isUnavailable(error)||error.code==='ER_NO_SUCH_TABLE'?503:500,{error:'avatar_unavailable'});
  }
}
