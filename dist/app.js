(() => {
  const joinDialog = document.getElementById('join-dialog');
  const lightboxDialog = document.getElementById('lightbox-dialog');
  const returnFocus = new WeakMap();

  function openDialog(dialog, trigger) {
    // 手机导航若还开着，先收起（面板由 base.js 渲染）。
    const menu = document.querySelector('[data-nav="mobile"]');
    const menuButton = document.querySelector('[data-menu-toggle]');
    if (menu && menuButton && !menu.hidden) {
      menu.hidden = true;
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', '打开导航菜单');
    }
    returnFocus.set(dialog, trigger);
    document.body.classList.add('modal-open');
    dialog.showModal();
  }

  window.NanoCampDialogs = Object.freeze({ open: openDialog });

  document.addEventListener('click', event => {
    const join = event.target.closest('[data-join]');
    if (join) openDialog(joinDialog, join);
    const close = event.target.closest('[data-close-dialog]');
    if (close) close.closest('dialog').close();
  });

  document.documentElement.classList.remove('no-js');

  // 首页海报文档（/intro/）里没有弹窗，这里允许缺少 dialog 的页面继续复用 app.js。
  [joinDialog, lightboxDialog].filter(Boolean).forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
      if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
      const trigger = returnFocus.get(dialog);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  });

  document.querySelectorAll('[data-copy]').forEach(button => {
    let resetTimer;
    button.addEventListener('click', async () => {
      const status = joinDialog.querySelector('.copy-status');
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        status.textContent = '已复制，可以去联系社区了。';
        button.querySelectorAll('.tap-wave').forEach(wave => wave.remove());
        button.textContent = '已复制 ✓';
        button.classList.add('is-copied');
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => { button.textContent = '复制'; button.classList.remove('is-copied'); }, 2200);
      } catch {
        clearTimeout(resetTimer);
        button.textContent = '复制'; button.classList.remove('is-copied');
        status.textContent = '暂时无法自动复制，请手动复制上方联系方式。';
      }
    });
  });

  function imageFailed(image) {
    const frame = image.closest('.media-frame');
    if (frame) {
      const link=frame.querySelector('.media-open');
      const fallback=frame.querySelector('.media-fallback');
      const hasOriginal=link.tagName==='A' && link.href!==image.src;
      frame.classList.remove('has-image');
      link.hidden=!hasOriginal;
      fallback.hidden=false;
      if(hasOriginal) {
        image.hidden=true;
        frame.classList.add('preview-unavailable');
        fallback.querySelector('.media-placeholder-caption').textContent='预览暂时无法加载，点击查看原图';
      }
    }
    if (image.matches('[data-qr]')) { image.hidden = true; image.nextElementSibling.hidden = false; }
    if (image.matches('.brand-image')) { image.hidden = true; image.nextElementSibling.hidden = false; image.closest('.brand-asset')?.classList.add('is-missing'); }
  }
  document.querySelectorAll('[data-media-image], [data-qr], .brand-image').forEach(image => {
    image.addEventListener('error', () => imageFailed(image));
    if (image.complete && image.naturalWidth === 0) imageFailed(image);
  });

})();
