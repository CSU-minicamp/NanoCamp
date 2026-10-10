// 方案 B+C 高级动效（5项）+ Scrollytelling
(() => {
  if (!document.body.dataset.page || document.body.dataset.page !== 'home') return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return;

  // Scrollytelling: 更新滚动进度条
  let scrollTicking = false;
  function updateScrollProgress() {
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = window.scrollY / scrollHeight;
    document.body.style.setProperty('--scroll-progress', Math.min(progress, 1));
    scrollTicking = false;
  }

  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(updateScrollProgress);
      scrollTicking = true;
    }
  }, { passive: true });

  // Scrollytelling: section 进入视口时淡入增强
  if ('IntersectionObserver' in window) {
    const sections = document.querySelectorAll('main > section');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -100px 0px' });

    sections.forEach((section, i) => {
      section.style.opacity = '0';
      section.style.transform = 'translateY(30px)';
      section.style.transition = `opacity 0.8s ease ${i * 0.1}s, transform 0.8s ease ${i * 0.1}s`;
      observer.observe(section);
    });
  }

  // Scrollytelling: 作品画廊滚动视差错位
  const projectGallery = document.querySelector('.projects-scroll');
  if (projectGallery) {
    const cards = projectGallery.querySelectorAll('.project-card');
    let galleryTicking = false;

    function updateGalleryParallax() {
      const galleryRect = projectGallery.getBoundingClientRect();
      const viewportCenter = window.innerHeight / 2;
      const galleryCenter = galleryRect.top + galleryRect.height / 2;
      const distance = galleryCenter - viewportCenter;
      const maxDistance = window.innerHeight;
      const progress = Math.max(-1, Math.min(1, distance / maxDistance));

      cards.forEach((card, i) => {
        const offset = progress * (i % 2 === 0 ? 20 : -20);
        const currentTransform = card.style.transform || '';
        const baseTransform = currentTransform.replace(/translateY\([^)]+\)/, '').trim();
        card.style.transform = `${baseTransform} translateY(${offset}px)`;
      });

      galleryTicking = false;
    }

    window.addEventListener('scroll', () => {
      if (!galleryTicking) {
        requestAnimationFrame(updateGalleryParallax);
        galleryTicking = true;
      }
    }, { passive: true });
  }

  // #2 磁力吸引 - 作品卡片跟随鼠标倾斜 + 动态高光
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
