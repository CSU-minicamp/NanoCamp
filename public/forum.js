(() => {
  const root=document.querySelector('[data-forum]');if(!root)return;
  const userId=Number(root.dataset.userId),topicId=Number(root.dataset.topicId);
  // 图片上限来自模板（源头是 common/forum.mjs），这里不写死数字。
  const imageMax=Number(root.dataset.imageMax)||0,imageMaxBytes=Number(root.dataset.imageMaxBytes)||0,imageMaxMb=Math.round(imageMaxBytes/1048576);
  const initialReply=location.hash.match(/^#reply-([1-9]\d{0,14})$/)?.[1];
  if(topicId&&initialReply&&!document.getElementById('reply-'+initialReply)&&!new URLSearchParams(location.search).has('reply')){
    location.replace('/forum/replies/'+initialReply+'/');return;
  }
  const imageMessages={image_too_large:`图片不能超过 ${imageMaxMb}MB。`,unsupported_image_type:'请选择 JPG、PNG 或 WebP 图片。',invalid_image:'图片无法读取，请选择完整的静态图片。',too_many_images:`每个帖子最多发布 ${imageMax} 张图片。`,invalid_image_reference:'图片不存在、已过期或不属于当前草稿，请重新上传。'};
  const messages={unauthenticated:'登录状态已过期，请重新登录。',profile_incomplete:'请先完善昵称和密码。',posting_suspended:'当前账号暂时不能参与互动。',posting_muted:'禁言期间不能发帖、回复或投票，其他功能照常。',csrf_invalid:'页面状态已变化，请刷新后重试。',invalid_content:'请检查字数：标题 4–80 字，正文 10–15000 字，回复 1–3000 字。',invalid_category:'请选择有效分类。',version_conflict:'内容已在其他页面修改。你的输入已保留，请复制后刷新再合并。',request_conflict:'请求内容已变化，请刷新页面重试。',idempotency_required:'请求标识缺失，请刷新后重试。',rate_limited:'操作较频繁，请稍后重试。',report_cooldown:'同一内容刚处理过举报，请在 24 小时后补充新依据。',invalid_reason:'请选择举报原因。',self_vote:'不能对自己的内容投票。',self_follow:'不能关注自己。',not_found:'内容不存在或已隐藏。',topic_closed:'讨论已撤回，不能继续回复。',content_unavailable:'内容状态已变化，请刷新查看。',report_in_progress:'举报已开始处理，不能撤回。',request_too_large:'内容过大，请适当缩短。',unavailable:'服务暂时不可用，你的输入已保留。'};
  let sessionPromise;
  const pendingKeys=new Map();
  function session(){return sessionPromise||(sessionPromise=fetch('/api/session',{cache:'no-store',credentials:'same-origin'}).then(async r=>{if(!r.ok)throw Error('会话暂时不可用');return r.json();}).catch(e=>{sessionPromise=null;throw e;}));}
  function login(){location.assign('/login/?next='+encodeURIComponent(location.pathname+location.search+location.hash));}
  async function api(path,data,method='POST'){
    const s=await session();if(!s.user){login();throw Error('请先登录。');}
    const signature=method+path+JSON.stringify(data);let key=pendingKeys.get(signature);if(!key){key=crypto.randomUUID();pendingKeys.set(signature,key);}
    let response;
    try{response=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','x-nc-csrf':s.csrf,'Idempotency-Key':key},body:JSON.stringify(data)});}catch{throw Error('网络连接失败，输入已保留，请重试。');}
    const result=await response.json();
    if(!response.ok){
      if(result.error==='unauthenticated'){sessionPromise=null;login();}
      if(result.error==='profile_incomplete'){location.assign('/profile/force/?next='+encodeURIComponent(location.pathname+location.search));}
      throw Error(imageMessages[result.error]||messages[result.error]||'操作失败，请稍后重试。');
    }
    pendingKeys.delete(signature);return result;
  }
  let statusTimer;
  function toast(message){const node=document.querySelector('[data-global-status]');node.textContent=message;clearTimeout(statusTimer);statusTimer=setTimeout(()=>node.textContent='',6500);}
  function errorIn(form,error){const node=form?.querySelector('[data-form-status]');if(node)node.textContent=error.message;else toast(error.message);}
  function closeDialog(dialog){dialog?.close();}
  // 相邻的纯图片段落并成一组，但不改动作者原本的正文顺序。
  function prepareImages(scope){
    scope.querySelectorAll('.f-prose p').forEach(paragraph=>{
      const content=[...paragraph.childNodes].filter(n=>n.nodeType!==3||n.textContent.trim());
      if(!content.some(n=>n.nodeName==='IMG')||content.some(n=>!['IMG','BR'].includes(n.nodeName)))return;
      let gallery=paragraph.previousElementSibling;
      if(!gallery?.classList.contains('f-image-gallery')){gallery=document.createElement('div');gallery.className='f-image-gallery';paragraph.before(gallery);}
      paragraph.querySelectorAll('img').forEach(img=>{
        const button=document.createElement('button');button.type='button';button.className='f-image-open';button.setAttribute('aria-label','查看大图');button.append(img);gallery.append(button);
      });paragraph.remove();
    });
  }
  prepareImages(root);
  let imageViewer,imageTrigger,imageOverflow;
  document.addEventListener('click',event=>{
    const img=event.target.closest('.f-post>.f-prose img,.f-compose .f-preview img');if(!img)return;
    event.preventDefault();
    if(!imageViewer){
      imageViewer=document.createElement('dialog');imageViewer.className='f-image-viewer';imageViewer.setAttribute('aria-label','查看大图');
      const close=document.createElement('button');close.type='button';close.className='f-image-close';close.setAttribute('aria-label','关闭大图');close.textContent='×';
      const large=document.createElement('img');imageViewer.append(close,large);document.body.append(imageViewer);
      imageViewer.addEventListener('click',()=>imageViewer.close());
      imageViewer.addEventListener('close',()=>{document.documentElement.style.overflow=imageOverflow;large.removeAttribute('src');imageTrigger?.focus({preventScroll:true});});
    }
    imageTrigger=img.closest('button')||img;imageOverflow=document.documentElement.style.overflow;
    const large=imageViewer.querySelector('img');large.src=img.currentSrc||img.src;large.alt=img.alt;
    document.documentElement.style.overflow='hidden';imageViewer.showModal();
  });
  // 新加载的每一批都留在文档流里；嵌套回复共用一层有上限的缩进。
  function arrangeReplies(container){
    const focused=container.contains(document.activeElement)?document.activeElement:null;
    const selection=focused?.matches('textarea')?[focused.selectionStart,focused.selectionEnd,focused.selectionDirection]:null;
    const replies=[...container.querySelectorAll('[data-reply-id]')].sort((a,b)=>Number(b.dataset.priority)-Number(a.dataset.priority)||(a.dataset.priority==='1'?Number(b.dataset.sequence)-Number(a.dataset.sequence):Number(a.dataset.sequence)-Number(b.dataset.sequence)));
    const byId=new Map(replies.map(node=>[node.dataset.replyId,node])),roots=new Map();
    for(const node of replies){
      const parent=byId.get(node.dataset.parentId),thread=parent?(roots.get(parent.dataset.replyId)||parent):node;
      roots.set(node.dataset.replyId,thread);
      const destination=thread===node?container:thread.querySelector(':scope > [data-reply-children]');
      if(destination)destination.append(node);
    }
    if(focused&&focused!==document.activeElement){focused.focus({preventScroll:true});if(selection)focused.setSelectionRange(...selection);}
  }
  document.querySelectorAll('[data-stream]').forEach(stream=>{
    const items=stream.querySelector('[data-stream-items]'),control=stream.querySelector('[data-stream-control]'),link=control.querySelector('[data-stream-next]'),status=control.querySelector('[data-stream-status]');
    let loading=false,failed=false;
    arrangeReplies(items);
    async function load(){
      if(loading||!control.dataset.next)return;
      loading=true;failed=false;control.setAttribute('aria-busy','true');link.hidden=true;status.textContent='正在加载…';
      try{
        const url=new URL(control.dataset.next,location.href);
        if(url.origin!==location.origin)throw Error('加载地址无效。');
        const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
        if(response.redirected&&new URL(response.url).pathname==='/login/'){login();return;}
        if(!response.ok)throw Error('加载失败，请重试。');
        const doc=new DOMParser().parseFromString(await response.text(),'text/html'),batch=doc.querySelector('[data-stream-items]'),next=doc.querySelector('[data-stream-control]');
        if(!batch||!next)throw Error('加载失败，请刷新后重试。');
        const seen=new Set([...items.querySelectorAll('[data-reply-id]')].map(n=>n.dataset.replyId));
        batch.querySelectorAll('[data-reply-id]').forEach(n=>{if(seen.has(n.dataset.replyId))n.remove();});
        const topics=new Set([...items.querySelectorAll('[data-topic-row-id]')].map(n=>n.dataset.topicRowId));
        batch.querySelectorAll('[data-topic-row-id]').forEach(n=>{if(topics.has(n.dataset.topicRowId))n.remove();});
        items.querySelector('.f-empty')?.remove();
        items.append(...batch.childNodes);arrangeReplies(items);
        control.dataset.next=next.dataset.next;
        if(next.dataset.next){const following=new URL(next.dataset.next,location.href);following.searchParams.delete('fragment');link.href=following.pathname+following.search;}else link.href='#';
        control.hidden=!next.dataset.next;status.textContent='';link.textContent='继续加载';
      }catch(error){failed=true;status.textContent=error.message;link.textContent='重试';console.warn('[forum:stream]',location.pathname,error.message);}
      finally{loading=false;link.hidden=false;control.removeAttribute('aria-busy');}
      if(!failed&&!control.hidden&&control.getBoundingClientRect().top<innerHeight+200)requestAnimationFrame(load);
    }
    link.addEventListener('click',event=>{event.preventDefault();load();});
    if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!failed)load();},{rootMargin:'240px 0px'});observer.observe(control);}
  });
  document.addEventListener('click',event=>{
    const link=event.target.closest('a.f-parent');if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    const id=link.getAttribute('href').match(/\/replies\/(\d+)\//)?.[1],target=id&&document.getElementById('reply-'+id);
    if(target){event.preventDefault();location.hash='reply-'+id;target.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}
  });
  document.querySelectorAll('.f-dialog').forEach(dialog=>{
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    dialog.querySelectorAll('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>dialog.close()));
  });

  // 草稿按「当前用户 + 这篇文章」存，换账号读不到别人的。
  document.querySelectorAll('[data-editor]').forEach(form=>{
    const body=form.elements.body,mode=form.dataset.editor;
    const key=`nc-forum-draft:${userId}:${mode}:${topicId}`;
    const state=form.querySelector('[data-draft-state]');
    function save(){
      try{
        const draft={body:body.value,title:form.elements.title?.value,category:form.elements.category?.value,parentId:form.dataset.parentId||'',parentName:form.dataset.parentName||'',version:form.dataset.version||'',at:Date.now()};
        localStorage.setItem(key,JSON.stringify(draft));state.textContent='草稿已保存在当前浏览器';
      }catch(error){state.textContent='当前浏览器无法保存草稿，请保留输入';console.warn('[forum:draft]',error.message);}
    }
    try {
      const raw=localStorage.getItem(key),draft=raw?JSON.parse(raw):null;
      if(draft&&Date.now()-draft.at<7*86400000){
        body.value=String(draft.body||'');if(form.elements.title)form.elements.title.value=String(draft.title||'');if(form.elements.category&&draft.category)form.elements.category.value=draft.category;form.dataset.parentId=draft.parentId||'';form.dataset.parentName=draft.parentName||'';renderReplyTarget(form);state.textContent='已恢复当前浏览器草稿';
      }
    }catch(error){console.warn('[forum:draft:restore]',error.message);}
    form.addEventListener('input',save);form.addEventListener('change',save);
    const imageInput=form.querySelector('[data-image-input]'),imageButton=form.querySelector('[data-upload-image]');
    if(imageInput){
      let uploading=false;
      async function uploadImages(files){
        const submit=form.querySelector('[type=submit]');if(uploading||submit.disabled||!files.length)return;
        try{
          const count=(body.value.match(/!\[[^\]]*\]\(\/api\/forum\/images\//g)||[]).length;
          if(count+files.length>imageMax)throw Error(imageMessages.too_many_images);
          for(const file of files){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error(imageMessages.unsupported_image_type);if(file.size>imageMaxBytes)throw Error(imageMessages.image_too_large);}
          uploading=true;submit.disabled=true;imageButton.disabled=true;imageInput.disabled=true;
          const status=form.querySelector('[data-form-status]');status.textContent='正在上传图片…';
          const s=await session();if(!s.user){login();return;}
          for(const file of files){
            const response=await fetch('/api/forum/images',{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type,'x-nc-csrf':s.csrf,'Idempotency-Key':crypto.randomUUID()},body:file});
            const result=await response.json();if(!response.ok)throw Error(imageMessages[result.error]||messages[result.error]||'图片上传失败，请重试。');
            body.setRangeText(`\n\n![图片](${result.url})\n\n`,body.selectionStart,body.selectionEnd,'end');
            body.dispatchEvent(new Event('input',{bubbles:true}));
          }
          status.textContent='';form.querySelector('[data-write]').click();
        }catch(error){console.warn('[forum:image:upload]',error.message);errorIn(form,error instanceof TypeError?Error('图片上传失败，请检查网络后重试。'):error);}finally{if(uploading){uploading=false;submit.disabled=false;imageButton.disabled=false;imageInput.disabled=false;}imageInput.value='';}
      }
      imageButton.addEventListener('click',()=>imageInput.click());
      imageInput.addEventListener('change',()=>uploadImages([...imageInput.files]));
      body.addEventListener('paste',event=>{const files=[...event.clipboardData.files];if(files.length){event.preventDefault();uploadImages(files);}});
      body.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();});
      body.addEventListener('drop',event=>{if(event.dataTransfer.files.length){event.preventDefault();uploadImages([...event.dataTransfer.files]);}});
    }
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(!form.reportValidity())return;
      const submit=form.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;save();
      form.querySelector('[data-form-status]').textContent='';
      try {
        let result;
        if(mode==='reply')result=await api(`/api/forum/topics/${topicId}/replies`,{body:body.value,parentId:form.dataset.parentId||null});
        else result=await api('/api/forum/topics',{title:form.elements.title.value,category:form.elements.category.value,body:body.value});
        try{localStorage.removeItem(key);}catch(error){console.warn('[forum:draft:clear]',error.message);}
        if(mode==='reply'){
          // 写入已经提交，草稿必须清掉 —— 即使随后取渲染结果失败也不能留。
          body.value='';state.textContent='';form.dataset.parentId='';form.dataset.parentName='';
          const preview=form.querySelector('[data-preview-body]');preview.replaceChildren();preview.hidden=true;body.hidden=false;
          form.querySelector('[data-write]').setAttribute('aria-pressed','true');form.querySelector('[data-preview]').setAttribute('aria-pressed','false');
          try{
            const response=await fetch(`/forum/topics/${topicId}/?fragment=1&reply=${result.id}`,{credentials:'same-origin',cache:'no-store'});
            if(!response.ok||response.redirected)throw Error('无法读取已发布的回复');
            const doc=new DOMParser().parseFromString(await response.text(),'text/html');
            const row=doc.getElementById('reply-'+result.id),items=document.querySelector('[data-stream-items]');
            if(!row||!items)throw Error('已发布的回复暂未显示');
            document.getElementById('reply-'+result.id)?.remove();items.querySelector('.f-empty')?.remove();
            items.append(row);renderReplyTarget(form);arrangeReplies(items);
            const heading=doc.querySelector('.f-replies-heading');if(heading)document.querySelector('.f-replies-heading').textContent=heading.textContent;
            const count=doc.querySelector('.f-post [data-reply-to=""]');const current=document.querySelector('.f-post [data-reply-to=""]');if(count&&current)current.replaceChildren(...count.childNodes);
            history.replaceState(null,'',result.href);
            row.tabIndex=-1;row.focus({preventScroll:true});row.scrollIntoView({block:'nearest',behavior:'instant'});
          }catch(error){
            console.warn('[forum:reply:render]',topicId,result.id,error.message);
            renderReplyTarget(form);
            const status=form.querySelector('[data-form-status]'),link=document.createElement('a');
            status.textContent='回复已发布。';link.href=result.href;link.textContent='查看回复';status.append(link);
          }
        }
        else location.assign(result.href);
      }catch(error){errorIn(form,error);}finally{submit.disabled=false;}
    });
    form.querySelector('[data-preview]').addEventListener('click',async()=>{
      const button=form.querySelector('[data-preview]');button.disabled=true;
      try{const result=await api('/api/forum/preview',{body:body.value,images:mode==='post'});const preview=form.querySelector('[data-preview-body]');preview.innerHTML=result.html;prepareImages(form);preview.hidden=false;body.hidden=true;button.setAttribute('aria-pressed','true');form.querySelector('[data-write]').setAttribute('aria-pressed','false');}
      catch(error){errorIn(form,error);}finally{button.disabled=false;}
    });
    form.querySelector('[data-write]').addEventListener('click',()=>{body.hidden=false;form.querySelector('[data-preview-body]').hidden=true;form.querySelector('[data-write]').setAttribute('aria-pressed','true');form.querySelector('[data-preview]').setAttribute('aria-pressed','false');body.focus();});
    form.querySelectorAll('[data-format]').forEach(button=>button.addEventListener('click',()=>{
      const formats={bold:['**','**'],italic:['*','*'],link:['[','](https://)'],quote:['> ',''],code:['\n```\n','\n```\n']};const [before,after]=formats[button.dataset.format];
      const a=body.selectionStart,b=body.selectionEnd,selection=body.value.slice(a,b);body.setRangeText(before+selection+after,a,b,'select');body.dispatchEvent(new Event('input',{bubbles:true}));form.querySelector('[data-write]').click();
    }));
  });
  function renderReplyTarget(form){
    const composer=form.closest('[data-reply-composer]'),parentId=form.dataset.parentId;
    const host=parentId?document.getElementById('reply-'+parentId)?.querySelector(':scope > .f-reply-content'):null;
    const destination=host||document.querySelector('[data-reply-home]');
    if(composer&&destination&&composer.parentElement!==destination)destination.append(composer);
    composer?.classList.toggle('is-inline',Boolean(host));
    const heading=composer?.querySelector('[data-reply-heading]');if(heading)heading.textContent=parentId?'回复 '+(form.dataset.parentName||'指定楼层'):'参与讨论';
    const box=form.querySelector('[data-reply-target]');if(!box)return;box.replaceChildren();box.hidden=!form.dataset.parentId;if(box.hidden)return;
    const text=document.createElement('span');text.textContent='回复 '+(form.dataset.parentName||'指定楼层');box.append(text);
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消回复';cancel.addEventListener('click',()=>{
      if(form.querySelector('[type=submit]').disabled)return;
      const trigger=document.querySelector(`[data-reply-to="${form.dataset.parentId}"]`);
      form.dataset.parentId='';form.dataset.parentName='';renderReplyTarget(form);form.dispatchEvent(new Event('input'));trigger?.focus({preventScroll:true});
    });box.append(cancel);
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    const interactive=button.matches('[data-vote],[data-follow],[data-bookmark],[data-reply-to],[data-withdraw],[data-report],[data-open-notice],[data-read-all],[data-withdraw-report]');if(!interactive)return;
    if(!userId){login();return;}if(button.disabled)return;
    button.disabled=true;
    try {
      if(button.hasAttribute('data-vote')){
        const group=button.closest('[data-vote-group]');const value=button.getAttribute('aria-pressed')==='true'?0:Number(button.dataset.vote);
        const result=await api(`/api/forum/${button.dataset.kind==='post'?'topics':'replies'}/${button.dataset.id}/vote`,{value});
        group.querySelector('[data-up]').textContent=result.up;const down=group.querySelector('[data-down]');if(down)down.textContent=result.down;
        group.querySelectorAll('[data-vote]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.vote)===result.mine)));
      }else if(button.hasAttribute('data-follow')){
        const result=await api(`/api/forum/user/${button.dataset.follow}/follow`,{enabled:button.dataset.enabled!=='true'});button.dataset.enabled=String(result.enabled);button.setAttribute('aria-pressed',String(result.enabled));button.textContent=result.enabled?'✓ 已关注':'+ 关注';button.classList.toggle('f-primary',!result.enabled);button.classList.toggle('f-secondary',result.enabled);
      }else if(button.hasAttribute('data-bookmark')){
        const result=await api(`/api/forum/topics/${button.dataset.bookmark}/bookmark`,{enabled:button.dataset.enabled!=='true'});button.dataset.enabled=String(result.enabled);button.setAttribute('aria-pressed',String(result.enabled));
        const label=button.querySelector('[data-bookmark-label]'),count=button.querySelector('[data-bookmark-count]');if(label)label.textContent=result.enabled?'已收藏':'收藏';if(count)count.textContent=result.count;button.setAttribute('aria-label',result.enabled?'取消收藏':'收藏帖子');
        toast(result.enabled?'已收藏':'已取消收藏');if(location.pathname==='/profile/'||new URLSearchParams(location.search).get('view')==='bookmarks')location.reload();
      }else if(button.hasAttribute('data-reply-to')){
        const form=document.querySelector('[data-editor="reply"]');if(!form||form.querySelector('[type=submit]').disabled)return;
        form.dataset.parentId=button.dataset.replyTo;form.dataset.parentName=button.dataset.replyName||'';renderReplyTarget(form);
        form.querySelector('[data-write]').click();
        const textarea=form.elements.body,bounds=textarea.getBoundingClientRect();
        if(bounds.top<110||bounds.bottom>innerHeight-24)textarea.scrollIntoView({block:'center',behavior:'instant'});
        textarea.focus({preventScroll:true});form.dispatchEvent(new Event('input'));
      }else if(button.hasAttribute('data-withdraw')){
        if(!await ncConfirm({title:'删除这段内容？',message:'已有讨论将保留占位，无法恢复。',ok:'删除'}))return;
        const [kind,id]=button.dataset.withdraw.split(':');await api(`/api/forum/${kind==='post'?'topics':'replies'}/${id}/withdraw`,{});location.reload();
      }else if(button.hasAttribute('data-report')){
        const dialog=document.querySelector('#forum-report-dialog'),form=dialog.querySelector('form');form.reset();form.querySelector('[data-form-status]').textContent='';form.dataset.target=button.dataset.report;
        const [kind]=button.dataset.report.split(':'),article=button.closest('article');const context=dialog.querySelector('[data-report-context]');context.replaceChildren();const title=document.createElement('strong');title.textContent='举报对象：'+(kind==='post'?'当前主帖':'当前回复');const quote=document.createElement('p');quote.textContent=article.querySelector('.f-prose')?.textContent.slice(0,100)||'';context.append(title,quote);dialog.showModal();
      }else if(button.hasAttribute('data-open-notice')){
        await api('/api/forum/notifications/read',{ids:button.dataset.openNotice.split(',').map(Number)});window.dispatchEvent(new Event('forum-notifications-changed'));
        if(button.dataset.href)location.assign(button.dataset.href);else {button.closest('.f-notice').classList.remove('is-unread');toast('相关内容已不可见，消息已标为已读。');}
      }else if(button.hasAttribute('data-read-all')){await api('/api/forum/notifications/read',{ids:'all',filter:button.dataset.noticeFilter||'all'});document.querySelectorAll('.f-notice').forEach(e=>e.classList.remove('is-unread'));window.dispatchEvent(new Event('forum-notifications-changed'));toast('已全部标为已读');}
      else if(button.hasAttribute('data-withdraw-report')){if(!await ncConfirm({title:'撤回这条举报？',message:'撤回后可以重新举报。',ok:'撤回举报'}))return;await api(`/api/forum/reports/${String(button.dataset.withdrawReport).replace(':','/')}/withdraw`,{});location.reload();}
    }catch(error){toast(error.message);}finally{button.disabled=false;}
  });
  document.addEventListener('click',event=>{const button=event.target.closest('[data-close-modal]');if(button)button.closest('dialog')?.close();});
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!form.matches('[data-report-form]'))return;event.preventDefault();if(!form.reportValidity())return;
    const submit=form.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;
    try {
      const [type,id]=form.dataset.target.split(':');const result=await api('/api/forum/reports',{type,id:Number(id),reason:form.elements.reason.value,detail:form.elements.detail.value});form.closest('dialog').close();toast(`举报 R${result.id} 已提交，可在个人中心“我的举报”查看进度。`);
    }catch(error){errorIn(form,error);}finally{submit.disabled=false;}
  });
})();
