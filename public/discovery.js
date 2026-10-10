(() => {
  const buttons = [...document.querySelectorAll('[data-share-page]')];
  const status = document.querySelector('[data-share-status]');
  const fallback = document.querySelector('[data-share-fallback]');
  const field = fallback?.querySelector('input');
  const timers = new Map();
  let shareTrigger;
  let shareRevision = 0;
  function pageUrl() {
    const current = new URL(location.href);
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    const url = new URL(canonical || current.origin + current.pathname);
    for (const key of ['q','topic','type']) if (current.searchParams.has(key)) url.searchParams.set(key,current.searchParams.get(key));
    url.hash = current.hash;
    return url.href;
  }
  if (status && fallback && field && document.body.dataset.page !== 'missing') {
    buttons.forEach(button => {
      const label = button.querySelector('[data-share-label]');
      const original = label.textContent;
      button.hidden = false;
      button.addEventListener('click', async () => {
        if (button.getAttribute('aria-busy') === 'true') return;
        shareTrigger = button;
        const revision = ++shareRevision;
        // 结果区就放在触发按钮旁边（页脚按钮已移除，触发点都在侧边栏）。
        button.after(status, fallback);
        fallback.hidden = true;
        status.textContent = '';
        clearTimeout(timers.get(button));
        const url = pageUrl();
        button.setAttribute('aria-busy','true');
        button.setAttribute('aria-disabled','true');
        try {
          await navigator.clipboard.writeText(url);
          if (revision !== shareRevision) return;
          fallback.hidden = true;
          label.textContent = '链接已复制 ✓';
          status.textContent = '页面链接已复制，可以分享给一起创造的伙伴。';
          timers.set(button,setTimeout(()=>{label.textContent=original;timers.delete(button);},2200));
        } catch {
          if (revision !== shareRevision) return;
          label.textContent = original;
          field.value = url;
          fallback.hidden = false;
          field.focus();
          field.select();
          status.textContent = '暂时无法自动复制，已选中页面链接，请手动复制。';
        } finally { button.removeAttribute('aria-busy'); button.removeAttribute('aria-disabled'); }
      });
    });
    fallback.querySelector('button').addEventListener('click',()=>{fallback.hidden=true;(shareTrigger?.isConnected ? shareTrigger : buttons.find(button=>!button.hidden))?.focus();status.textContent='';});
  }
  document.querySelectorAll('.nav-search[data-search-shortcut]').forEach(link=>{
    const form = document.createElement('form');
    form.className = 'nav-search-form';
    form.action = '/search/';
    form.method = 'get';
    form.setAttribute('role','search');
    form.setAttribute('aria-label','站内搜索');
    const icon = link.querySelector('svg');
    if (icon) form.append(icon);
    const input = document.createElement('input');
    input.type = 'search';
    input.name = 'q';
    input.maxLength = 120;
    input.setAttribute('aria-label','搜索关键词，按回车搜索');
    input.autocomplete = 'off';
    input.setAttribute('data-search-shortcut','');
    form.append(input);
    form.addEventListener('submit',event=>{
      if (!input.value.trim()) { event.preventDefault(); input.focus(); }
    });
    link.replaceWith(form);
  });
  document.querySelectorAll('[data-search-shortcut]').forEach(link=>{
    link.title = '站内搜索 · Ctrl / ⌘ K';
    link.setAttribute('aria-keyshortcuts','Control+k Meta+k');
  });
  document.addEventListener('keydown',event=>{
    if(event.key.toLowerCase()!=='k' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.repeat || event.isComposing || document.querySelector('dialog[open]')) return;
    if(event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
    event.preventDefault();
    const input=[...document.querySelectorAll('.nav-search-form input')].find(node=>node.getClientRects().length) || document.querySelector('[data-search-ui]:not([hidden]) #site-query');
    if(input) input.focus();
  });
})();
