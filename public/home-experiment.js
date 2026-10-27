// 纯装饰层：导航和内容都不依赖这个脚本。
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover:hover) and (pointer:fine)');
  const canvas = document.querySelector('.hero-constellation');
  if (canvas) {
    const context = canvas.getContext('2d');
    const hero = canvas.closest('.hero-playground');
    if (!context || !hero) return;
    let width = 0, height = 0, frame = 0, last = 0, visible = false;
    let dots = [];
    const pointer = { x: -1000, y: -1000 };
    const stopped = () => reduced.matches || document.hidden || !visible;
    function draw(time = 0) {
      context.clearRect(0, 0, width, height);
      const t = reduced.matches ? 0 : time / 1000;
      const positions = dots.map(dot => ({
        x: dot.x * width + Math.sin(t * .16 + dot.phase) * 9,
        y: dot.y * height + Math.cos(t * .13 + dot.phase) * 11,
        size: dot.size,
      }));
      positions.forEach((dot, i) => {
        // 标题区压暗一点，点阵只当背景框住文字。
        const central = dot.x > width * .27 && dot.x < width * .73 && dot.y > height * .25 && dot.y < height * .75;
        context.fillStyle = central ? 'rgba(199,207,255,.13)' : 'rgba(199,221,255,.55)';
        context.beginPath();context.arc(dot.x, dot.y, dot.size, 0, Math.PI * 2);context.fill();
        for (let j = i + 1; j < positions.length; j++) {
          const other = positions[j];
          const distance = Math.hypot(dot.x - other.x, dot.y - other.y);
          if (distance > 95 || central) continue;
          context.strokeStyle = `rgba(154,188,229,${(1 - distance / 95) * .13})`;
          context.lineWidth = .7;
          context.beginPath();context.moveTo(dot.x, dot.y);context.lineTo(other.x, other.y);context.stroke();
        }
        const near = Math.hypot(dot.x - pointer.x, dot.y - pointer.y);
        if (!reduced.matches && fine.matches && near < 150) {
          context.strokeStyle = `rgba(167,239,210,${(1 - near / 150) * .35})`;
          context.beginPath();context.moveTo(dot.x, dot.y);context.lineTo(pointer.x, pointer.y);context.stroke();
        }
      });
    }
    function tick(time) {
      frame = 0;
      if (stopped()) return;
      if (time - last >= 33) { draw(time); last = time; }
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame);frame = 0;
      if (stopped()) { pointer.x = pointer.y = -1000; draw(); }
      else frame = requestAnimationFrame(tick);
    }
    function resize() {
      width = canvas.clientWidth;height = canvas.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      // 位置由公式算出：窗口变大变小不会把点重新洗牌。
      dots = Array.from({ length: width < 700 ? 30 : 58 }, (_, i) => ({
        x: ((i * 61 + 17) % 997) / 997,
        y: ((i * 137 + 53) % 991) / 991,
        phase: i * .81, size: i % 7 === 0 ? 1.8 : .9,
      }));
      draw();
    }
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize, { passive: true });
    if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;sync();
    }, { threshold: .05 }).observe(hero);
    hero.addEventListener('pointermove', event => {
      if (stopped() || !fine.matches) return;
      const bounds = canvas.getBoundingClientRect();
      pointer.x = event.clientX - bounds.left;pointer.y = event.clientY - bounds.top;
    }, { passive: true });
    hero.addEventListener('pointerleave', () => { pointer.x = pointer.y = -1000; });
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    resize();
    return;
  }

  if (document.body.dataset.page !== 'home') return;
  const ribbon = document.querySelector('.idea-ribbon');
  let ribbonVisible = false;
  function syncRibbon() {
    ribbon?.classList.toggle('is-experiment-visible', ribbonVisible && !document.hidden && !reduced.matches);
  }
  if (ribbon && 'IntersectionObserver' in window) new IntersectionObserver(entries => {
    ribbonVisible = entries[0].isIntersecting;syncRibbon();
  }).observe(ribbon);
  document.addEventListener('visibilitychange', syncRibbon);
  reduced.addEventListener('change', syncRibbon);

  document.querySelectorAll('.play-paths>a,.camp-memory').forEach(surface => {
    let pending = 0;
    let pointer;
    function reset() {
      cancelAnimationFrame(pending);pending = 0;
      ['--depth-x', '--depth-y', '--light-x', '--light-y'].forEach(name => surface.style.removeProperty(name));
    }
    function sync() { reset();surface.classList.toggle('has-depth', fine.matches && !reduced.matches); }
    surface.addEventListener('pointermove', event => {
      if (!fine.matches || reduced.matches) return;
      pointer = { x: event.clientX, y: event.clientY };
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const bounds = surface.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (pointer.x - bounds.left) / bounds.width));
        const y = Math.max(0, Math.min(1, (pointer.y - bounds.top) / bounds.height));
        surface.style.setProperty('--depth-x', `${(y - .5) * -7}deg`);
        surface.style.setProperty('--depth-y', `${(x - .5) * 7}deg`);
        surface.style.setProperty('--light-x', `${x * 100}%`);
        surface.style.setProperty('--light-y', `${y * 100}%`);
      });
    }, { passive: true });
    surface.addEventListener('pointerleave', reset);
    surface.addEventListener('blur', reset);
    reduced.addEventListener('change', sync);fine.addEventListener('change', sync);
    document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
    sync();
  });
})();

// 这条路径只是装饰：原生滚动和整页内容都不依赖它。
(() => {
  const flow = document.querySelector('[data-home-flow]');
  if (!flow) return;
  const svg = flow.querySelector('[data-home-thread]');
  const track = svg?.querySelector('[data-thread-track]');
  const ink = svg?.querySelector('[data-thread-ink]');
  const signal = svg?.querySelector('[data-thread-signal]');
  const about = flow.querySelector('.play-about');
  const camp = flow.querySelector('.play-camp');
  const projects = flow.querySelector('.play-projects');
  if (!track || !ink || !signal || !about || !camp || !projects) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const frame = document.querySelector('.home-hero-frame');
  const photo = flow.querySelector('.camp-memory');
  let length = 0, pending = 0, height = 0;

  function render() {
    pending = 0;
    if (document.hidden || !length) return;
    const bounds = flow.getBoundingClientRect();
    const y = Math.max(0, Math.min(height, innerHeight * .62 - bounds.top));
    if (reduced.matches) {
      ink.style.strokeDashoffset = '0';
      signal.style.display = 'none';
    } else {
      // 用二分法在单调曲线上找当前阅读位置（拐弯段也算对），别整条扫。
      let low = 0, high = length;
      for (let i = 0; i < 12; i++) {
        const middle = (low + high) / 2;
        if (track.getPointAtLength(middle).y < y) low = middle;
        else high = middle;
      }
      const distance = (low + high) / 2;
      const point = track.getPointAtLength(distance);
      ink.style.strokeDashoffset = String(length - distance);
      signal.setAttribute('transform', `translate(${point.x} ${point.y})`);
      signal.style.display = y > 0 && y < height ? '' : 'none';
    }
    if (photo) {
      const photoBounds = photo.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, (innerHeight - photoBounds.top) / (innerHeight + photoBounds.height)));
      photo.style.setProperty('--memory-angle', `${reduced.matches ? -3 : -5 + progress * 5}deg`);
    }
    try {
      const hero = frame?.getBoundingClientRect();
      const progress = hero && !reduced.matches ? Math.max(0, Math.min(1, -hero.top / hero.height)) : 0;
      frame?.contentDocument?.documentElement.style.setProperty('--hero-exit', String(progress));
    } catch { /* 跨域 iframe 读写不了，保持它自己的静态版式。 */ }
  }

  function schedule() {
    if (!pending && !document.hidden) pending = requestAnimationFrame(render);
  }

  function layout() {
    const bounds = flow.getBoundingClientRect();
    const width = flow.clientWidth;
    height = flow.offsetHeight;
    const section = element => {
      const r = element.getBoundingClientRect();
      return { top: r.top - bounds.top, bottom: r.bottom - bounds.top };
    };
    const regions = [about, camp, flow.querySelector('.play-daily'), projects].filter(Boolean).map(section);
    const a = regions[0];
    let d;
    if (width <= 640) {
      // 手机上路径走页面外侧的留白，避开文字与控件。
      const x = Math.max(8, width * .025);
      d = `M${x} 12`;
      regions.slice(0, -1).forEach(region => {
        d += ` L${x} ${region.bottom - 30} Q${x + 10} ${region.bottom} ${x} ${region.bottom + 35}`;
      });
      d += ` L${x} ${height - 90} Q${x} ${height - 12} ${width * .5} ${height - 5}`;
    } else {
      const left = width * .035, right = width * .965;
      const points = [[width * .5, 8], [width * .85, 40], [right, a.top + 140]];
      regions.forEach((region, i) => {
        const onRight = i % 2 === 0, edge = onRight ? right : left;
        if (i) points.push([width * (onRight ? .92 : .08), region.top + 70], [edge, region.top + 170]);
        if (i < regions.length - 1) {
          points.push([edge, region.bottom - 150], [width * (onRight ? .9 : .08), region.bottom - 60], [width * .5, region.bottom + 5]);
        } else {
          points.push([edge, region.bottom - 200], [width * (onRight ? .89 : .11), region.bottom - 95], [width * (onRight ? .75 : .25), height - 38], [width * .5, height - 5]);
        }
      });
      // 相邻线段共用切线，整条路径是连续曲线，没有硬拐角。
      d = `M${points[0].join(' ')}`;
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)], p1 = points[i];
        const p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
        d += ` C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6}
          ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2.join(' ')}`;
      }
    }
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.querySelector('linearGradient').setAttribute('y2', String(height));
    track.setAttribute('d', d);ink.setAttribute('d', d);
    length = track.getTotalLength();
    ink.style.strokeDasharray = String(length);
    svg.removeAttribute('hidden');
    schedule();
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', layout, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(pending); pending = 0; }
    else schedule();
  });
  reduced.addEventListener('change', schedule);
  frame?.addEventListener('load', schedule);
  if ('ResizeObserver' in window) new ResizeObserver(layout).observe(flow);
  layout();
})();
