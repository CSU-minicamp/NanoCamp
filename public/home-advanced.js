// 首页作品卡片的高级鼠标动效（仅首页加载）
(() => {
  if (!document.body.dataset.page || document.body.dataset.page !== 'home') return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return;

  // 磁力吸引 - 作品卡片跟随鼠标倾斜 + 动态高光（高光样式见 interactions.css 的 .nc-shine）
  const projectCards = document.querySelectorAll('.project-card');
  projectCards.forEach(card => {
    const shine = document.createElement('div');
    shine.className = 'nc-shine';
    card.style.position = 'relative';
    card.appendChild(shine);

    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateY = ((x - centerX) / centerX) * 8;
      const rotateX = ((centerY - y) / centerY) * 8;

      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px)`;

      const mediaFrame = card.querySelector('.media-frame');
      if (mediaFrame) {
        mediaFrame.style.transform = `rotateX(${-rotateX * 0.5}deg) rotateY(${-rotateY * 0.5}deg) translateY(-8px)`;
      }

      const mouseX = (x / rect.width) * 100;
      const mouseY = (y / rect.height) * 100;
      shine.style.setProperty('--mouse-x', `${mouseX}%`);
      shine.style.setProperty('--mouse-y', `${mouseY}%`);
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      const mediaFrame = card.querySelector('.media-frame');
      if (mediaFrame) mediaFrame.style.transform = '';
    });
  });
})();
