// 首页作品横滑区：默认自动从右往左匀速滚动，鼠标悬停（或键盘聚焦、拖拽、切到别的标签页）时暂停，
// 箭头用来手动翻一张。滚动仍然走原生 overflow 容器（触控板、触摸、聚焦后方向键都能用）。
//
// 无缝循环：构建时多渲染了一组副本卡片，滚过一整组的宽度后把 scrollLeft 减去组宽，
// 画面完全对得上，所以看不到"倒带"。参数来自 content/home-showcase.scroll.json，
// 由 src/home-showcase.mjs 写进 data-* 属性。
(() => {
  const scroller = document.querySelector('[data-projects-scroller]');
  if (!scroller) return;
  const track = scroller.querySelector('[data-projects-track]');
  if (!track) return;
  const prev = scroller.querySelector('[data-scroll-prev]');
  const next = scroller.querySelector('[data-scroll-next]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const speed = Number(scroller.dataset.autoscroll) || 0;
  const pauseOnHover = scroller.hasAttribute('data-pause-on-hover');
  const loops = scroller.hasAttribute('data-loop');

  // 容器带一点左右内边距，静态位置会停在 padding 处（实测 2px），判断"到最左"要把它算进去。
  const restOffset = () => (parseFloat(getComputedStyle(track).paddingLeft) || 0) + 1;

  // 自己维护的浮点滚动位置。不能每帧读回 track.scrollLeft 再累加：浏览器会把 scrollLeft
  // 吸附到物理像素栅格（dpr 1.5 时栅格 0.667px），30px/s 每帧只加 0.5px，读回来永远是同一个数，
  // 结果就是 tick 一直在跑、scrollLeft 却纹丝不动——只有一次跳几百像素的箭头能动。
  let position = 0;
  const adoptExternalScroll = () => {
    // 阈值要比像素栅格（<1px）和 scroll 事件合并带来的滞后都大，否则会把浮点累加又抹平。
    if (Math.abs(track.scrollLeft - position) > 3) position = track.scrollLeft;
  };

  // 一组卡片的宽度 = 第一张副本卡与第一张真卡的左边缘之差。
  const groupWidth = () => {
    const all = [...track.querySelectorAll('.project-card')];
    const real = all.find(card => !card.hasAttribute('aria-hidden'));
    const clone = all.find(card => card.hasAttribute('aria-hidden'));
    if (!real || !clone) return track.scrollWidth;
    return clone.getBoundingClientRect().left - real.getBoundingClientRect().left;
  };

  const sync = () => {
    // 用户拖动、滚轮、点箭头以及窗口尺寸变化都会让位置跳变，这时采纳浏览器的值；
    // 自己每帧 0.x px 的推进不会被采纳，浮点位置也就不会被像素吸附吃掉。
    adoptExternalScroll();
    // 减少动效时 CSS 会把副本卡片收起来，这时当成普通横滑区处理（箭头仍要有到头禁用）。
    if (loops && !reduced.matches) {
      // 右边永远还有副本，所以只有"最左"需要一个边界。
      if (prev) prev.disabled = track.scrollLeft <= restOffset();
      if (next) next.disabled = false;
      scroller.classList.remove('is-static');
      return;
    }
    const max = track.scrollWidth - track.clientWidth;
    scroller.classList.toggle('is-static', max <= restOffset());
    if (prev) prev.disabled = track.scrollLeft <= restOffset();
    if (next) next.disabled = track.scrollLeft >= max - 1;
  };

  const step = () => {
    const card = track.querySelector('.project-card');
    if (!card) return track.clientWidth;
    return card.getBoundingClientRect().width + (parseFloat(getComputedStyle(track).columnGap) || 0);
  };

  const go = direction => track.scrollBy({ left: direction * step(), behavior: reduced.matches ? 'auto' : 'smooth' });
  if (prev) prev.addEventListener('click', () => go(-1));
  if (next) next.addEventListener('click', () => go(1));
  track.addEventListener('scroll', sync, { passive: true });
  addEventListener('resize', sync);
  // 老浏览器只有已废弃的 addListener；这里做特性判断，避免初始化在这一行整体中断
  // （一旦中断，就是"箭头还能点、但完全不会自动滚"）。
  if (typeof reduced.addEventListener === 'function') reduced.addEventListener('change', sync);
  else if (typeof reduced.addListener === 'function') reduced.addListener(sync);
  sync();
  position = track.scrollLeft;

  // data-autoscroll 缺失或值为 0、或者用户要求减少动效时，就只当一个普通横滑区。
  // 同时把状态写在元素上，"为什么不滚"这类问题在 DevTools 里一眼能看出来。
  if (!speed || reduced.matches) {
    scroller.dataset.autoscrollState = 'off';
    if (reduced.matches) console.info('[projects-scroll] 系统开启了「减少动效」，按无障碍惯例停用了自动滚动。');
    return;
  }

  // 暂停条件分开记，任意一条成立就停住；这样悬停结束、焦点移出后能各自恢复。
  const state = { hovering: false, focused: false, dragging: false, hidden: document.hidden };
  const paused = () => state.hovering || state.focused || state.dragging || state.hidden;

  // 第一帧只记时间不推进；用 null 而不是 0 当哨兵，否则时间戳恰好为 0 时第二帧会被跳过。
  // 时长取自 performance.now() 这个单调时钟，而不是 rAF 回调参数——后者在个别环境里会不变。
  let last = null;
  let rafAlive = false;
  const tick = () => {
    const now = performance.now();
    const phase = paused() ? 'paused' : 'running';
    if (scroller.dataset.autoscrollState !== phase) scroller.dataset.autoscrollState = phase;
    const elapsed = last === null ? 0 : Math.min(now - last, 100);
    last = now;
    if (!elapsed || paused()) return;
    position += speed * elapsed / 1000;
    if (loops) {
      const group = groupWidth();
      if (group > 0 && position >= group) position -= group;
    }
    track.scrollLeft = position;
  };

  // 首选 requestAnimationFrame：跟显示刷新同步，动起来最顺。
  const frame = () => { rafAlive = true; requestAnimationFrame(frame); tick(); };
  requestAnimationFrame(frame);

  // 兜底：少数环境里 rAF 一帧都不触发（页面被判不可见、被节流、嵌在某些 webview 中），
  // 表现就是"卡片完全不动，只有点箭头才动"。这里 600ms 等不到帧就改用定时器驱动；
  // rAF 只要活着，定时器第一次执行就会自己退出。
  setTimeout(() => {
    const timer = setInterval(() => {
      if (rafAlive) { clearInterval(timer); return; }
      tick();
    }, 16);
  }, 600);

  if (pauseOnHover) {
    scroller.addEventListener('pointerenter', () => { state.hovering = true; });
    scroller.addEventListener('pointerleave', () => { state.hovering = false; });
  }
  track.addEventListener('focusin', () => { state.focused = true; });
  track.addEventListener('focusout', event => { if (!track.contains(event.relatedTarget)) state.focused = false; });
  track.addEventListener('pointerdown', () => { state.dragging = true; });
  addEventListener('pointerup', () => { state.dragging = false; });
  addEventListener('pointercancel', () => { state.dragging = false; });
  document.addEventListener('visibilitychange', () => { state.hidden = document.hidden; });
})();
