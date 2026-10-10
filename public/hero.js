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

  // 方案B+C: #5 视差景深 - 首屏纸片鼠标位置分层偏移
  if (reduced.matches) return;

  const iframe = hero.querySelector('iframe');
  if (!iframe) return;

  let mouseX = 0.5, mouseY = 0.5;

  hero.addEventListener('mousemove', (e) => {
    const rect = hero.getBoundingClientRect();
    mouseX = e.clientX / rect.width;
    mouseY = e.clientY / rect.height;
    updateParallax();
  });

  hero.addEventListener('mouseleave', () => {
    mouseX = 0.5;
    mouseY = 0.5;
    updateParallax();
  });

  function updateParallax() {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      const lilac = iframeDoc.querySelector('.b-sheet-lilac');
      const mint = iframeDoc.querySelector('.b-sheet-mint');
      const note = iframeDoc.querySelector('.b-note');

      const offsetX = (mouseX - 0.5) * 40;
      const offsetY = (mouseY - 0.5) * 40;

      if (lilac) {
        lilac.style.transform = `translate(${offsetX * 0.6}px, ${offsetY * 0.6}px) rotate(-4deg)`;
        lilac.style.filter = 'blur(0px)';
      }
      if (mint) {
        mint.style.transform = `translate(${offsetX * 0.4}px, ${offsetY * 0.4}px) rotate(4deg)`;
        mint.style.filter = 'blur(0.3px)';
      }
      if (note) {
        note.style.transform = `translate(${offsetX}px, ${offsetY}px) rotate(-3deg)`;
        note.style.filter = 'blur(0px)';
      }
    } catch (e) {}
  }

  // Scrollytelling: 首屏纸片随滚动缩小 + 透明度降低
  let scrollTicking = false;
  function updateScrollEffect() {
    const scrollY = window.scrollY;
    const heroHeight = hero.offsetHeight;
    const progress = Math.min(scrollY / heroHeight, 1);

    // 纸片缩小 + 透明度
    const scale = 1 - progress * 0.15; // 缩小到 0.85
    const opacity = 1 - progress * 0.6; // 透明度降到 0.4

    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      const sheets = iframeDoc.querySelectorAll('.b-sheet-lilac, .b-sheet-mint, .b-note');
      sheets.forEach(sheet => {
        const currentTransform = sheet.style.transform || '';
        const baseTransform = currentTransform.replace(/scale\([^)]+\)/, '').trim();
        sheet.style.transform = `${baseTransform} scale(${scale})`;
        sheet.style.opacity = opacity;
      });
    } catch (e) {}

    scrollTicking = false;
  }

  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(updateScrollEffect);
      scrollTicking = true;
    }
  }, { passive: true });
})();
