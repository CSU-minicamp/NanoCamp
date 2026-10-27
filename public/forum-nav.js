(() => {
  const link=document.querySelector('[data-header-account]');if(!link)return;
  let busy=false,signedIn=null,refreshPending=false;
  function render(count){
    document.querySelectorAll('[data-message-count],[data-unread-count]').forEach(node=>{node.hidden=!count;node.textContent=count>99?'99+':count;});
    link.setAttribute('aria-label',`${link.querySelector('[data-account-label]').textContent}，进入个人中心${count?`，${count} 条未读消息`:''}`);
  }
  async function refresh(){
    if(document.hidden||signedIn===null)return;
    if(busy){refreshPending=true;return;}busy=true;
    try{
      if(!signedIn){render(0);return;}
      const response=await fetch('/api/forum/message-summary',{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)throw Error('消息暂不可用');
      const data=await response.json();window.dispatchEvent(new CustomEvent('forum-message-summary',{detail:data}));
      // 两处角标都指向同一个消息中心；其它通知渠道的数量
      // 不能算进私信的未读数。
      if(!refreshPending)render(signedIn?Number(data.dm_unread)||0:0);
    }catch(error){console.warn('[forum:notifications]',error.message);}
    finally{busy=false;if(refreshPending){refreshPending=false;refresh();}}
  }
  window.addEventListener('nanocamp-session',event=>{signedIn=event.detail.signedIn;refresh();});
  if(document.querySelector('[data-header-account]')?.classList.contains('is-signed-in'))signedIn=true;
  refresh();setInterval(refresh,60000);document.addEventListener('visibilitychange',refresh);window.addEventListener('forum-notifications-changed',refresh);
  document.addEventListener('click',event=>{if(event.target.closest('[data-profile-logout]')){try{for(const key of Object.keys(localStorage))if(key.startsWith('nc-forum-draft:')||key.startsWith('nc-dm-draft:')||key.startsWith('nc-dm-pending:'))localStorage.removeItem(key);}catch(error){console.warn('[forum:draft]',error.message);}}});
})();
