export const normalizeSearch = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
export const searchTerms = query => [...new Set(normalizeSearch(String(query ?? '').slice(0, 120)).split(' ').filter(Boolean))];
export function isLocalResult(record) {
  return record && typeof record.title === 'string' && record.title.trim() && typeof record.href === 'string' && /^\/(?!\/)/.test(record.href) && !/[\\\u0000-\u0020]/.test(record.href);
}
export function searchRecords(records, query = '', type = 'all') {
  const terms = searchTerms(query);
  const phrase = terms.join(' ');
  return (Array.isArray(records) ? records : []).filter(isLocalResult).filter(record => type === 'all' || record.type === type).map((record, order) => {
    const title = normalizeSearch(record.title);
    const description = normalizeSearch(record.description);
    const body = normalizeSearch(record.text);
    const combined = `${title} ${description} ${body}`;
    if (!terms.every(term => combined.includes(term))) return null;
    const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 8 : 0) + (description.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0), 0) + (phrase && title === phrase ? 20 : 0);
    return { record, order, score };
  }).filter(Boolean).sort((a,b) => b.score - a.score || a.order - b.order).map(item => item.record);
}
export function excerpt(text, terms = [], limit = 120) {
  const source = String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (source.length <= limit) return source;
  const lower = source.toLocaleLowerCase();
  const positions = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
  const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 30);
  const end = Math.min(source.length, start + limit);
  return (start ? '…' : '') + source.slice(start, end) + (end < source.length ? '…' : '');
}

export function resultExcerpt(record, terms = [], limit = 100) {
  const description = String(record.description ?? '').trim();
  const body = String(record.text ?? '').trim();
  const summary = normalizeSearch(`${record.title || ''} ${description}`);
  const bodyTerms = terms.filter(term => !summary.includes(term));
  return excerpt(bodyTerms.length ? body || description : description || body, bodyTerms.length ? bodyTerms : terms, limit);
}
