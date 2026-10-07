(() => {
  const builder = document.querySelector('[data-brief-builder][data-brief-live]');
  if (!builder) return;
  const form = builder.querySelector('[data-brief-form]');
  const preview = builder.querySelector('.brief-preview');
  const output = builder.querySelector('[data-brief-output]');
  const letter = builder.querySelector('[data-brief-letter]');
  const readiness = builder.querySelector('[data-letter-readiness]');
  const returnButton = builder.querySelector('[data-brief-return]');
  const disclosure = builder.closest('details');
  const summary = disclosure?.querySelector(':scope > summary');
  const draftContent = disclosure?.querySelector('.collab-draft-content');
  if (!form || !output || !letter || !readiness || !summary || !draftContent) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set();
  const fieldAnimations = new Map();
  const defaults = {
    topic: '一份合作想法，等你写下。', organization: '学校、社团或团队待补充',
    audience: '待一起确认', timing: '待一起确认',
    notes: '希望讨论的问题、可以提供的支持，都可以写在这里。',
  };
  const names = ['kind', 'format', 'organization', 'topic', 'audience', 'timing', 'notes'];
  const values = () => Object.fromEntries(names.map(name => [name, form.elements.namedItem(name).value.trim()]));
  const motionAllowed = () => !reduced.matches && !window.NanoCampMotion?.stopped && !document.hidden;
  let previous = null, inkTimer, exportTimer;
  let panelAnimation = null;
  let requestedOpen = disclosure.open;

  function animate(element, frames, options) {
    if (!element || !motionAllowed() || typeof element.animate !== 'function') return;
    const animation = element.animate(frames, { easing: 'cubic-bezier(.16,1,.3,1)', ...options });
    animations.add(animation);
    animation.finished.catch(() => {}).finally(() => animations.delete(animation));
    return animation;
  }
  function stopSheetMotion() {
    clearTimeout(inkTimer);
    animations.forEach(animation => animation.cancel());
    animations.clear();
    fieldAnimations.clear();
  }
  function settleDisclosure() {
    const animation = panelAnimation;
    panelAnimation = null;
    animation?.cancel();
    disclosure.open = requestedOpen;
    disclosure.style.removeProperty('height');
    disclosure.removeAttribute('data-brief-transition');
    summary.removeAttribute('aria-expanded');
    draftContent.inert = false;
  }
  function stopMotion() {
    stopSheetMotion();
    if (panelAnimation) settleDisclosure();
  }
  function transitionDisclosure(open) {
    // Read the current frame before cancelling: a second click reverses smoothly.
    const from = disclosure.getBoundingClientRect().height;
    const reversing = Boolean(panelAnimation);
    panelAnimation?.cancel();
    panelAnimation = null;
    requestedOpen = open;
    if (!motionAllowed() || typeof disclosure.animate !== 'function') {
      settleDisclosure();
      return;
    }
    if (!open && draftContent.contains(document.activeElement)) summary.focus({ preventScroll: true });
    draftContent.inert = !open;
    disclosure.dataset.briefTransition = open ? 'opening' : 'closing';
    summary.setAttribute('aria-expanded', String(open));
    // Keep native content rendered until the closing transition has finished.
    disclosure.open = true;
    disclosure.style.height = 'auto';
    const style = getComputedStyle(disclosure);
    const to = open ? disclosure.getBoundingClientRect().height :
      summary.getBoundingClientRect().height + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    disclosure.style.height = `${from}px`;
    const animation = disclosure.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: open ? 520 : 340,
      easing: 'cubic-bezier(.22,1,.36,1)',
    });
    panelAnimation = animation;
    animation.finished.then(() => {
      if (panelAnimation === animation) settleDisclosure();
    }, () => {});
    if (open && !reversing) unfold();
    else if (!open) stopSheetMotion();
  }
  function resetExport() {
    clearTimeout(exportTimer);
    preview.removeAttribute('data-export');
    builder.querySelector('[data-brief-copy-label]').textContent = '复制草稿';
    builder.querySelector('[data-brief-download-label]').textContent = '下载文本';
  }
  function showLetter() {
    output.hidden = true;
    letter.hidden = false;
    returnButton.hidden = true;
    preview.classList.remove('is-manual-copy');
  }
  function sync(detail) {
    const data = detail.values;
    const changed = [];
    names.forEach(name => {
      const text = data[name] || defaults[name] || '';
      const destination = letter.querySelector(`[data-letter-value="${name}"]`);
      if (destination.textContent !== text) destination.textContent = text;
      destination.classList.toggle('is-empty', !data[name]);
      if (previous && previous[name] !== data[name]) changed.push(name);
    });
    const ready = Boolean(detail.ready);
    readiness.querySelector('span').textContent = ready ? '主题已写好，可以带走这份草稿。' : '写下主题后，即可复制或下载。';
    readiness.classList.toggle('is-complete', ready);
    showLetter();
    resetExport();
    if (changed.length) {
      clearTimeout(inkTimer);
      inkTimer = setTimeout(() => {
        changed.forEach(name => {
          fieldAnimations.get(name)?.cancel();
          const block = letter.querySelector(`[data-letter-for="${name}"]`);
          const animation = animate(block, [
            { backgroundColor: '#bddecb66' }, { backgroundColor: 'transparent' },
          ], { duration: 520 });
          if (animation) fieldAnimations.set(name, animation);
        });
      }, 140);
    }
    previous = { ...data };
  }
  function unfold() {
    stopSheetMotion();
    if (!disclosure.open) return;
    const sheets = [form, preview];
    sheets.forEach((sheet, index) => animate(sheet, [
      { transform: `perspective(1000px) rotateX(${index ? -6 : 8}deg) translateY(18px)`, opacity: .65, clipPath: 'inset(0 0 8% 0)', boxShadow: '0 5px 8px -6px #45365722' },
      { transform: 'perspective(1000px) rotateX(0deg) translateY(0)', opacity: 1, clipPath: 'inset(-40px -20px -40px -20px)', boxShadow: '0 17px 32px -22px #45365755' },
    ], { duration: 560, delay: index * 70 }));
    animate(form.querySelector('.brief-pen'), [
      { transform: 'rotate(-12deg) translateY(4px)' }, { transform: 'rotate(0) translateY(0)' },
    ], { duration: 480, delay: 100 });
  }
  form.addEventListener('focusin', event => {
    const name = event.target.name;
    letter.querySelectorAll('.is-current').forEach(element => element.classList.remove('is-current'));
    if (names.includes(name)) letter.querySelector(`[data-letter-for="${name}"]`)?.classList.add('is-current');
  });
  form.addEventListener('focusout', event => {
    if (!form.contains(event.relatedTarget)) letter.querySelectorAll('.is-current').forEach(element => element.classList.remove('is-current'));
  });
  builder.addEventListener('brief:update', event => sync(event.detail));
  builder.addEventListener('brief:feedback', event => {
    const { message, kind, action } = event.detail;
    if (!message) return;
    if (action === 'manual') {
      letter.hidden = true;
      returnButton.hidden = false;
      return;
    }
    if (kind !== 'success') return;
    const status = builder.querySelector('[data-brief-status]');
    animate(status, [{ opacity: .45, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220 });
    if (!['copy', 'download'].includes(action)) return;
    resetExport();
    preview.dataset.export = action;
    builder.querySelector(`[data-brief-${action}-label]`).textContent = action === 'copy' ? '已复制' : '已发起下载';
    const check = builder.querySelector(`[data-brief-${action}] .brief-action-check path`);
    animate(check, [{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }], { duration: 300 });
    exportTimer = setTimeout(resetExport, 2400);
  });
  returnButton.addEventListener('click', () => {
    showLetter();
    builder.querySelector('[data-brief-status]').textContent = '';
    builder.querySelector('[data-brief-copy]').focus({ preventScroll: true });
  });
  builder.querySelector('.brief-mobile-preview').addEventListener('click', event => {
    event.preventDefault();
    preview.scrollIntoView({ block: 'start', behavior: motionAllowed() ? 'smooth' : 'instant' });
    letter.focus({ preventScroll: true });
  });
  summary.addEventListener('click', event => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    transitionDisclosure(!requestedOpen);
  });
  disclosure.addEventListener('toggle', () => {
    // A programmatic native toggle must also release any temporary clipping.
    if (panelAnimation) {
      if (!disclosure.open) {
        requestedOpen = false;
        stopMotion();
      }
      return;
    }
    requestedOpen = disclosure.open;
    draftContent.inert = false;
    if (disclosure.open) unfold();
    else stopSheetMotion();
  });
  reduced.addEventListener('change', stopMotion);
  window.NanoCampMotion?.subscribe(() => { if (!motionAllowed()) stopMotion(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopMotion(); });
  window.addEventListener('resize', () => { if (panelAnimation) stopMotion(); });
  preview.classList.add('is-letter-enhanced');
  readiness.hidden = false;
  const initial = values();
  sync({ values: initial, ready: Boolean(initial.topic) });
})();
