(() => {
  const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase().trim();
  const revealSections = [...document.querySelectorAll('[data-community-reveal]')];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-contact-fan]').forEach(deck => {
    const papers = [...deck.querySelectorAll('[data-contact-paper]')];
    const buttons = papers.map(paper => paper.querySelector('.contact-paper-tab'));
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let active = -1, busy = false, pending = null;
    const pose = paper => {
      const style = getComputedStyle(paper);
      return Object.fromEntries(['transform', 'left', 'top', 'width', 'height'].map(key => [key, style[key]]));
    };
    const animate = async (paper, frames, duration) => {
      if (motion.matches || !paper.animate) return;
      const animation = paper.animate(frames, {duration, easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'both'});
      try { await animation.finished; } finally { animation.cancel(); }
    };
    function show(index) {
      papers.forEach((paper, i) => {
        paper.classList.toggle('is-active', i === index);
        buttons[i].setAttribute('aria-expanded', String(i === index));
        paper.querySelector('.contact-paper-body').inert = i !== index;
      });
      active = index;
    }
    async function select(index) {
      if (busy) { pending = index; return; }
      if (index === active) return;
      busy = true;
      const next = papers[index], previous = papers[active];
      const before = pose(next);
      const pulled = {...before, transform: 'translateY(-145px) ' + before.transform};
      try {
        await animate(next, [before, pulled], 230);
        const previousPose = previous && pose(previous);
        show(index);
        await Promise.all([
          animate(next, [pulled, pose(next)], 430),
          previous ? animate(previous, [previousPose, pose(previous)], 430) : Promise.resolve(),
        ]);
      } finally {
        busy = false;
        if (pending !== null) { const index = pending; pending = null; select(index); }
      }
    }
    deck.classList.add('is-ready');
    show(location.hash === '#contact' ? 5 : location.hash === '#groups' ? 3 : 0);
    papers.forEach((paper, index) => {
      paper.addEventListener('click', event => {
        if (event.target.closest('a')) return;
        select(index);
      });
    });
    buttons.forEach((button, index) => {
      button.addEventListener('keydown', event => {
        let target;
        if (event.key === 'ArrowRight') target = (index + 1) % papers.length;
        if (event.key === 'ArrowLeft') target = (index + papers.length - 1) % papers.length;
        if (event.key === 'Home') target = 0;
        if (event.key === 'End') target = papers.length - 1;
        if (target === undefined) return;
        event.preventDefault();
        buttons[target].focus({preventScroll: true});
        select(target);
      });
    });
    const selectHash = hash => {
      if (hash === '#contact') select(5);
      if (hash === '#groups') select(3);
    };
    window.addEventListener('hashchange', () => selectHash(location.hash));
    // Re-activating the current fragment does not emit hashchange. Native
    // anchor clicks also cover Enter activation without replacing scrolling.
    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('a[href]');
      selectHash(link?.getAttribute('href'));
    });
  });
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
