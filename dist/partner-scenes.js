(() => {
  const scenes = [...document.querySelectorAll('.partner-scene')];
  if (!scenes.length) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const motionAllowed = () => !reduced.matches && !document.hidden && !window.NanoCampMotion?.stopped && !document.body.classList.contains('motion-stopped');
  const animations = new Set();
  const links = [...document.querySelectorAll('[data-idea-nav]')];
  const papers = [...document.querySelectorAll('[data-idea-paper]')];
  const articles = [...document.querySelectorAll('[data-idea-section]')];
  const desk = document.querySelector('.partner-ideas');
  let shownIndex = null, locationIndex = '0', followFrame = 0, readingVisible = true;

  function select(index, preview = false) {
    if (!papers.some(paper => paper.dataset.ideaPaper === index)) return;
    if (shownIndex !== index) {
      papers.forEach(paper => paper.classList.toggle('is-active', paper.dataset.ideaPaper === index));
      shownIndex = index;
    }
    links.forEach(link => {
      link.classList.toggle('is-preview', preview && link.dataset.ideaNav === index);
      if (!preview && locationIndex !== index) {
        if (link.dataset.ideaNav === index) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    });
    if (!preview) locationIndex = index;
  }

  function navigate(event, target) {
    if (!target || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
    event.preventDefault();
    if (location.hash !== '#' + target.id) history.pushState(null, '', '#' + target.id);
    target.focus({preventScroll: true});
    target.scrollIntoView({block: 'start', behavior: motionAllowed() ? 'smooth' : 'instant'});
    return true;
  }
  links.forEach(link => {
    link.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') select(link.dataset.ideaNav, true); });
    link.addEventListener('focus', () => select(link.dataset.ideaNav, true));
    link.addEventListener('click', event => { if (navigate(event, document.getElementById(link.hash.slice(1)))) select(link.dataset.ideaNav); });
  });
  document.querySelector('.partner-puzzle')?.addEventListener('click', event => navigate(event, document.getElementById('contact')));

  function stopMotion() {
    animations.forEach(animation => animation.cancel());
    animations.clear();
  }
  function unfoldAlbum(album) {
    if (!motionAllowed()) return;
    [...album.querySelectorAll('.partner-photo')].forEach((photo, index) => {
      if (typeof photo.animate !== 'function') return;
      const animation = photo.animate([
        {transform: index ? 'translate(-27px,-27px) rotate(0deg) scale(.95)' : 'translate(30px,50px) rotate(0deg) scale(.95)', clipPath: 'inset(0 6% 8% 0)', boxShadow: '0 8px 16px -12px #31534355'},
        {transform: getComputedStyle(photo).transform, clipPath: 'inset(0 0 0 0)', boxShadow: getComputedStyle(photo).boxShadow},
      ], {duration: 640, delay: index * 70, easing: 'cubic-bezier(.16,1,.3,1)'});
      animations.add(animation);
      animation.finished.catch(() => {}).finally(() => animations.delete(animation));
    });
  }

  // Read current positions only on scroll frames, while this section is visible.
  // Cached observer ratios can otherwise select the article we just scrolled past.
  function followReading() {
    followFrame = 0;
    if (document.hidden || !readingVisible || desk?.contains(document.activeElement)) return;
    const headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom || 88;
    const line = Math.max(headerBottom + 30, Math.min(innerHeight * .3, 250));
    const visible = articles.map(article => ({article, rect: article.getBoundingClientRect()})).filter(({rect}) => rect.bottom > headerBottom && rect.top < innerHeight);
    const current = visible.find(({rect}) => rect.top <= line && rect.bottom > line) || visible.sort((a, b) => Math.abs(a.rect.top - line) - Math.abs(b.rect.top - line))[0];
    if (current) select(current.article.dataset.ideaSection);
  }
  function scheduleFollow() {
    if (!followFrame && readingVisible && !document.hidden) followFrame = requestAnimationFrame(followReading);
  }
  window.addEventListener('scroll', scheduleFollow, {passive: true});
  window.addEventListener('resize', scheduleFollow, {passive: true});
  window.addEventListener('hashchange', scheduleFollow);
  desk?.addEventListener('focusout', scheduleFollow);
  if (typeof IntersectionObserver === 'function') {
    const section = document.getElementById('possibilities');
    if (section) {
      const range = new IntersectionObserver(entries => {
        readingVisible = entries[0].isIntersecting;
        if (readingVisible) scheduleFollow();
      });
      range.observe(section);
    }
    const album = document.querySelector('.partner-album');
    if (album) {
      const entrance = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        entrance.disconnect();
        unfoldAlbum(album);
      }, {threshold: .2});
      entrance.observe(album);
    }
  }
  reduced.addEventListener('change', () => { if (!motionAllowed()) stopMotion(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopMotion(); cancelAnimationFrame(followFrame); followFrame = 0; }
    else scheduleFollow();
  });
  window.NanoCampMotion?.subscribe(() => { if (!motionAllowed()) stopMotion(); });
  scheduleFollow();
})();
