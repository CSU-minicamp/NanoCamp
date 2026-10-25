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
  document.querySelectorAll('.f-feed-search').forEach(form=>{
    const input = form.querySelector('input[name="q"]');
    input.autocomplete = 'off';
    input.placeholder = '论坛内搜索';
    input.maxLength = 100;
    input.setAttribute('aria-label','论坛内搜索');
    input.value = new URLSearchParams(location.search).get('q') || '';
    input.setAttribute('role','combobox');
    input.setAttribute('aria-autocomplete','list');
    input.setAttribute('aria-expanded','false');
    const results = document.createElement('div');
    results.className = 'f-search-suggestions';
    results.id = 'forum-search-suggestions';
    results.setAttribute('role','listbox');
    results.setAttribute('aria-label','匹配的帖子');
    results.hidden = true;
    input.setAttribute('aria-controls',results.id);
    const status = document.createElement('span');
    status.className = 'sr-only';
    status.setAttribute('role','status');
    form.append(results,status);
    let timer, controller, revision = 0, selected = -1, composing = false;
    function close() {
      revision++; clearTimeout(timer); controller?.abort();
      results.hidden = true; selected = -1;
      input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant');
    }
    function schedule() {
      close();
      if (composing || !input.value.trim()) return;
      const current = revision, query = input.value.trim();
      timer = setTimeout(async()=>{
        controller = new AbortController();
        try {
          const response = await fetch('/api/forum/topics?q=' + encodeURIComponent(query), {signal:controller.signal,cache:'no-store'});
          if (!response.ok) throw Error('搜索暂不可用');
          const data = await response.json();
          if (current !== revision || document.activeElement !== input) return;
          results.replaceChildren(); selected = -1;
          const items = data.items.slice(0,10);
          items.forEach((topic,index)=>{
            const option = document.createElement('a');
            option.href = '/forum/topics/' + topic.id + '/';
            option.id = results.id + '-' + index;
            option.setAttribute('role','option'); option.setAttribute('aria-selected','false');
            const title = document.createElement('span');
            const text = String(topic.title), lower = text.toLocaleLowerCase(), needle = query.toLocaleLowerCase();
            let start = 0, at;
            while ((at = lower.indexOf(needle,start)) !== -1) {
              title.append(document.createTextNode(text.slice(start,at)));
              const match = document.createElement('mark'); match.textContent = text.slice(at,at+query.length); title.append(match);
              start = at + query.length;
            }
            title.append(document.createTextNode(text.slice(start)));
            option.append(title); option.title = text; results.append(option);
          });
          if (!items.length) {
            const empty = document.createElement('p'); empty.textContent = '没有匹配的帖子'; results.append(empty);
          }
          status.textContent = items.length ? items.length + ' 条匹配的帖子' : '没有匹配的帖子';
          results.hidden = false; input.setAttribute('aria-expanded','true');
        } catch (error) {
          if (error.name === 'AbortError' || current !== revision) return;
          console.warn('[forum:search]',error.message);
          status.textContent = '搜索暂不可用，请按回车重试';
        }
      },200);
    }
    input.addEventListener('input',schedule);
    input.addEventListener('compositionstart',()=>{composing=true;close();});
    input.addEventListener('compositionend',()=>{composing=false;schedule();});
    input.addEventListener('focus',schedule);
    input.addEventListener('keydown',event=>{
      if (event.isComposing || composing) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      const options = [...results.querySelectorAll('[role="option"]')];
      if (results.hidden || !options.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        selected = selected < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (selected + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options.forEach((option,index)=>option.setAttribute('aria-selected',String(index===selected)));
        input.setAttribute('aria-activedescendant',options[selected].id);
        options[selected].scrollIntoView({block:'nearest'});
      } else if (event.key === 'Enter' && selected >= 0) {
        event.preventDefault(); location.assign(options[selected].href);
      }
    });
    document.addEventListener('pointerdown',event=>{if(!form.contains(event.target))close();});
    form.addEventListener('focusout',event=>{if(!form.contains(event.relatedTarget))close();});
  });
  document.querySelectorAll('[data-search-shortcut]').forEach(link=>{
    link.title = '站内搜索 · Ctrl / ⌘ K';
    link.setAttribute('aria-keyshortcuts','Control+k Meta+k');
  });
  document.addEventListener('keydown',event=>{
    // 扩展、密码管理器、辅助技术派发的合成 keydown 可能没有 key（undefined），
    // 直接 .toLowerCase() 会抛 TypeError 并且把整个快捷键掐掉。先兜一层。
    const key = String(event.key ?? '').toLowerCase();
    if(key!=='k' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.repeat || event.isComposing || document.querySelector('dialog[open]')) return;
    if(event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
    event.preventDefault();
    const input=[...document.querySelectorAll('.nav-search-form input')].find(node=>node.getClientRects().length) || document.querySelector('[data-search-ui]:not([hidden]) #site-query');
    if(input) input.focus();
  });
})();
