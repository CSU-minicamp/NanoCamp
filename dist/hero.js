(() => {
  const hero = document.querySelector('[data-brand-hero]');
  if (!hero) return;
  const controls = hero.querySelector('[data-motion-controls]');
  const replay = hero.querySelector('[data-motion-replay]');
  const toggle = hero.querySelector('[data-motion-toggle]');
  const status = hero.querySelector('[data-motion-status]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const shared = window.NanoCampMotion;
  let paused = shared?.paused || false, ready = false, introduced = false;
  let sequence = 0, visible = hero.getBoundingClientRect().bottom > 0;
  let animations = [];
  function finish() {
    sequence++;
    animations.forEach(animation => animation.cancel());
    animations = [];
    hero.classList.remove('is-intro');
    document.body.classList.remove('poster-intro');
  }
  function play(announce = false) {
    if (!ready || reduced.matches || paused || !visible || document.hidden) return;
    finish();
    const current = sequence;
    void hero.offsetWidth;
    hero.classList.add('is-intro');
    document.body.classList.add('poster-intro');
    introduced = true;
    animations = [...hero.getAnimations({ subtree: true }), ...document.querySelector('.site-header .brand-asset').getAnimations()];
    Promise.allSettled(animations.map(animation => animation.finished)).then(() => { if (sequence === current) finish(); });
    if (announce) status.textContent = '已重播品牌动效。';
  }
  function sync() {
    const stopped = paused || reduced.matches;
    hero.classList.toggle('is-paused', stopped);
    hero.classList.toggle('is-suspended', !visible || document.hidden);
    if (!shared) document.body.classList.toggle('motion-stopped', stopped);
    toggle.setAttribute('aria-pressed', String(stopped));
    toggle.querySelector('span').textContent = reduced.matches ? '已减少动态效果' : paused ? '继续动效' : '暂停动效';
    toggle.disabled = reduced.matches;
    replay.disabled = !ready || reduced.matches;
    // The shared stop state cancels CSS animations; always reveal the final poster.
    if (stopped) finish();
    else animations.forEach(animation => !visible || document.hidden ? animation.pause() : animation.play());
    if (ready && !introduced && !stopped) play();
  }
  replay.addEventListener('click', () => {
    if (!ready || reduced.matches) return;
    paused = false; shared?.setPaused(false); sync(); play(true);
  });
  toggle.addEventListener('click', () => {
    paused = !paused; shared?.setPaused(paused); sync();
    status.textContent = paused ? '动效已暂停。' : '动效已继续。';
  });
  shared?.subscribe(() => { paused = shared.paused; sync(); });
  reduced.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }, { threshold: 0 }).observe(hero);
  }
  controls.hidden = false; sync();
  let timer;
  const assets = Promise.allSettled([document.fonts.ready, ...[...hero.querySelectorAll('img')].map(image => image.decode())]);
  Promise.race([assets, new Promise(resolve => { timer = setTimeout(resolve, 1800); })]).then(() => { clearTimeout(timer); ready = true; sync(); });
})();
