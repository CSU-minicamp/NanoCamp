(() => {
  // 「暂停全站动效」按钮已移除：现在只跟随系统的 prefers-reduced-motion。
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const listeners = new Set();
  const waves = new Map();
  const revealTimers = new Map();
  let surfaceFrame = 0;
  let activeSurface;
  let pointerX = 0, pointerY = 0;
  const stopped = () => reduced.matches;

  function removeWave(wave) {
    clearTimeout(waves.get(wave));
    waves.delete(wave);
    wave.remove();
  }
  function finishReveal(element) {
    clearTimeout(revealTimers.get(element));
    revealTimers.delete(element);
    element.classList.remove('reveal-pending', 'is-visible');
    element.style.removeProperty('--reveal-delay');
  }
  function resetSurface() {
    cancelAnimationFrame(surfaceFrame);
    surfaceFrame = 0;
    activeSurface?.style.removeProperty('--spot-x');
    activeSurface?.style.removeProperty('--spot-y');
    activeSurface = null;
  }
  function applyPreference() {
    document.body.classList.toggle('motion-stopped', stopped());
    if (stopped()) {
      waves.forEach((_, wave) => removeWave(wave));
      document.querySelectorAll('.reveal-pending').forEach(finishReveal);
      resetSurface();
    }
    listeners.forEach(listener => listener());
  }
  const motion = Object.freeze({
    get reduced() { return reduced.matches; },
    get stopped() { return stopped(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
  window.NanoCampMotion = motion;
  reduced.addEventListener('change', applyPreference);
  applyPreference();

  // One bounded ripple per control. Keyboard activation starts at the center.
  function addWave(button, clientX, clientY) {
    if (stopped() || document.hidden || !button || button.disabled) return;
    button.querySelectorAll('.tap-wave').forEach(removeWave);
    const box = button.getBoundingClientRect();
    const size = Math.hypot(box.width, box.height) * 2;
    const x = clientX == null ? box.width / 2 : Math.max(0, Math.min(box.width, clientX - box.left));
    const y = clientY == null ? box.height / 2 : Math.max(0, Math.min(box.height, clientY - box.top));
    const wave = document.createElement('span');
    wave.className = 'tap-wave';
    wave.setAttribute('aria-hidden', 'true');
    wave.style.setProperty('--wave-x', `${x}px`);
    wave.style.setProperty('--wave-y', `${y}px`);
    wave.style.setProperty('--wave-size', `${size}px`);
    button.append(wave);
    wave.addEventListener('animationend', () => removeWave(wave), { once: true });
    waves.set(wave, setTimeout(() => removeWave(wave), 700));
  }
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    addWave(event.target.closest('.button'), event.clientX, event.clientY);
  }, { passive: true });
  document.addEventListener('keydown', event => {
    if (event.repeat || !['Enter', ' '].includes(event.key)) return;
    const button = event.target.closest('.button');
    if (event.key === ' ' && button?.tagName !== 'BUTTON') return;
    addWave(button);
  });

  // Pointer light updates once per frame, with no idle animation loop.
  document.querySelectorAll('[data-detail-surface]').forEach(surface => {
    surface.addEventListener('pointermove', event => {
      if (stopped() || !finePointer.matches || event.pointerType === 'touch' || document.hidden) return;
      if (activeSurface !== surface) resetSurface();
      activeSurface = surface;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (surfaceFrame) return;
      surfaceFrame = requestAnimationFrame(() => {
        surfaceFrame = 0;
        if (!activeSurface || stopped() || document.hidden) return;
        const box = activeSurface.getBoundingClientRect();
        activeSurface.style.setProperty('--spot-x', `${(pointerX - box.left).toFixed(1)}px`);
        activeSurface.style.setProperty('--spot-y', `${(pointerY - box.top).toFixed(1)}px`);
      });
    }, { passive: true });
    surface.addEventListener('pointerleave', () => { if (activeSurface === surface) resetSurface(); });
  });
  finePointer.addEventListener('change', resetSurface);

  const header = document.querySelector('.site-header');
  const progress = document.querySelector('[data-reading-progress]');
  let scrollFrame = 0;
  function paintProgress() {
    scrollFrame = 0;
    const range = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const value = range > 0 ? Math.min(1, Math.max(0, scrollY / range)) : 0;
    progress.style.setProperty('--read-progress', value.toFixed(4));
    header.classList.toggle('is-scrolled', scrollY > 12);
  }
  function scheduleProgress() { if (!scrollFrame && !document.hidden) scrollFrame = requestAnimationFrame(paintProgress); }
  progress.hidden = false;
  window.addEventListener('scroll', scheduleProgress, { passive: true });
  window.addEventListener('resize', scheduleProgress, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(scheduleProgress).observe(document.body);
  scheduleProgress();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      waves.forEach((_, wave) => removeWave(wave));
      resetSurface();
      cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
    } else scheduleProgress();
  });

  // Only below-the-fold elements enter; markup remains complete without JS.
  if ('IntersectionObserver' in window && !stopped()) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        if (stopped()) { finishReveal(entry.target); return; }
        entry.target.classList.add('is-visible');
        revealTimers.set(entry.target, setTimeout(() => finishReveal(entry.target), 1000));
      });
    }, { threshold: .06, rootMargin: '0px 0px -20px 0px' });
    document.querySelectorAll('.section-top, .values-row article, .event-panel, .project-card, .moments-grid figure, .event-gallery figure, .recap-body, .origin-copy, .belief-list article, .welcome-type, .join-inner > div:first-child, .event-detail-facts > div').forEach(element => {
      if (element.getBoundingClientRect().top < innerHeight * .94 || element.parentElement.closest('.reveal-pending')) return;
      element.classList.add('reveal-pending');
      const order = [...element.parentElement.children].indexOf(element);
      element.style.setProperty('--reveal-delay', `${Math.min(order, 2) * 65}ms`);
      observer.observe(element);
    });
    document.addEventListener('focusin', event => {
      const pending = event.target.closest('.reveal-pending');
      if (pending) { observer.unobserve(pending); finishReveal(pending); }
    });
  }
})();
