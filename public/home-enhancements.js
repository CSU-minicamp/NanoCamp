/* ============================================================================
   首页美化增强脚本 - 5个区块优化
   ============================================================================ */

(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return;

  // --- 区块 3: 社区生态三行 - 绿色竖条动画增强 ---
  const communityRows = document.querySelectorAll('.community-row');
  communityRows.forEach(row => {
    row.addEventListener('mouseenter', () => {
      row.style.transition = 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
    });
  });

  // --- 区块 5: 页尾便签 - 钉子弹出效果 ---
  const joinPaper = document.querySelector('.join-paper');
  if (joinPaper && !joinPaper.dataset.enhanced) {
    joinPaper.dataset.enhanced = 'true';

    // 移除旧的 ::before (如果有)
    const style = document.createElement('style');
    style.textContent = `
      @media (hover: hover) and (pointer: fine) {
        body[data-page="home"] .join-paper::before {
          transform: rotate(25deg) scale(1);
          transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        body[data-page="home"] .join-paper:hover::before {
          transform: rotate(45deg) translateY(-6px) scale(1.15);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // --- Scrollytelling: Section 淡入效果 ---
  if ('IntersectionObserver' in window) {
    const sections = document.querySelectorAll('.section, .community-ecosystem, .community-intro-strip, .join-section');

    sections.forEach((section, index) => {
      section.style.opacity = '0';
      section.style.transform = 'translateY(30px)';
      section.style.transition = `opacity 0.6s ease-out ${index * 0.1}s, transform 0.6s ease-out ${index * 0.1}s`;
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    sections.forEach(section => observer.observe(section));
  }

  // --- 滚动进度条 ---
  function updateScrollProgress() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = Math.min(scrollTop / docHeight, 1);
    document.documentElement.style.setProperty('--scroll-progress', progress);
  }

  let scrollTicking = false;
  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(() => {
        updateScrollProgress();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  });
  updateScrollProgress();

  // --- 作品画廊惯性滚动 + 卡片避让 ---
  const showcase = document.querySelector('[data-nc-showcase]');
  if (showcase) {
    const track = showcase.querySelector('.nc-track');
    const cards = showcase.querySelectorAll('.project-card');

    if (track && cards.length > 0) {
      let velocity = 0;
      let isDragging = false;
      let startX = 0;
      let scrollLeft = 0;

      // 滚轮惯性
      showcase.addEventListener('wheel', (e) => {
        e.preventDefault();
        velocity = e.deltaY * 1.2;

        function inertiaScroll() {
          if (Math.abs(velocity) < 0.5) {
            velocity = 0;
            return;
          }
          track.scrollLeft += velocity;
          velocity *= 0.92;
          requestAnimationFrame(inertiaScroll);
        }

        inertiaScroll();
      }, { passive: false });

      // 卡片避让效果
      cards.forEach(card => {
        card.addEventListener('mouseenter', () => {
          const cardRect = card.getBoundingClientRect();
          const cardCenter = cardRect.left + cardRect.width / 2;

          cards.forEach(otherCard => {
            if (otherCard === card) return;

            const otherRect = otherCard.getBoundingClientRect();
            const otherCenter = otherRect.left + otherRect.width / 2;
            const distance = Math.abs(cardCenter - otherCenter);

            if (distance < 400) {
              const direction = otherCenter < cardCenter ? -1 : 1;
              const scale = 0.94;
              otherCard.style.transform = `scale(${scale}) translateY(8px)`;
              otherCard.style.opacity = '0.7';
              otherCard.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease';
            }
          });

          card.style.transform = 'scale(1.08) translateY(-8px)';
          card.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        });

        card.addEventListener('mouseleave', () => {
          cards.forEach(c => {
            c.style.transform = '';
            c.style.opacity = '';
          });
        });
      });
    }
  }

})();
