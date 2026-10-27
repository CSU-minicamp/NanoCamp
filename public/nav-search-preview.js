import { searchRecords, searchTerms, previewExcerpt } from './search-core.js';

function highlight(node, value, terms) {
  const source = String(value ?? '').normalize('NFKC');
  const lower = source.toLocaleLowerCase();
  let offset = 0;
  while (offset < source.length) {
    const matches = terms.map(term => ({ term, index: lower.indexOf(term, offset) })).filter(hit => hit.index >= 0).sort((a, b) => a.index - b.index || b.term.length - a.term.length);
    if (!matches.length) { node.append(document.createTextNode(source.slice(offset))); break; }
    const hit = matches[0];
    node.append(document.createTextNode(source.slice(offset, hit.index)));
    const mark = document.createElement('mark');
    mark.textContent = source.slice(hit.index, hit.index + hit.term.length);
    node.append(mark);
    offset = hit.index + hit.term.length;
  }
}

let indexPromise;
function loadIndex() {
  if (!indexPromise) indexPromise = (async () => {
    let index = document.querySelector('[data-search-index]');
    if (!index) {
      const response = await fetch('/search/');
      if (!response.ok) throw new Error('Search unavailable');
      index = new DOMParser().parseFromString(await response.text(), 'text/html').querySelector('[data-search-index]');
    }
    const records = JSON.parse(index.textContent);
    if (!Array.isArray(records)) throw new Error('Invalid search index');
    return records;
  })().catch(error => { indexPromise = undefined; throw error; });
  return indexPromise;
}

export function bindSearchPreview(form, input) {
  const panel = document.createElement('div');
  panel.className = 'nav-search-preview';
  panel.id = `nav-search-preview-${document.querySelectorAll('.nav-search-preview').length}`;
  panel.hidden = true;
  panel.setAttribute('aria-label', '相关内容');
  input.setAttribute('aria-controls', panel.id);
  input.setAttribute('aria-expanded', 'false');
  const status = document.createElement('p');
  status.className = 'nav-search-preview-status';
  status.setAttribute('role', 'status');
  const list = document.createElement('div');
  panel.append(status, list);
  form.append(panel);
  let revision = 0;
  let timer;
  const close = () => { revision++; clearTimeout(timer); panel.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const show = () => { panel.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  async function render() {
    const query = input.value.trim();
    if (!query) { close(); return; }
    const current = ++revision;
    list.replaceChildren();
    status.textContent = '正在检索内容…';
    show();
    try {
      const records = await loadIndex();
      if (current !== revision) return;
      const matches = searchRecords(records, query);
      status.textContent = matches.length ? `相关内容 · ${matches.length} 条` : '没有找到相关内容，试试其他词';
      matches.slice(0, 4).forEach(record => {
        const link = document.createElement('a');
        link.className = 'nav-search-preview-result';
        link.href = record.href;
        const title = document.createElement('strong');
        highlight(title, record.title, searchTerms(query));
        const description = document.createElement('p');
        highlight(description, previewExcerpt(record, searchTerms(query), 90), searchTerms(query));
        link.append(title, description);
        list.append(link);
      });
      const all = document.createElement('a');
      all.className = 'nav-search-preview-all';
      all.href = `/search/?q=${encodeURIComponent(query)}`;
      all.textContent = '查看完整搜索结果 →';
      list.append(all);
    } catch {
      if (current === revision) status.textContent = '暂时无法加载预览，请按回车搜索';
    }
  }
  input.addEventListener('input', () => {
    close();
    if (!input.value.trim()) return;
    timer = setTimeout(render, 150);
  });
  input.addEventListener('focus', render);
  form.addEventListener('focusout', event => { if (!form.contains(event.relatedTarget)) close(); });
  document.addEventListener('pointerdown', event => { if (!form.contains(event.target)) close(); });
  form.addEventListener('submit', close);
  form.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { input.focus(); close(); return; }
    if (panel.hidden || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const links = [...list.querySelectorAll('a')];
    if (!links.length) return;
    event.preventDefault();
    const index = links.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % links.length : (index <= 0 ? links.length - 1 : index - 1);
    links[next].focus();
  });
}
