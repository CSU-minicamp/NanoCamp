(() => {
  const hero = document.querySelector('[data-brand-hero]');
  if (!hero) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let timer;
  let played = false;

  function play() {
    if (played || reduced.matches || document.hidden) return;
    played = true;
    hero.classList.add('is-intro');
  }

  // Wait for the fonts and the two brand images, capped so a slow asset cannot hold the poster back.
  const assets = Promise.allSettled([document.fonts.ready, ...[...hero.querySelectorAll('img')].map(image => image.decode())]);
  Promise.race([assets, new Promise(resolve => { timer = setTimeout(resolve, 1800); })]).then(() => {
    clearTimeout(timer);
    if (hero.getBoundingClientRect().bottom > 0) play();
    else if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();
        play();
      }, { threshold: 0 });
      observer.observe(hero);
    }
  });
})();
