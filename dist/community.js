(() => {
  const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase().trim();
  const revealSections = [...document.querySelectorAll('[data-community-reveal]')];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (revealSections.length && 'IntersectionObserver' in window && !reduceMotion) {
    document.documentElement.classList.add('community-motion-ready');
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: .12, rootMargin: '0px 0px -7% 0px' });
    revealSections.forEach(section => revealObserver.observe(section));
  }
  document.querySelectorAll('[data-directory]').forEach(directory => {
    const buttons = [...directory.querySelectorAll('[data-filter]')];
    const items = [...directory.querySelectorAll('[data-filter-item]')];
    const input = directory.querySelector('[data-search-input]');
    const clear = directory.querySelector('[data-search-clear]');
    const empty = directory.querySelector('[data-filter-empty]');
    const status = directory.querySelector('[data-filter-status]');
    const records = items.map(element => ({ element, text: normalize(element.dataset.search || element.textContent) }));
    const validTopics = new Set(buttons.map(button => button.dataset.filter));
    let topic = 'all';
    let timer;

    function writeLocation() {
      const url = new URL(location.href);
      topic === 'all' ? url.searchParams.delete('topic') : url.searchParams.set('topic', topic);
      const query = input?.value.trim() || '';
      query ? url.searchParams.set('q', query) : url.searchParams.delete('q');
      try {
        const anchoredItem = items.find(item => item.id === decodeURIComponent(url.hash.slice(1)));
        if (anchoredItem?.hidden) url.hash = '';
      } catch { /* A malformed fragment must not interrupt filtering. */ }
      try { history.replaceState(null, '', url); } catch { /* Filtering also works in restricted previews. */ }
    }
    function apply(updateLocation = true) {
      clearTimeout(timer);
      const terms = normalize(input?.value || '').split(/\s+/).filter(Boolean);
      let count = 0;
      records.forEach(({ element, text }) => {
        const show = (topic === 'all' || element.dataset.category === topic) && terms.every(term => text.includes(term));
        element.hidden = !show;
        if (show) count++;
      });
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === topic)));
      if (status) status.textContent = directory.dataset.directory === 'faq' ? `找到 ${count} 个问题` : directory.dataset.directory === 'resources' ? `找到 ${count} 篇指南` : `正在展示 ${count} 种活动形式`;
      if (empty) empty.hidden = count !== 0;
      if (clear) clear.hidden = !input.value;
      if (updateLocation) writeLocation();
    }
    function hydrate() {
      const params = new URL(location.href).searchParams;
      topic = validTopics.has(params.get('topic')) ? params.get('topic') : 'all';
      if (input) input.value = (params.get('q') || '').slice(0, 120);
      apply(false);
    }
    function reset() {
      topic = 'all';
      if (input) input.value = '';
      apply();
      const control = input || buttons.find(button => button.dataset.filter === 'all');
      control?.focus({ preventScroll: true });
      control?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    function revealHash() {
      let id;
      try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
      const target = items.find(element => element.id === id);
      if (!target?.matches('details')) return;
      if (target.hidden) {
        topic = 'all';
        if (input) input.value = '';
        apply();
      }
      target.open = true;
      requestAnimationFrame(() => {
        target.querySelector('summary')?.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
      });
    }
    buttons.forEach(button => button.addEventListener('click', () => { topic = button.dataset.filter; apply(); }));
    input?.addEventListener('input', event => {
      clearTimeout(timer);
      if (!event.isComposing) timer = setTimeout(() => apply(), 160);
    });
    input?.addEventListener('compositionend', () => { clearTimeout(timer); timer = setTimeout(() => apply(), 160); });
    clear?.addEventListener('click', () => { input.value = ''; apply(); input.focus({ preventScroll: true }); });
    directory.querySelector('[data-filter-reset]')?.addEventListener('click', reset);
    directory.querySelectorAll('[data-filter-controls], [data-search-controls], [data-filter-status]').forEach(element => { element.hidden = false; });
    window.addEventListener('popstate', () => { hydrate(); revealHash(); });
    window.addEventListener('hashchange', revealHash);
    hydrate();
    revealHash();
  });

  // Ambient orbit only runs while visible and when the visitor permits motion.
  document.querySelectorAll('.activity-art').forEach(art => {
    let visible = false;
    const update = () => art.classList.toggle('art-in-view', visible && !document.hidden && !window.NanoCampMotion?.stopped);
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); }, { threshold: .1 });
      observer.observe(art);
    }
    document.addEventListener('visibilitychange', update);
    window.NanoCampMotion?.subscribe(update);
  });
})();
