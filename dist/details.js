(() => {
  // 「暂停全站动效」按钮已移除：现在只跟随系统的 prefers-reduced-motion。
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const listeners = new Set();
  const waves = new Map();
  let surfaceFrame = 0;
  let activeSurface;
  let pointerX = 0, pointerY = 0;
  const stopped = () => reduced.matches;

  function removeWave(wave) {
    clearTimeout(waves.get(wave));
    waves.delete(wave);
    wave.remove();
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

  // 页头滚动状态：只切 is-scrolled（原来的进度条已去除，不再需要每帧算比例）。
  const header = document.querySelector('.site-header');
  let scrollFrame = 0;
  function paintScrollState() {
    scrollFrame = 0;
    header.classList.toggle('is-scrolled', scrollY > 12);
  }
  function scheduleScrollState() { if (!scrollFrame && !document.hidden) scrollFrame = requestAnimationFrame(paintScrollState); }
  window.addEventListener('scroll', scheduleScrollState, { passive: true });
  scheduleScrollState();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      waves.forEach((_, wave) => removeWave(wave));
      resetSurface();
      cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
    } else scheduleScrollState();
  });

})();
