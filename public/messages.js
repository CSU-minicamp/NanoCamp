(() => {
 const root=document.querySelector('[data-dm-center]'),reports=document.querySelector('[data-dm-reports]');if(!root&&!reports)return;
 const user=Number(root?.dataset.user||document.querySelector('[data-user-id]')?.dataset.userId),peer=Number(root?.dataset.peer),status=document.querySelector('[data-dm-status]');
 let conversation=Number(root?.dataset.conversation),disposed=false;
 const messages={unauthenticated:'登录状态已过期，请重新登录。',profile_incomplete:'请先完善昵称和密码。',posting_suspended:'当前账号暂时不能发送消息。',cannot_message:'暂时无法向该用户发送消息。',messaging_disabled:'私信暂时不可用。',invalid_content:'请输入 1–2000 字的消息。',rate_limited:'操作较频繁，请稍后重试。',csrf_invalid:'页面状态已变化，请刷新后重试。',request_conflict:'请求内容已变化，请重新发送。',not_found:'会话不存在或无权访问。',report_in_progress:'举报已开始处理，不能撤回。'};
 async function api(path,data,key=crypto.randomUUID()){
  const headers={};if(data){const csrf=document.cookie.split('; ').find(x=>x.startsWith('nc_csrf='))?.slice(8);Object.assign(headers,{'content-type':'application/json','x-nc-csrf':csrf||'','idempotency-key':key});}
  const response=await fetch('/api/forum/'+path,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!response.ok){if(result.error==='unauthenticated'||result.error==='profile_incomplete')location.assign((result.error==='unauthenticated'?'/login/':'/profile/force/')+'?next='+encodeURIComponent(location.pathname+location.search));const error=new Error(messages[result.error]||'暂时无法完成，请重试。');error.code=result.error;throw error;}return result;
 }
 const notify=()=>window.dispatchEvent(new Event('forum-notifications-changed'));
 const show=error=>{if(status)status.textContent=error.message;console.warn('[dm]',conversation||'list',error.code||error.name);};
 document.addEventListener('click',async event=>{const button=event.target.closest('[data-dm-withdraw-report]');if(!button||button.disabled)return;button.disabled=true;try{await api('dm/reports/'+button.dataset.dmWithdrawReport+'/withdraw',{});location.reload();}catch(error){show(error);button.disabled=false;}});
 if(!root)return;
 const list=root.querySelector('[data-dm-conversations]'),history=root.querySelector('[data-dm-history]'),items=root.querySelector('[data-dm-messages]'),form=root.querySelector('[data-dm-compose]'),body=form?.elements.body;
 let firstSeq=Number(items?.firstElementChild?.dataset.messageSeq||0),lastSeq=Number(items?.lastElementChild?.dataset.messageSeq||0),readSeq=0,busy=false,listBusy=false,readBusy=false,failures=0,timer,cycle=0;
 const draftKey='nc-dm-draft:'+user+':'+peer,pendingKey='nc-dm-pending:'+user+':'+peer,scrollKey='nc-dm-list-scroll:'+user;
 const nearBottom=()=>history&&history.scrollHeight-history.scrollTop-history.clientHeight<65;
 const bottom=()=>{if(history)history.scrollTop=history.scrollHeight;const hint=root.querySelector('[data-dm-new]');if(hint)hint.hidden=true;};
 const date=value=>new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}).format(new Date(value));
 function addMessage(m,prepend=false){
  let row=items.querySelector(`[data-message-id="${m.id}"]`)||[...items.children].find(n=>n.dataset.clientId===m.client_message_id);
  for(const duplicate of [...items.children])if(duplicate!==row&&duplicate.dataset.clientId===m.client_message_id)duplicate.remove();
  if(Number(m.sender_id)===user){try{const pending=JSON.parse(localStorage.getItem(pendingKey)||'null');if(pending?.key===m.client_message_id){localStorage.removeItem(pendingKey);if(body?.value.trim()===pending.body){body.value='';localStorage.removeItem(draftKey);}}}catch(error){console.warn('[dm:pending:reconcile]',error.name);}}
  if(row){row.classList.remove('is-failed');row.dataset.messageId=m.id;row.dataset.messageSeq=m.seq;row.querySelector('.dm-bubble').textContent=m.body;row.querySelector('.dm-bubble-meta').replaceChildren();}
  else{row=document.createElement('article');row.className='dm-bubble-row'+(Number(m.sender_id)===user?' is-mine':'');row.dataset.messageId=m.id;row.dataset.messageSeq=m.seq;row.dataset.clientId=m.client_message_id;const bubble=document.createElement('div');bubble.className='dm-bubble';bubble.textContent=m.body;const meta=document.createElement('div');meta.className='dm-bubble-meta';row.append(bubble,meta);prepend?items.prepend(row):items.append(row);}
  const time=document.createElement('time');time.textContent=date(m.created_at);row.querySelector('.dm-bubble-meta').append(time);
  if(Number(m.sender_id)!==user){const report=document.createElement('button');report.type='button';report.dataset.dmReport=m.id;report.textContent='举报';row.querySelector('.dm-bubble-meta').append(report);}
  if(m.seq){lastSeq=Math.max(lastSeq,Number(m.seq));firstSeq=firstSeq?Math.min(firstSeq,Number(m.seq)):Number(m.seq);}root.querySelector('[data-dm-empty]').hidden=true;return row;
 }
 function state(data){
  const d=data.conversation;if(!d)return;
  if(form){body.disabled=!d.can_send;form.querySelector('[type=submit]').disabled=!d.can_send;form.querySelector('[data-dm-send-status]').textContent=!data.enabled?messages.messaging_disabled:d.blocked||d.restricted?messages.cannot_message:'';}
  const block=root.querySelector('[data-dm-block]');if(block){block.dataset.dmAction=d.blocked_by_me?'unblock':'block';block.textContent=d.blocked_by_me?'解除屏蔽':'屏蔽用户';}readSeq=Math.max(readSeq,Number(d.last_read_seq));
 }
 async function markRead(){
  if(!history||document.hidden||readBusy||!conversation)return;
  const rect=history.getBoundingClientRect(),visible=[...items.children].filter(n=>n.dataset.messageSeq&&n.getBoundingClientRect().top>=rect.top&&n.getBoundingClientRect().bottom<=rect.bottom);
  // 读历史时不能跳过没看过的较新消息：已读位置只按可见范围的最后一条往前推。
  const seq=Math.max(0,...visible.map(n=>Number(n.dataset.messageSeq)));if(seq<=readSeq)return;
  readBusy=true;try{await api(`dm/conversations/${conversation}/read`,{last_visible_seq:seq});readSeq=seq;notify();await refreshList();}catch(error){show(error);}finally{readBusy=false;}
 }
 async function poll(){
  if(disposed||document.hidden||busy){schedule();return;}busy=true;
  try{
   if(conversation&&history){
    const stick=nearBottom(),data=await api(`dm/conversations/${conversation}/messages${lastSeq?'?after_seq='+lastSeq:''}`);state(data);data.items.forEach(m=>addMessage(m));
    if(++cycle%3===0){const latest=await api(`dm/conversations/${conversation}/messages`);latest.items.filter(m=>items.querySelector(`[data-message-id="${m.id}"]`)).forEach(m=>addMessage(m));}
    if(data.items.length){if(stick)bottom();else root.querySelector('[data-dm-new]').hidden=false;notify();}
    await markRead();
   }
   if(!conversation||cycle%3===0)await refreshList();failures=0;if(status)status.textContent='';
  }catch(error){failures++;show(error);}finally{busy=false;schedule();}
 }
 function schedule(){clearTimeout(timer);if(!disposed&&!document.hidden)timer=setTimeout(poll,failures?Math.min(15000,2000*2**Math.min(failures-1,3)):conversation?2000:5000);}
 function listRow(d){
  const a=document.createElement('a');a.className='dm-conversation'+(Number(d.id)===conversation?' is-current':'');a.href='/forum/messages/conversations/'+d.id+'/';a.dataset.conversationId=d.id;
  const avatar=document.createElement('span');avatar.className='f-avatar';const img=document.createElement('img');img.className='account-avatar-image';img.src='/api/users/'+d.peer_id+'/avatar';img.alt='';avatar.append(img);
  const copy=document.createElement('span');copy.className='dm-conversation-copy';const name=document.createElement('strong');name.textContent=d.nickname;const preview=document.createElement('span');preview.textContent=d.preview;copy.append(name,preview);
  const meta=document.createElement('span');meta.className='dm-conversation-meta';const time=document.createElement('time');time.textContent=date(d.last_message_at);meta.append(time);if(Number(d.unread)){const badge=document.createElement('b');badge.textContent=d.unread>99?'99+':d.unread;meta.append(badge);}a.append(avatar,copy,meta);return a;
 }
 async function refreshList(cursor=''){
  if(listBusy)return;listBusy=true;try{
   const data=await api('dm/conversations'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
   const ids=new Set(data.items.map(d=>String(d.id)));if(!cursor){for(const node of [...list.children])if(!list.dataset.extended||!node.dataset.conversationId||ids.has(node.dataset.conversationId))node.remove();data.items.slice().reverse().forEach(d=>list.prepend(listRow(d)));}else data.items.forEach(d=>{list.querySelector(`[data-conversation-id="${d.id}"]`)?.remove();list.append(listRow(d));});
   const more=root.querySelector('[data-dm-more-list]');if(cursor||!list.dataset.extended){more.hidden=!data.next_cursor;more.dataset.cursor=data.next_cursor||'';}if(cursor)list.dataset.extended='1';
   if(!data.items.length&&!cursor){list.replaceChildren();const empty=document.createElement('div');empty.className='dm-empty';empty.textContent='暂无消息';list.append(empty);}notify();return data;
  }finally{listBusy=false;}
 }
 root.querySelector('[data-dm-more-list]')?.addEventListener('click',async event=>{event.target.disabled=true;try{await refreshList(event.target.dataset.cursor);}catch(error){show(error);}finally{event.target.disabled=false;}});
 root.querySelector('[data-dm-history-more]')?.addEventListener('click',async event=>{const button=event.target;button.disabled=true;try{const height=history.scrollHeight,scroll=history.scrollTop,data=await api(`dm/conversations/${conversation}/messages?before_seq=${firstSeq}`);data.items.slice().reverse().forEach(m=>addMessage(m,true));button.hidden=!data.has_more;history.scrollTop=scroll+history.scrollHeight-height;}catch(error){show(error);}finally{button.disabled=false;}});
 root.querySelector('[data-dm-new]')?.addEventListener('click',()=>{bottom();markRead();});
 history?.addEventListener('scroll',()=>{markRead();if(nearBottom())root.querySelector('[data-dm-new]').hidden=true;},{passive:true});
 if(body){
  try{body.value=localStorage.getItem(draftKey)||'';}catch(error){console.warn('[dm:draft:read]',error.name);}
  body.addEventListener('input',()=>{try{body.value?localStorage.setItem(draftKey,body.value):localStorage.removeItem(draftKey);}catch(error){console.warn('[dm:draft:write]',error.name);}});
  body.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229&&!body.disabled){event.preventDefault();form.requestSubmit();}});
  form.addEventListener('submit',async event=>{event.preventDefault();if(form.dataset.sending||body.disabled||!body.value.trim())return;const text=body.value.trim();if(Array.from(text).length>2000){form.querySelector('[data-dm-send-status]').textContent=messages.invalid_content;return;}let key=crypto.randomUUID();try{const pending=JSON.parse(localStorage.getItem(pendingKey)||'null');if(pending?.body===text&&/^[\w-]{8,80}$/.test(pending.key))key=pending.key;}catch(error){console.warn('[dm:pending:read]',error.name);}await send(text,key);});
 }
 async function send(text,key,row){
  let committed=false;
  try{localStorage.setItem(pendingKey,JSON.stringify({body:text,key}));}catch(error){console.warn('[dm:pending:write]',error.name);}
  form.dataset.sending='1';form.querySelector('[type=submit]').disabled=true;
  if(!row){row=document.createElement('article');row.className='dm-bubble-row is-mine';row.dataset.clientId=key;const bubble=document.createElement('div');bubble.className='dm-bubble';bubble.textContent=text;const meta=document.createElement('div');meta.className='dm-bubble-meta';meta.textContent='发送中';row.append(bubble,meta);items.append(row);root.querySelector('[data-dm-empty]').hidden=true;bottom();}
  try{
   const data=await api(conversation?`dm/conversations/${conversation}/messages`:'dm/conversations',{body:text,client_message_id:key,...(!conversation?{to_user_id:peer}:{})},key);
   committed=true;
   try{localStorage.removeItem(pendingKey);}catch(error){console.warn('[dm:pending:clear]',error.name);}
   if(body.value.trim()===text){body.value='';try{localStorage.removeItem(draftKey);}catch(error){console.warn('[dm:draft:clear]',error.name);}}
   if(!conversation){location.replace('/forum/messages/conversations/'+data.conversation_id+'/');return;}
   addMessage(data);bottom();notify();const snapshot=await api(`dm/conversations/${conversation}/messages?after_seq=${lastSeq}`);state(snapshot);snapshot.items.forEach(m=>addMessage(m));await refreshList();
  }catch(error){
   if(committed){show(new Error('消息已发送，列表暂时无法更新。'));return;}
   row.classList.add('is-failed');const meta=row.querySelector('.dm-bubble-meta');meta.replaceChildren();const textNode=document.createElement('span');textNode.textContent='发送失败';const retry=document.createElement('button');retry.type='button';retry.textContent='重试';retry.addEventListener('click',()=>{if(!form.dataset.sending)send(text,key,row);});meta.append(textNode,retry);form.querySelector('[data-dm-send-status]').textContent=error.message;show(error);
  }finally{delete form.dataset.sending;if(!body.disabled)form.querySelector('[type=submit]').disabled=false;}
 }
 root.addEventListener('click',async event=>{
  const action=event.target.closest('[data-dm-action]');if(action&&!action.disabled){
   if(action.dataset.dmAction==='block'&&!confirm('屏蔽后将停止双方的私信，已有消息仍保留。'))return;
   action.disabled=true;try{await api(`dm/conversations/${conversation}/${action.dataset.dmAction}`,{});notify();if(action.dataset.dmAction==='hide')location.assign('/forum/messages/');else{state(await api(`dm/conversations/${conversation}/messages`));await refreshList();action.closest('details')?.removeAttribute('open');}}catch(error){show(error);}finally{action.disabled=false;}
  }
  const report=event.target.closest('[data-dm-report]');if(report){const dialog=root.querySelector('[data-dm-report-dialog]');dialog.querySelector('form').dataset.message=report.dataset.dmReport;dialog.showModal();}
  if(event.target.closest('[data-dm-close]'))root.querySelector('[data-dm-report-dialog]').close();
 });
 root.querySelector('[data-dm-report-form]').addEventListener('submit',async event=>{event.preventDefault();const f=event.target,button=f.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;try{await api('dm/reports',{message_id:f.dataset.message,reason:f.elements.reason.value,details:f.elements.details.value});f.closest('dialog').close();if(status)status.textContent='举报已提交';}catch(error){f.querySelector('[data-dm-report-status]').textContent=error.message;}finally{button.disabled=false;}});
 const person=root.querySelector('[data-dm-person]');let searchTimer,revision=0;
 person?.addEventListener('input',()=>{clearTimeout(searchTimer);const current=++revision;searchTimer=setTimeout(async()=>{try{const data=await api('dm/recipients?q='+encodeURIComponent(person.value)),people=root.querySelector('[data-dm-people]');if(current!==revision)return;people.replaceChildren();for(const p of data.items){const row=document.createElement('div');row.className='dm-person-row';const link=document.createElement('a');link.href='/forum/messages/new/?to='+p.id;link.textContent=p.nickname;const profile=document.createElement('a');profile.href='/forum/users/'+p.id+'/';profile.textContent='查看主页';const avatar=document.createElement('span');avatar.className='f-avatar';const img=document.createElement('img');img.className='account-avatar-image';img.src='/api/users/'+p.id+'/avatar';img.alt='';avatar.append(img);row.append(avatar,link,profile);people.append(row);}if(person.value.trim()&&!data.items.length)people.textContent='没有匹配的用户';}catch(error){show(error);}},200);});
 try{root.querySelector('.dm-inbox').scrollTop=Number(sessionStorage.getItem(scrollKey)||0);}catch(error){console.warn('[dm:scroll]',error.name);}
 window.addEventListener('pagehide',()=>{disposed=true;clearTimeout(timer);try{sessionStorage.setItem(scrollKey,String(root.querySelector('.dm-inbox').scrollTop));}catch(error){console.warn('[dm:scroll]',error.name);}});
 const resize=()=>{root.style.setProperty('--dm-viewport-height',(window.visualViewport?.height||innerHeight)+'px');};resize();window.visualViewport?.addEventListener('resize',resize);
 document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden)poll();});window.addEventListener('pageshow',()=>{disposed=false;schedule();});
 if(history){bottom();requestAnimationFrame(markRead);}schedule();
})();
