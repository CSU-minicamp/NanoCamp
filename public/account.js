(() => {
  const profile=document.querySelector('[data-account-profile]'),password=document.querySelector('[data-account-password]'),logout=document.querySelector('[data-account-logout]');
  if(!profile&&!password&&!logout)return;
  const errors={current_password_invalid:'当前密码不正确。',password_change_required:'请在账号安全中验证当前密码后修改。',password_mismatch:'两次输入的新密码不一致。',password_unchanged:'新密码不能与当前密码相同。',invalid_password:'密码需要 8–72 个字符。',invalid_profile:'昵称不能为空、最多 24 个字符且不能包含 / 这类符号，简介最多 160 个字符。',rate_limited:'尝试次数过多，请 15 分钟后重试。',forbidden:'页面状态已变化，请刷新后重试。',unavailable:'服务暂时不可用，请稍后重试。'};
  let busy=false,syncProfile=()=>{};
  async function post(path,body,method='POST',contentType='application/json'){
    const sr=await fetch('/api/session',{cache:'no-store',credentials:'same-origin'});
    if(!sr.ok)throw Error(errors.unavailable);
    const s=await sr.json();if(!s.user){location.assign('/login/?next='+encodeURIComponent(location.pathname+location.search));throw Error('请重新登录。');}
    let r;try{r=await fetch(path,{method,credentials:'same-origin',headers:{'content-type':contentType,'x-nc-csrf':s.csrf},body:method==='DELETE'?undefined:contentType==='application/json'?JSON.stringify(body):body});}catch{throw Error('网络连接失败，输入已保留，请重试。');}
    const data=await r.json().catch(()=>null);
    if(!data)throw Error(errors.unavailable);
    if(!r.ok){if(data.error==='unauthenticated')location.assign('/login/?next='+encodeURIComponent(location.pathname+location.search));throw Error(errors[data.error]||'操作未完成，请稍后重试。');}
    return data;
  }
  function setStatus(form,message){(form.querySelector('[data-account-status]')||document.querySelector('[data-page-status]')).textContent=message;}
  if(profile){
    const nickname=profile.elements.nickname,bio=profile.elements.bio;
    const dirty=()=>nickname.value!==nickname.defaultValue||bio.value!==bio.defaultValue;
    // 按码点数（Array.from）而不是 value.length：一个 emoji 算 1 个，和服务端口径一致。
    // 上限不写死：模板把 common/limits.mjs 的值渲染进 data-max，这里只读。
    const count=value=>Array.from(value).length;
    const limitOf=(selector,fallback)=>Number(profile.querySelector(selector)?.dataset.max)||fallback;
    const sync=()=>{profile.querySelectorAll('button').forEach(b=>b.disabled=busy||!dirty());const bioCount=profile.querySelector('[data-bio-count]');if(bioCount)bioCount.textContent=`${count(bio.value)}/${limitOf('[data-bio-count]',160)}`;const nameCount=profile.querySelector('[data-nickname-count]');if(nameCount)nameCount.textContent=`${count(nickname.value)}/${limitOf('[data-nickname-count]',24)}`;};
    syncProfile=sync;
    profile.addEventListener('input',()=>{sync();setStatus(profile,'');});
    profile.addEventListener('reset',()=>setTimeout(()=>{sync();setStatus(profile,'');},0));
    window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
    profile.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||!dirty()||!profile.reportValidity())return;
      busy=true;sync();setStatus(profile,'正在保存…');
      try{
        const data=await post('/api/profile',{nickname:nickname.value.trim(),bio:bio.value.trim()});
        nickname.value=nickname.defaultValue=data.user.nickname;bio.value=bio.defaultValue=data.user.bio;
        document.querySelectorAll('.f-self strong,[data-profile-display-name]').forEach(e=>e.textContent=data.user.nickname);
        document.querySelector('[data-profile-display-bio]').textContent=data.user.bio;
        window.dispatchEvent(new Event('pageshow'));setStatus(profile,'资料已保存。');
      }catch(error){setStatus(profile,error.message);}finally{busy=false;sync();}
    });sync();
  }
  const picker=document.querySelector('[data-avatar-input]');
  if(picker){
    const image=document.querySelector('.f-account-avatar img'),choose=document.querySelector('[data-select-avatar]'),reset=document.querySelector('[data-reset-avatar]'),actions=document.querySelector('[data-avatar-actions]'),save=document.querySelector('[data-save-avatar]'),cancel=document.querySelector('[data-cancel-avatar]'),status=document.querySelector('[data-avatar-status]');
    let selected=null,previewUrl='',savedSource=image.getAttribute('src'),isDefault=true,selectionVersion=0,avatarChanged=false;
    const avatarErrors={avatar_too_large:'图片不能超过 2MB。',invalid_image:'图片无法使用，请选择有效的 JPG、PNG 或 WebP 静态图片。',unsupported_image_type:'请选择 JPG、PNG 或 WebP 图片。',rate_limited:'头像修改较频繁，请稍后重试。',profile_incomplete:'请先完善账号资料。',csrf_invalid:'页面状态已变化，请刷新后重试。',avatar_unavailable:'头像服务暂时不可用，请稍后重试。'};
    const dispose=()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';};
    const sync=()=>{for(const button of [choose,reset,save,cancel])button.disabled=busy;picker.disabled=busy;actions.hidden=!selected;reset.hidden=isDefault||Boolean(selected);syncProfile();};
    const refreshImages=result=>{savedSource=result.url+'?v='+(result.version||Date.now());document.querySelectorAll('.account-avatar-image').forEach(img=>{if(img===image||new URL(img.getAttribute('src'),location.origin).pathname===result.url)img.src=savedSource;});};
    fetch('/api/profile/avatar',{cache:'no-store',credentials:'same-origin'}).then(async r=>{if(!r.ok)throw Error('头像信息暂时不可用');const result=await r.json();if(!avatarChanged){isDefault=result.isDefault;sync();}}).catch(error=>{console.warn('[account:avatar]',error.message);});
    choose.addEventListener('click',()=>{if(!busy)picker.click();});
    picker.addEventListener('change',async()=>{
      const file=picker.files[0];picker.value='';if(!file||busy)return;const version=++selectionVersion;
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)){status.textContent=avatarErrors.unsupported_image_type;return;}
      if(file.size>Number(picker.dataset.maxBytes||0)){status.textContent=avatarErrors.avatar_too_large;return;}
      const url=URL.createObjectURL(file);let accepted=false;
      try{const check=new Image();check.src=url;await check.decode();if(version!==selectionVersion)return;if(check.naturalWidth*check.naturalHeight>16*1024*1024)throw Error('图片尺寸过大，请选择较小的图片。');dispose();previewUrl=url;selected=file;image.src=url;accepted=true;status.textContent='';sync();}
      catch(error){if(version===selectionVersion)status.textContent=error.message.includes('尺寸')?error.message:avatarErrors.invalid_image;}
      finally{if(!accepted)URL.revokeObjectURL(url);}
    });
    cancel.addEventListener('click',()=>{if(busy)return;selectionVersion++;selected=null;image.src=savedSource;dispose();status.textContent='';sync();});
    const submit=async method=>{
      if(busy||method==='PUT'&&!selected)return;
      selectionVersion++;busy=true;sync();status.textContent=method==='PUT'?'正在保存头像…':'正在恢复默认头像…';
      try{const result=await post('/api/profile/avatar',selected,method,selected?.type||'application/json');selected=null;isDefault=result.isDefault;avatarChanged=true;refreshImages(result);dispose();status.textContent=method==='PUT'?'头像已更新。':'已恢复默认头像。';}
      catch(error){status.textContent=error.message;}
      finally{busy=false;sync();}
    };
    save.addEventListener('click',()=>submit('PUT'));
    reset.addEventListener('click',()=>{if(!busy&&confirm('恢复默认头像？'))submit('DELETE');});
    window.addEventListener('beforeunload',event=>{if(selected){event.preventDefault();event.returnValue='';}});
    window.addEventListener('pagehide',event=>{if(!event.persisted)dispose();});
    Object.assign(errors,avatarErrors);sync();
  }
  if(password){
    password.querySelector('[data-cancel-password]').addEventListener('click',()=>{if(busy)return;password.closest('details').open=false;setStatus(password,'');});
    password.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||!password.reportValidity())return;
      const body=Object.fromEntries(new FormData(password));
      if(body.newPassword!==body.confirmPassword){setStatus(password,errors.password_mismatch);return;}
      if(body.newPassword===body.currentPassword){setStatus(password,errors.password_unchanged);return;}
      busy=true;password.querySelectorAll('button').forEach(b=>b.disabled=true);setStatus(password,'正在验证并修改密码…');
      try{const data=await post('/api/profile/password',body);password.reset();location.replace(data.redirect||'/login/');}
      catch(error){password.elements.currentPassword.value='';setStatus(password,error.message);password.elements.currentPassword.focus();}
      finally{busy=false;password.querySelectorAll('button').forEach(b=>b.disabled=false);}
    });
  }
  logout?.addEventListener('click',async()=>{
    if(busy)return;busy=true;logout.disabled=true;
    try{await post('/api/auth/logout',{});location.replace('/login/');}
    catch(error){document.querySelector('[data-page-status]').textContent=error.message;busy=false;logout.disabled=false;}
  });
})();
