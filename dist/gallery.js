(() => {
  const dialog=document.getElementById('lightbox-dialog');
  if (!dialog || !window.NanoCampDialogs || typeof dialog.showModal!=='function') return;
  const stage=dialog.querySelector('[data-photo-stage]');
  const count=dialog.querySelector('[data-photo-count]');
  const caption=dialog.querySelector('#lightbox-caption');
  const status=dialog.querySelector('[data-photo-status]');
  const title=dialog.querySelector('#lightbox-title');
  const loading=dialog.querySelector('[data-photo-loading]');
  const error=dialog.querySelector('[data-photo-error]');
  const original=dialog.querySelector('[data-photo-original]');
  const thumbs=dialog.querySelector('[data-photo-thumbnails]');
  const previous=dialog.querySelector('[data-photo-prev]');
  const next=dialog.querySelector('[data-photo-next]');
  let image=dialog.querySelector('#lightbox-image');
  let items=[], index=0, revision=0, pendingImage;
  const pointers=new Set();
  let gesture;
  function resetGesture() {gesture=null;pointers.clear();}
  function safeImageURL(value) {
    if(typeof value!=='string' || !value.trim()) return null;
    try { const url=new URL(value,location.href); return ['https:','http:'].includes(url.protocol)?url.href:null; } catch { return null; }
  }
  function photoItem(trigger) {
    const src=safeImageURL(trigger.dataset.lightbox);
    if(!src || trigger.hidden || trigger.closest('[hidden]')) return null;
    return {src,preview:safeImageURL(trigger.querySelector('img')?.getAttribute('src')) || src,caption:trigger.dataset.caption || trigger.querySelector('img')?.alt || '活动照片',label:trigger.dataset.albumLabel || '现场相册'};
  }
  function cancelLoad() {
    if(!pendingImage) return;
    pendingImage.onload=null;
    pendingImage.onerror=null;
    pendingImage.removeAttribute('src');
    pendingImage=null;
  }
  function updateThumbnails() {
    [...thumbs.children].forEach((button,i)=>{
      button.setAttribute('aria-pressed',String(i===index));
      button.tabIndex=i===index?0:-1;
    });
    const current=thumbs.children[index];
    if(current && !thumbs.hidden) {
      const box=current.getBoundingClientRect(), frame=thumbs.getBoundingClientRect();
      thumbs.scrollTo({left:thumbs.scrollLeft+box.left-frame.left-(frame.width-box.width)/2,behavior:window.NanoCampMotion?.stopped?'instant':'smooth'});
    }
  }
  function showPhoto(position) {
    if(!items.length || !dialog.open) return;
    index=(position+items.length)%items.length;
    const item=items[index], request=++revision;
    cancelLoad();
    if(error.contains(document.activeElement)) stage.focus({preventScroll:true});
    image.hidden=true;
    loading.hidden=false;
    error.hidden=true;
    stage.setAttribute('aria-busy','true');
    caption.textContent=item.caption;
    original.href=item.src;
    count.textContent=String(index+1).padStart(2,'0')+' / '+String(items.length).padStart(2,'0');
    status.textContent='第 '+(index+1)+' 张，共 '+items.length+' 张。'+item.caption;
    updateThumbnails();
    const candidate=new Image();
    pendingImage=candidate;
    candidate.id='lightbox-image';
    candidate.className='album-photo';
    candidate.alt=item.caption;
    candidate.decoding='async';
    candidate.draggable=false;
    candidate.onload=()=>{
      if(request!==revision || !dialog.open) return;
      candidate.onload=null;candidate.onerror=null;pendingImage=null;
      image.replaceWith(candidate);image=candidate;
      loading.hidden=true;error.hidden=true;
      stage.setAttribute('aria-busy','false');
    };
    candidate.onerror=()=>{
      if(request!==revision || !dialog.open) return;
      candidate.onload=null;candidate.onerror=null;pendingImage=null;
      loading.hidden=true;error.hidden=false;
      stage.setAttribute('aria-busy','false');
      status.textContent='第 '+(index+1)+' 张照片暂时无法加载。可以重新加载，或切换到其他照片。';
    };
    candidate.src=item.src;
  }
  function makeThumbnails() {
    thumbs.replaceChildren();
    if(items.length<2) {thumbs.hidden=true;return;}
    const fragment=document.createDocumentFragment();
    items.forEach((item,i)=>{
      const button=document.createElement('button');
      button.type='button';button.dataset.photoThumb=String(i);
      button.setAttribute('aria-label','查看第 '+(i+1)+' 张：'+item.caption);
      button.setAttribute('aria-pressed','false');
      const preview=document.createElement('img');
      preview.src=item.preview;preview.alt='';preview.loading='lazy';preview.decoding='async';preview.draggable=false;
      preview.addEventListener('error',()=>{preview.hidden=true;});
      const number=document.createElement('span');
      number.textContent=String(i+1).padStart(2,'0');number.setAttribute('aria-hidden','true');
      button.append(preview,number);
      button.addEventListener('click',()=>{showPhoto(i);button.focus({preventScroll:true});});
      fragment.append(button);
    });
    thumbs.append(fragment);thumbs.hidden=false;
  }
  function open(trigger) {
    const selected=photoItem(trigger);
    if(!selected) return false;
    const album=trigger.dataset.album;
    const candidates=album?[...document.querySelectorAll('[data-lightbox]')].filter(link=>link.dataset.album===album):[trigger];
    const unique=new Map();
    candidates.forEach(link=>{const item=photoItem(link);if(item && !unique.has(item.src)) unique.set(item.src,item);});
    unique.set(selected.src,selected);
    items=[...unique.values()];
    title.textContent=selected.label;
    previous.hidden=next.hidden=items.length<2;
    dialog.querySelector('#lightbox-help').textContent=items.length>1?'方向键切换照片，Home / End 跳到首尾，Esc 关闭。':'Esc 关闭相册，也可以打开原图查看。';
    dialog.querySelector('.album-swipe-note').hidden=items.length<2;
    makeThumbnails();
    window.NanoCampDialogs.open(dialog,trigger);
    showPhoto(items.findIndex(item=>item.src===selected.src));
    return true;
  }
  document.addEventListener('click',event=>{
    const trigger=event.target.closest('[data-lightbox]');
    if(!trigger || event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if(open(trigger)) event.preventDefault();
  });
  previous.addEventListener('click',()=>showPhoto(index-1));
  next.addEventListener('click',()=>showPhoto(index+1));
  dialog.querySelector('[data-photo-retry]').addEventListener('click',()=>showPhoto(index));
  dialog.addEventListener('keydown',event=>{
    if(event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || items.length<2) return;
    event.preventDefault();
    showPhoto(event.key==='Home'?0:event.key==='End'?items.length-1:index+(event.key==='ArrowRight'?1:-1));
    if(event.target.closest('[data-photo-thumb]')) thumbs.children[index]?.focus({preventScroll:true});
  });
  stage.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='touch' || event.target.closest('a,button')) return;
    pointers.add(event.pointerId);
    gesture=pointers.size===1?{id:event.pointerId,x:event.clientX,y:event.clientY}:null;
  },{passive:true});
  window.addEventListener('pointerup',event=>{
    const start=gesture;gesture=null;pointers.delete(event.pointerId);
    if(!start || start.id!==event.pointerId || pointers.size || items.length<2) return;
    const dx=event.clientX-start.x,dy=event.clientY-start.y;
    if(Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.6) showPhoto(index+(dx<0?1:-1));
  },{passive:true});
  window.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);gesture=null;},{passive:true});
  window.addEventListener('lostpointercapture',event=>{pointers.delete(event.pointerId);gesture=null;},{passive:true});
  window.addEventListener('blur',resetGesture);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)resetGesture();});
  dialog.addEventListener('close',()=>{
    revision++;cancelLoad();items=[];resetGesture();
    image.removeAttribute('src');image.hidden=true;
    thumbs.replaceChildren();thumbs.hidden=true;
    loading.hidden=true;error.hidden=true;status.textContent='';
    stage.setAttribute('aria-busy','false');
  });
})();
