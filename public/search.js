import { searchRecords, searchTerms, resultExcerpt, isLocalResult } from './search-core.js';

const root = document.querySelector('[data-site-search]');
if (root) {
  try {
    const parsed = JSON.parse(root.querySelector('[data-search-index]').textContent);
    if (!Array.isArray(parsed)) throw new Error('Search index unavailable');
    const records = parsed.filter(isLocalResult);
    const form = root.querySelector('form');
    const input = root.querySelector('#site-query');
    const clear = root.querySelector('[data-query-clear]');
    const buttons = [...root.querySelectorAll('[data-search-type]')];
    const results = root.querySelector('[data-search-results]');
    const more = root.querySelector('[data-search-more]');
    const status = root.querySelector('[data-results-status]');
    const labels = { page:'社区页面', event:'活动', guide:'共创指南', faq:'常见问题', project:'作品' };
    const types = new Set(['all',...Object.keys(labels)]);
    let type = 'all';
    const pageSize = 6;
    let limit = pageSize;
    let timer;

    function highlighted(element, value, terms) {
      const source = String(value ?? '').normalize('NFKC');
      const lower = source.toLocaleLowerCase();
      let position = 0;
      while (position < source.length) {
        const found = terms.map(term => ({ term, start:lower.indexOf(term, position) })).filter(match => match.start >= 0).sort((a,b) => a.start - b.start || b.term.length - a.term.length)[0];
        if (!found) { element.append(document.createTextNode(source.slice(position))); break; }
        element.append(document.createTextNode(source.slice(position, found.start)));
        const mark = document.createElement('mark');
        mark.textContent = source.slice(found.start, found.start + found.term.length);
        element.append(mark);
        position = found.start + found.term.length;
      }
    }
    function resultNode(record, terms) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'search-result';
      link.href = record.href;
      const meta = document.createElement('div'); meta.className = 'search-result-meta';
      const kind = document.createElement('span'); kind.textContent = labels[record.type] || '内容';
      const context = document.createElement('span'); context.textContent = record.context || 'NanoCamp';
      meta.append(kind, context);
      const title = document.createElement('h3'); highlighted(title, record.title, terms);
      const description = document.createElement('p');
      highlighted(description, resultExcerpt(record, terms), terms);
      const arrow = document.createElement('span'); arrow.className = 'search-result-arrow'; arrow.setAttribute('aria-hidden','true'); arrow.textContent = '↗';
      const art = document.createElement('span');
      art.className = `search-card-art search-card-art-${record.type}`;
      art.setAttribute('aria-hidden','true');
      const glyphs = { page:'✦', event:'◎', guide:'✎', faq:'?', project:'◇' };
      art.textContent = glyphs[record.type] || '✦';
      link.append(meta,title,description,art,arrow); item.append(link);
      return item;
    }
    function updateLocation() {
      const url = new URL(location.href);
      const query = input.value.trim();
      query ? url.searchParams.set('q',query) : url.searchParams.delete('q');
      type === 'all' ? url.searchParams.delete('type') : url.searchParams.set('type',type);
      try { history.replaceState(null,'',url); } catch { /* Search still works without history access. */ }
    }
    function render({ write = true, expand = false } = {}) {
      clearTimeout(timer);
      const terms = searchTerms(input.value);
      const hasQuery = terms.length > 0;
      document.body.dataset.searchState = hasQuery ? 'results' : 'landing';
      const found = hasQuery ? searchRecords(records,input.value,type) : [];
      const previousCount = results.childElementCount;
      results.replaceChildren(...found.slice(0,limit).map(record => resultNode(record,terms)));
      root.querySelector('[data-search-empty]').hidden = found.length !== 0;
      more.hidden = found.length <= limit;
      clear.hidden = !input.value;
      const shown = Math.min(found.length,limit);
      status.textContent = terms.length ? `找到 ${found.length} 处匹配，已显示 ${shown} 处` : `${found.length} 个内容入口，已显示 ${shown} 个`;
      root.querySelector('[data-results-title]').textContent = terms.length ? '搜索结果' : type === 'all' ? '从这里开始探索。' : `探索${labels[type]}。`;
      buttons.forEach(button => {
        button.setAttribute('aria-pressed',String(button.dataset.searchType === type));
        button.hidden = button.dataset.searchType !== 'all' && button.dataset.searchType !== type && !records.some(record => record.type === button.dataset.searchType);
      });
      if (write) updateLocation();
      if (expand) results.children[previousCount]?.querySelector('a')?.focus();
    }
    function reset() {
      input.value=''; clear.hidden=true;
      input.focus({preventScroll:true});
      input.scrollIntoView({block:'center',behavior:'instant'});
    }
    function hydrate() {
      const params = new URL(location.href).searchParams;
      input.value = (params.get('q') || '').slice(0,120);
      type = types.has(params.get('type')) ? params.get('type') : 'all';
      limit=pageSize;
      render({write:false});
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!searchTerms(input.value).length) { input.focus(); return; }
      const position = { left: window.scrollX, top: window.scrollY, behavior: 'instant' };
      limit=pageSize; render();
      window.scrollTo(position);
    });
    input.addEventListener('input', () => { clear.hidden = !input.value; });
    input.addEventListener('keydown',event=>{if(event.key==='Escape' && !event.isComposing && event.keyCode!==229 && input.value){event.preventDefault();input.value='';clear.hidden=true;}});
    clear.addEventListener('click',()=>{input.value='';clear.hidden=true;input.focus({preventScroll:true});});
    root.querySelector('[data-search-reset]').addEventListener('click',reset);
    buttons.forEach(button=>button.addEventListener('click',()=>{type=button.dataset.searchType;limit=pageSize;render();}));
    root.querySelectorAll('[data-suggestion]').forEach(button=>button.addEventListener('click',()=>{input.value=button.dataset.suggestion;type='all';limit=pageSize;render();input.focus({preventScroll:true});}));
    more.addEventListener('click',()=>{limit+=pageSize;render({write:false,expand:true});});
    window.addEventListener('popstate',hydrate);
    hydrate();
    root.querySelector('[data-search-ui]').hidden=false;
    root.querySelector('[data-search-fallback]').hidden=true;
    if (location.hash === '#site-query') input.focus();
  } catch {
    root.querySelector('[data-search-ui]').hidden=true;
    root.querySelector('[data-search-fallback]').hidden=false;
    root.querySelector('[data-search-error]').hidden=false;
  }
}
