import {parseCookies} from './api.mjs';
import {readSession,missingFields} from './auth.mjs';
import {isUnavailable,dbReady} from './db.mjs';
import * as forum from './forum.mjs';
import {forumDocument,forumIndex,topicDetail,composePage,authorPage,personalPage,messagePage,personalTabs,personalAccountPage} from '../src/forum.mjs';
import * as dm from './dm.mjs';
import {messageCenter,dmReportPage} from '../src/messages.mjs';
const redirect=href=>({status:303,headers:{location:href,'cache-control':'no-store'},body:Buffer.alloc(0)});
export async function handleForumPage({url,headers}){
  const target=new URL(url,'http://localhost');let path=target.pathname;
  if(!path.endsWith('/'))return redirect(path+'/'+target.search);
  try {
    if(!dbReady())forum.fail('unavailable',503);
    const token=parseCookies(headers.cookie).nc_sid;
    const session=token?await readSession(token):null,user=session?.user||null;
    const params=Object.fromEntries(target.searchParams);
    const forumView=['topics','replies','following','bookmarks'].includes(params.view)?params.view:'';
    const privatePage=path.startsWith('/forum/messages/')||path==='/forum/new/'||path==='/forum/me/'||path==='/forum/notifications/'||params.feed==='following'||path==='/forum/'&&Boolean(forumView);
    if(privatePage&&!user)return redirect('/login/?next='+encodeURIComponent(path+target.search));
    if(path==='/forum/new/'&&missingFields(user).length)return redirect('/profile/force/?next='+encodeURIComponent(path+target.search));
    let body,title='社区论坛',topicId=0;
    if(path.startsWith('/forum/messages/')){
      title='消息';
      const match=path.match(/^\/forum\/messages\/conversations\/(\d+)\/$/);
      if(path==='/forum/messages/'&&['activity','system'].includes(params.tab)){const filter=params.tab==='system'?'system':['replies','social'].includes(params.filter)?params.filter:'activity';body=messagePage(await forum.notifications(user.id,filter,params.page),filter,user,url);}
      else if(path==='/forum/messages/'||path==='/forum/messages/new/'||match){
        if(path.endsWith('/new/')&&missingFields(user).length)return redirect('/profile/force/?next='+encodeURIComponent(path+target.search));
        let chat=match?await dm.messages(user,match[1]):null,peer=null;
        if(path==='/forum/messages/new/'&&params.to){const target=await dm.recipient(user,params.to);if(target.conversation_id)return redirect('/forum/messages/conversations/'+target.conversation_id+'/');peer=target.peer;}
        body=messageCenter({user,list:await dm.conversations(user),chat,peer,select:path==='/forum/messages/new/'});
      }else forum.fail('not_found',404);
    }else if(path==='/forum/')body=forumIndex(forumView?await forum.myContent(user.id,forumView,params.page):await forum.listTopics(params,user?.id),{...params,view:forumView},user,url);
    else if(path==='/forum/new/'){body=composePage();title='发起讨论';}
    else if(path==='/forum/me/'){
      const tab=params.tab==='security'?'security':personalTabs.some(t=>t[0]===params.tab)?params.tab:'profile';
      if(['topics','replies','following','bookmarks'].includes(tab)){
        const next=new URL('/forum/','http://localhost');next.searchParams.set('view',tab);
        if(params.page)next.searchParams.set('page',params.page);if(params.fragment==='1')next.searchParams.set('fragment','1');
        return redirect(next.pathname+next.search);
      }
      body=tab==='reports'&&params.kind==='dm'?dmReportPage(await dm.reports(user,params),user):['profile','security'].includes(tab)?personalAccountPage(user,tab):personalPage(await forum.myContent(user.id,tab,params.page),tab,user,url);title='个人中心';
    }else if(path==='/forum/notifications/'){
      const filter=['all','replies','social','system'].includes(params.filter)?params.filter:'all';
      return redirect('/forum/messages/?tab='+(filter==='system'?'system':'activity')+(['replies','social'].includes(filter)?'&filter='+filter:'')+(params.page?'&page='+encodeURIComponent(params.page):''));
    }else if(path.match(/^\/forum\/replies\/\d+\/$/))return redirect(await forum.locateReply(path.split('/')[3]));
    else if(path.match(/^\/forum\/users\/\d+\/$/)){
      const id=forum.idOf(path.split('/')[3]),author=await forum.publicUser(id,user?.id);
      const tab=['topics','replies','following','fans'].includes(params.tab)?params.tab:'topics';
      let data;
      if(tab==='topics')data=await forum.listTopics({author:id,page:params.page},user?.id);
      else if(tab==='following'||tab==='fans')data=await forum.relations(id,tab,params.page);
      else {data=await forum.publicReplies(id,params.page,user?.id);}
      body=authorPage(author,data,tab,user,url);title=author.nickname+'的主页';
    }else if(path.match(/^\/forum\/topics\/\d+\/$/)){
      topicId=forum.idOf(path.split('/')[3]);const data=await forum.getTopic(topicId,user?.id,params.page,{target:params.reply});
      body=topicDetail(data,user,url);title=data.topic.title;
    }else forum.fail('not_found',404);
    if(params.fragment==='1'){
      if(!body.includes('data-stream-items'))forum.fail('not_found',404);
      return {status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'},body:Buffer.from(body)};
    }
    const html=forumDocument({body,title,user,route:path,topicId});
    return {status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'},body:Buffer.from(path==='/forum/me/'?html.replace('</head>','<script defer src="/account.js"></script></head>'):html)};
  }catch(error){
    const status=error instanceof forum.ForumError?error.status:isUnavailable(error)||error.code==='ER_NO_SUCH_TABLE'?503:500;
    if(status>=500)console.error('[forum:page]',path,error.code||'',error.message);
    const title=status===404?'内容不存在或已隐藏':status===403?'你没有权限访问':status===409?'内容状态已变化':status===503?'论坛暂时不可用':'页面暂时无法打开';
    return {status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'},body:Buffer.from(forumDocument({title,route:path,body:`<section class="f-empty"><h1>${title}</h1><a class="f-primary" href="/forum/">返回论坛</a></section>`}))};
  }
}
