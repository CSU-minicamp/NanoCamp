(() => {
  document.querySelectorAll('[data-copy-email]').forEach(button => {
    const status = button.closest('.collab-email').querySelector('[data-email-status]');
    button.disabled = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await navigator.clipboard.writeText(button.dataset.copyEmail);
        status.textContent = '邮箱已复制';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(button.querySelector('[data-email-value]'));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        status.textContent = '无法自动复制。邮箱已选中，可手动复制。';
      } finally { button.disabled = false; }
    });
  });

  const dialogs = [...document.querySelectorAll('.collab-detail')];
  if (!dialogs.length || typeof HTMLDialogElement === 'undefined' || typeof HTMLDialogElement.prototype.showModal !== 'function') return;

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const records = new WeakMap();
  const useMotion = () => !motionQuery.matches && !window.NanoCampMotion?.stopped && !document.body.classList.contains('motion-stopped');

  function sheetTransform(dialog, trigger) {
    const sheet = trigger.querySelector('.collab-case-sheet');
    if (!sheet) return 'scale(.92)';
    const from = sheet.getBoundingClientRect();
    const to = dialog.getBoundingClientRect();
    const x = from.left + from.width / 2 - to.left - to.width / 2;
    const y = from.top + from.height / 2 - to.top - to.height / 2;
    return `translate(${x}px, ${y}px) scale(${from.width / to.width}, ${from.height / to.height})`;
  }

  function open(dialog, trigger) {
    if (dialog.open) return;
    const record = { trigger, animation: null, closing: false };
    records.set(dialog, record);
    if (window.NanoCampDialogs) window.NanoCampDialogs.open(dialog, trigger);
    else { document.body.classList.add('modal-open'); dialog.showModal(); }
    dialog.scrollTop = 0;
    if (useMotion() && typeof dialog.animate === 'function') {
      record.animation = dialog.animate([
        { transform: sheetTransform(dialog, trigger), opacity: .55, borderRadius: '0px' },
        { transform: 'translate(0, 0) scale(1)', opacity: 1, borderRadius: '14px' },
      ], { duration: 440, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    }
  }

  function close(dialog) {
    const record = records.get(dialog);
    if (!dialog.open || record?.closing) return;
    if (!record || !useMotion() || typeof dialog.animate !== 'function' || !record.trigger.isConnected) { dialog.close(); return; }
    record.closing = true;
    record.animation?.cancel();
    record.animation = dialog.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: sheetTransform(dialog, record.trigger), opacity: 0 },
    ], { duration: 200, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
    record.animation.finished.then(() => { if (dialog.open) dialog.close(); }).catch(() => { if (dialog.open) dialog.close(); });
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-partner-open]');
    if (!trigger || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const dialog = document.getElementById(trigger.dataset.partnerOpen);
    if (!dialogs.includes(dialog)) return;
    event.preventDefault();
    open(dialog, trigger);
  });

  dialogs.forEach(dialog => {
    let backdropPressed = false;
    const outside = event => {
      const rect = dialog.getBoundingClientRect();
      return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    };
    dialog.querySelector('[data-partner-close]')?.addEventListener('click', () => close(dialog));
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(dialog); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(control => !control.hidden && control.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    dialog.addEventListener('pointerdown', event => { backdropPressed = outside(event); });
    dialog.addEventListener('click', event => { if (backdropPressed && outside(event)) close(dialog); backdropPressed = false; });
    dialog.addEventListener('close', () => {
      const record = records.get(dialog);
      record?.animation?.cancel();
      records.delete(dialog);
      if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
      if (record?.trigger.isConnected) record.trigger.focus({ preventScroll: true });
    });
  });

  function finishMotion() {
    if (!useMotion()) dialogs.forEach(dialog => {
      const record = records.get(dialog);
      record?.animation?.cancel();
      if (record?.closing && dialog.open) dialog.close();
    });
  }
  motionQuery.addEventListener('change', finishMotion);
  window.NanoCampMotion?.subscribe(finishMotion);
})();
