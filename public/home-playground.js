(() => {
  const box = document.querySelector('[data-jukebox]');
  if (!box) return;
  const picker = box.querySelector('[data-record-picker]');
  const tabs = [...box.querySelectorAll('[data-record]')];
  const panels = [...box.querySelectorAll('[data-record-panel]')];
  const screens = [...box.querySelectorAll('[data-record-screen]')];
  if (!tabs.length || tabs.length !== panels.length || tabs.length !== screens.length) return;
  picker.setAttribute('role', 'tablist');
  const colors = ['#79adf2', '#7ed0b0', '#b5a1e9', '#efa786', '#ecd075', '#e9a4c0'];
  // Keep the detail link usable even if a published cover later goes missing.
  screens.forEach(screen => {
    const image = screen.querySelector('img');
    if (!image) return;
    const unavailable = () => {
      const note = document.createElement('span');
      note.className = 'record-placeholder';
      note.textContent = '封面暂时无法加载，点击查看作品';
      image.replaceWith(note);
    };
    image.addEventListener('error', unavailable, { once: true });
    if (image.complete && !image.naturalWidth) unavailable();
  });
  let current = 0;
  const position = box.querySelector('[data-record-position]');
  function select(index, focus = false) {
    current = index;
    if (position) position.textContent = `${String(index + 1).padStart(2, '0')} / ${String(tabs.length).padStart(2, '0')}`;
    tabs.forEach((tab, i) => {
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].setAttribute('role', 'tabpanel');
      panels[i].setAttribute('aria-labelledby', tab.id);
      panels[i].tabIndex = 0;
      panels[i].hidden = i !== index;
      screens[i].hidden = i !== index;
    });
    box.style.setProperty('--playing-color', colors[index % colors.length]);
    if (box.classList.contains('is-ready') && !document.documentElement.classList.contains('home-motion-paused') && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      [panels[index], screens[index]].forEach(el => {
        el.getAnimations().forEach(animation => animation.cancel());
        el.animate([{ opacity: .3, translate: '0 7px' }, { opacity: 1, translate: '0 0' }], { duration: 330, easing: 'ease-out' });
      });
    }
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      select(next, true);
    });
  });
  box.querySelector('[data-record-prev]')?.addEventListener('click', () => select((current - 1 + tabs.length) % tabs.length));
  box.querySelector('[data-record-next]')?.addEventListener('click', () => select((current + 1) % tabs.length));
  const transport = box.querySelector('[data-record-transport]');
  if (transport) transport.hidden = false;
  select(0);
  picker.hidden = false;
  box.querySelector('[data-record-hint]').hidden = false;
  box.classList.add('is-ready');
})();

// Follow the system motion preference; animate visible sections and one-time entrances.
(() => {
  if (document.body.dataset.page !== 'home') return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  const frame = document.querySelector('.home-hero-frame');
  const visible = new Set();
  const entered = new WeakSet();
  const entrances = new Set();
  const stopped = () => reduced.matches;
  function sync() {
    const disabled = stopped();
    root.classList.toggle('home-motion-paused', disabled);
    try { frame?.contentDocument?.documentElement.classList.toggle('home-motion-paused', disabled); } catch {}
    visible.forEach(el => el.classList.toggle('is-motion-visible', !disabled && !document.hidden));
    if (disabled) {
      entrances.forEach(animation => animation.cancel());
      entrances.clear();
      document.querySelectorAll('[data-record-panel],[data-record-screen]').forEach(el => el.getAnimations().forEach(a => a.cancel()));
    }
  }
  frame?.addEventListener('load', sync);
  reduced.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const el = entry.target;
        if (entry.isIntersecting) {
          visible.add(el);
          if (!entered.has(el) && !stopped() && !document.hidden) {
            entered.add(el);
            // Finite, cancellable animation; default HTML/CSS remains fully visible.
            const animation = el.animate([{ opacity: .65, translate: '0 20px' }, { opacity: 1, translate: '0 0' }], { duration: 600, easing: 'cubic-bezier(.2,.7,.2,1)' });
            entrances.add(animation);
            animation.finished.then(() => entrances.delete(animation), () => entrances.delete(animation));
          }
        } else {
          visible.delete(el);
          el.classList.remove('is-motion-visible');
        }
      });
      sync();
    }, { threshold: .12 });
    document.querySelectorAll('.play-paths>a,.camp-memory,.camp-story,.jukebox,.join-copy,.join-paper').forEach(el => observer.observe(el));
  }
  sync();
})();
