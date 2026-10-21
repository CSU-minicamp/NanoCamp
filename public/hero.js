// The hero lives in /intro/. Keep its animations local and respect the parent's
// pause preference without ever hiding text or making navigation depend on JS.
(() => {
  const hero = document.querySelector('.hero-playground');
  if (!hero) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover:hover) and (pointer:fine)');
  let visible = false;
  let entered = false;
  const stopped = () => reduced.matches || document.documentElement.classList.contains('home-motion-paused');
  const reset = () => hero.querySelectorAll('.hero-orbit .home-icon').forEach(icon => icon.style.removeProperty('translate'));
  function sync() {
    hero.classList.toggle('is-motion-visible', visible && !document.hidden && !stopped());
    if (stopped()) {
      reset();
      hero.querySelectorAll('.hero-center>*').forEach(el => el.getAnimations().forEach(animation => animation.cancel()));
    } else if (visible && !document.hidden && !entered) {
      entered = true;
      hero.querySelectorAll('.hero-center>*').forEach((el, index) => el.animate(
        [{ opacity: .4, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 650, delay: index * 65, easing: 'cubic-bezier(.2,.7,.2,1)' }
      ));
    }
  }
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }, { threshold: .1 }).observe(hero);
  reduced.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  hero.addEventListener('pointermove', event => {
    if (stopped() || !fine.matches || !visible) return;
    const rect = hero.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - .5) * 12;
    const y = ((event.clientY - rect.top) / rect.height - .5) * 10;
    hero.querySelectorAll('.hero-orbit .home-icon').forEach((icon, i) => {
      const factor = i % 2 ? -.65 : 1;
      icon.style.translate = `${x * factor}px ${y * factor}px`;
    });
  }, { passive: true });
  hero.addEventListener('pointerleave', reset);
})();
