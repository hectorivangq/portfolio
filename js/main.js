/* ==========================================================================
   Hector Garcia Quiros · interaction + motion
   GSAP 3.13.0 + ScrollTrigger + Lenis 1.3.4, all self-hosted and pinned.
   Rules: only transform / opacity / clip-path animate; nothing waits more
   than ~600ms to be readable; reduced motion and no-JS get the final state.
   ========================================================================== */
(() => {
  const d = document;
  const root = d.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const desktop = () => matchMedia('(min-width: 60rem)').matches;

  /* ---------- Always-on (no motion needed) ---------- */
  // Mobile nav
  const toggle = d.querySelector('.nav-toggle');
  const panel = d.getElementById('mobile-nav');
  const setNav = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    d.body.style.overflow = open ? 'hidden' : '';
    if (window.__lenis) open ? window.__lenis.stop() : window.__lenis.start();
  };
  if (toggle && panel) {
    toggle.addEventListener('click', () => setNav(toggle.getAttribute('aria-expanded') !== 'true'));
    panel.addEventListener('click', (e) => { if (e.target.closest('a')) setNav(false); });
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { setNav(false); toggle.focus(); } });
  }

  // Header state: compact on scroll, hide on scroll down, show on scroll up
  const header = d.querySelector('.site-header');
  let lastY = 0;
  const onScrollHeader = (y) => {
    if (!header) return;
    header.classList.toggle('is-scrolled', y > 12);
    const goingDown = y > lastY && y > 400;
    header.classList.toggle('is-hidden', goingDown && panel && panel.hidden);
    lastY = y;
  };
  addEventListener('scroll', () => onScrollHeader(scrollY), { passive: true });
  onScrollHeader(scrollY);

  // Work videos: play when visible (muted, inline), pausable
  d.querySelectorAll('[data-autoplay]').forEach((v) => {
    const btn = v.closest('.case')?.querySelector('.video-toggle');
    let userPaused = false;
    const label = () => { if (btn) btn.querySelector('span').textContent = v.paused ? btn.dataset.play : btn.dataset.pause; };
    if (reduce) { v.removeAttribute('autoplay'); v.pause(); label(); }
    else {
      new IntersectionObserver(([e]) => {
        if (e.isIntersecting && !userPaused) v.play().catch(() => {}); else v.pause();
        label();
      }, { threshold: 0.35 }).observe(v);
    }
    btn?.addEventListener('click', () => {
      if (v.paused) { userPaused = false; v.play(); } else { userPaused = true; v.pause(); }
      label();
    });
    v.addEventListener('play', label); v.addEventListener('pause', label);
  });

  // Browser-frame screenshots: measure the viewport so the hover scroll stops at the bottom
  const sizeViews = () => d.querySelectorAll('.browser__view').forEach((v) => v.style.setProperty('--view-h', v.clientHeight + 'px'));
  addEventListener('resize', sizeViews); addEventListener('load', sizeViews); sizeViews();

  // Fit display lines to their container width (footer name)
  const fit = () => d.querySelectorAll('[data-fit]').forEach((el) => {
    el.style.fontSize = '';
    const box = el.parentElement.clientWidth;
    const w = el.scrollWidth;
    if (w && box) el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * box / w * 0.995) + 'px';
  });
  fit(); addEventListener('resize', fit); d.fonts?.ready.then(fit);

  // Year
  d.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  /* ---------- Motion ---------- */
  const reveal = () => root.classList.add('motion-ready');
  if (reduce || !window.gsap || !window.ScrollTrigger) { reveal(); return; }
  root.classList.add('motion');
  const failsafe = setTimeout(reveal, 2500);

  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  gsap.defaults({ ease: 'expo.out', duration: 1.1 });

  // Smooth scroll (Lenis) driven by GSAP's ticker so ScrollTrigger stays in sync
  if (window.Lenis) {
    const lenis = new window.Lenis({ lerp: 0.11, wheelMultiplier: 1, smoothWheel: true });
    window.__lenis = lenis;
    lenis.on('scroll', (e) => { ScrollTrigger.update(); onScrollHeader(e.scroll); });
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    d.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const target = d.querySelector(id);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target.getBoundingClientRect().top + scrollY - 72, { duration: 1.4 });
      history.replaceState(null, '', id);
      target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true });
    }));
  }

  /* Text splitting: words (with masks) or chars. Screen readers get the
     original text through aria-label; the pieces are aria-hidden. */
  const split = (el, mode) => {
    if (el.dataset.splitDone) return el.querySelectorAll('.split-word > span, .split-char > span');
    const text = el.textContent.trim().replace(/\s+/g, ' ');
    const words = text.split(' ');
    const visual = words.map((w) => mode === 'chars'
      ? `<span class="split-word" style="overflow:visible">${[...w].map((c) => `<span class="split-char"><span>${c}</span></span>`).join('')}</span>`
      : `<span class="split-word"><span>${w}</span></span>`).join(' ');
    // Screen readers read the hidden full sentence; the animated pieces are hidden from them.
    el.innerHTML = el.getAttribute('aria-hidden') === 'true' ? visual : `<span class="visually-hidden">${text}</span><span aria-hidden="true">${visual}</span>`;
    el.dataset.splitDone = '1';
    return el.querySelectorAll(mode === 'chars' ? '.split-char > span' : '.split-word > span');
  };

  /* ---------- Hero (home): the signature moment ---------- */
  const hero = d.querySelector('.hero');
  if (hero) {
    const back = hero.querySelector('.hero__name--back');
    const front = hero.querySelector('.hero__name--front');
    const fig = hero.querySelector('.hero__figure');
    const img = fig?.querySelector('img');
    const backChars = split(back, 'chars');
    const frontChars = front ? split(front, 'chars') : [];
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' }, onStart: reveal });
    tl.fromTo([backChars, frontChars], { yPercent: 105 }, { yPercent: 0, duration: 1.25, stagger: { each: 0.055, from: 'center' } }, 0.05)
      .fromTo(fig, { yPercent: 4, scale: 1.06 }, { yPercent: 0, scale: 1, duration: 1.6, ease: 'expo.out' }, 0)
      .fromTo(hero.querySelectorAll('[data-hero-in]'), { y: 28, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1, stagger: 0.08 }, 0.55);

    // Scroll: the name spreads apart and the portrait sinks slower (depth)
    const mm = gsap.matchMedia();
    mm.add('(min-width: 1px)', () => {
      const st = { trigger: hero, start: 'top top', end: 'bottom top', scrub: true };
      gsap.to([back, front].filter(Boolean), { yPercent: -18, ease: 'none', scrollTrigger: st });
      gsap.to(fig, { yPercent: 10, scale: 0.94, ease: 'none', scrollTrigger: st });
      gsap.to(hero.querySelector('.hero__glow'), { autoAlpha: 0, ease: 'none', scrollTrigger: st });
    });

    // Pointer: portrait and name drift in opposite directions (desktop)
    if (fine && img) {
      const qx = gsap.quickTo(img, 'x', { duration: 0.9, ease: 'power3.out' });
      const qy = gsap.quickTo(img, 'y', { duration: 0.9, ease: 'power3.out' });
      const nx = gsap.quickTo([back, front].filter(Boolean), 'x', { duration: 1.2, ease: 'power3.out' });
      hero.addEventListener('pointermove', (e) => {
        const r = hero.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        qx(px * 18); qy(py * 10); nx(px * -28);
      });
      hero.addEventListener('pointerleave', () => { qx(0); qy(0); nx(0); });
    }
  }

  /* ---------- Page hero (service pages) ---------- */
  d.querySelectorAll('.page-hero').forEach((ph) => {
    const title = ph.querySelector('.page-hero__title');
    const words = title ? split(title, 'words') : [];
    const tl = gsap.timeline({ onStart: reveal });
    tl.fromTo(words, { yPercent: 110 }, { yPercent: 0, duration: 1.2, stagger: 0.06 }, 0.05)
      .fromTo(ph.querySelectorAll('[data-hero-in]'), { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, stagger: 0.08, duration: 1 }, 0.45);
    const bg = ph.querySelector('.page-hero__bg');
    if (bg) {
      tl.fromTo(bg, { xPercent: 12, autoAlpha: 0 }, { xPercent: 0, autoAlpha: 1, duration: 1.8 }, 0);
      gsap.to(bg, { xPercent: -14, ease: 'none', scrollTrigger: { trigger: ph, start: 'top top', end: 'bottom top', scrub: true } });
    }
  });

  if (!hero && !d.querySelector('.page-hero')) reveal();

  /* ---------- Work: pinned horizontal gallery on desktop ---------- */
  const work = d.querySelector('.work');
  if (work) {
    const track = work.querySelector('.work__track');
    const bar = work.querySelector('.work__bar span');
    const count = work.querySelector('.work__count');
    const cases = [...work.querySelectorAll('.case')];
    const mm = gsap.matchMedia();
    mm.add('(min-width: 60rem)', () => {
      work.classList.add('is-horizontal');
      sizeViews();
      const dist = () => Math.max(0, track.scrollWidth - innerWidth + work.querySelector('.container').getBoundingClientRect().left);
      const tween = gsap.to(track, {
        x: () => -dist(), ease: 'none',
        scrollTrigger: {
          trigger: work, start: 'top top', end: () => '+=' + dist(), pin: true, scrub: 0.8, invalidateOnRefresh: true, anticipatePin: 1,
          onUpdate: (self) => {
            if (bar) bar.style.transform = `scaleX(${self.progress})`;
            if (count) count.textContent = String(Math.min(cases.length, Math.floor(self.progress * cases.length) + 1)).padStart(2, '0');
          },
        },
      });
      // Each case tilts in as it enters the frame
      cases.forEach((c) => {
        gsap.fromTo(c.querySelector('.case__media'), { rotate: 3, yPercent: 6 }, { rotate: 0, yPercent: 0, ease: 'none', scrollTrigger: { trigger: c, containerAnimation: tween, start: 'left right', end: 'center center', scrub: true } });
      });
      return () => { work.classList.remove('is-horizontal'); gsap.set(track, { x: 0 }); };
    });
    mm.add('(max-width: 59.99rem)', () => {
      cases.forEach((c) => gsap.fromTo(c, { y: 50, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1.1, scrollTrigger: { trigger: c, start: 'top 88%', once: true } }));
    });
  }


  /* ---------- Section headings: masked word rise ---------- */
  d.querySelectorAll('[data-split]').forEach((el) => {
    const words = split(el, 'words');
    gsap.fromTo(words, { yPercent: 110 }, { yPercent: 0, duration: 1.15, stagger: 0.045, scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
  });

  /* ---------- Generic reveals (with optional stagger groups) ---------- */
  d.querySelectorAll('[data-reveal]').forEach((el) => {
    if (el.closest('.hero, .page-hero')) return;
    gsap.fromTo(el, { y: 36, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1.1, scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
  });
  d.querySelectorAll('[data-stagger]').forEach((group) => {
    gsap.fromTo(group.children, { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1.1, stagger: 0.09, scrollTrigger: { trigger: group, start: 'top 88%', once: true } });
  });

  /* Image unmask: frame opens while the image settles */
  d.querySelectorAll('[data-unmask]').forEach((el) => {
    const inner = el.querySelector('img, video, .browser, .fan, .video-card');
    const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
    tl.fromTo(el, { clipPath: 'inset(12% 8% 12% 8% round 6px)' }, { clipPath: 'inset(0% 0% 0% 0% round 6px)', duration: 1.4, ease: 'expo.out' });
    if (inner) tl.fromTo(inner, { scale: 1.12 }, { scale: 1, duration: 1.6, ease: 'expo.out' }, 0);
  });

  /* ---------- Marquee: constant drift, speeds up and skews with scroll ---------- */
  d.querySelectorAll('.marquee').forEach((m) => {
    const track = m.querySelector('.marquee__track');
    const group = track.querySelector('.marquee__group');
    let x = 0, boost = 0, paused = false;
    const base = 0.6;
    const width = () => group.getBoundingClientRect().width;
    m.classList.add('is-animated');
    gsap.ticker.add(() => {
      if (paused) return;
      x -= base + boost;
      const w = width();
      if (w && -x >= w) x += w;
      boost *= 0.92;
      gsap.set(track, { x, skewX: gsap.utils.clamp(-8, 8, -boost * 0.6) });
    });
    ScrollTrigger.create({ trigger: m, start: 'top bottom', end: 'bottom top', onUpdate: (self) => { boost = gsap.utils.clamp(-14, 14, Math.abs(self.getVelocity()) / 250); } });
    const btn = m.querySelector('.marquee__pause');
    btn?.addEventListener('click', () => {
      paused = !paused;
      btn.setAttribute('aria-pressed', String(paused));
      btn.setAttribute('aria-label', paused ? btn.dataset.play : btn.dataset.pause);
      btn.innerHTML = paused ? '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M3 1.5v11l9-5.5z"/></svg>' : '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="2" y="1.5" width="3.5" height="11"/><rect x="8.5" y="1.5" width="3.5" height="11"/></svg>';
    });
  });

  /* ---------- Services list: cursor-following preview with clip swap ---------- */
  const preview = d.querySelector('.svc-preview');
  if (preview && fine) {
    const imgs = [...preview.querySelectorAll('img')];
    const px = gsap.quickTo(preview, 'x', { duration: 0.55, ease: 'power3.out' });
    const py = gsap.quickTo(preview, 'y', { duration: 0.55, ease: 'power3.out' });
    let current = -1;
    d.querySelectorAll('.svc').forEach((row, i) => {
      row.addEventListener('pointerenter', (e) => {
        gsap.set(preview, { x: e.clientX, y: e.clientY });
        gsap.to(preview, { autoAlpha: 1, scale: 1, duration: 0.5, ease: 'expo.out' });
        if (current !== i) {
          imgs.forEach((im, j) => {
            if (j === i) { gsap.fromTo(im, { clipPath: 'inset(100% 0% 0% 0%)', scale: 1.15 }, { clipPath: 'inset(0% 0% 0% 0%)', scale: 1, duration: 0.7, ease: 'expo.out', zIndex: 2 }); }
            else gsap.set(im, { zIndex: 1 });
          });
          current = i;
        }
      });
      row.addEventListener('pointermove', (e) => { px(e.clientX); py(e.clientY); });
      row.addEventListener('pointerleave', () => gsap.to(preview, { autoAlpha: 0, scale: 0.85, duration: 0.4, ease: 'power3.out' }));
    });
    // Rest position so first entry doesn't jump from the corner
    gsap.set(preview, { xPercent: -50, yPercent: -50, x: innerWidth / 2, y: innerHeight / 2 });
    preview.style.transform = '';
  }

  /* Cursor label on work media ("View site", "Watch") */
  const label = d.querySelector('.cursor-label');
  if (label && fine) {
    const lx = gsap.quickTo(label, 'x', { duration: 0.35, ease: 'power3.out' });
    const ly = gsap.quickTo(label, 'y', { duration: 0.35, ease: 'power3.out' });
    d.querySelectorAll('[data-cursor]').forEach((el) => {
      el.addEventListener('pointerenter', () => { label.textContent = el.dataset.cursor; gsap.to(label, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' }); });
      el.addEventListener('pointermove', (e) => { lx(e.clientX + 16); ly(e.clientY + 16); });
      el.addEventListener('pointerleave', () => gsap.to(label, { autoAlpha: 0, scale: 0.6, duration: 0.25 }));
    });
  }

  /* ---------- Testimonials: words fill in as you read ---------- */
  d.querySelectorAll('.quote__text').forEach((q) => {
    const text = q.textContent.trim().replace(/\s+/g, ' ');
    q.innerHTML = `<span class="visually-hidden">${text}</span><span aria-hidden="true">${text.split(' ').map((w) => `<span class="fill-word">${w}</span>`).join(' ')}</span>`;
    gsap.fromTo(q.querySelectorAll('.fill-word'), { opacity: 0.22 }, { opacity: 1, ease: 'none', stagger: 0.1, scrollTrigger: { trigger: q, start: 'top 82%', end: 'bottom 55%', scrub: true } });
  });

  /* ---------- Process: the rule draws across as the steps enter ---------- */
  d.querySelectorAll('.steps').forEach((s) => {
    const line = s.querySelector('.steps__line');
    if (line) gsap.fromTo(line, { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: s, start: 'top 80%', end: 'bottom 60%', scrub: true } });
    gsap.fromTo(s.querySelectorAll('.step'), { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, stagger: 0.12, duration: 1.1, scrollTrigger: { trigger: s, start: 'top 85%', once: true } });
    s.querySelectorAll('.step__num').forEach((n) => {
      const end = parseInt(n.textContent, 10);
      if (!end) return;
      const o = { v: 0 };
      gsap.to(o, { v: end, duration: 1.2, ease: 'power2.out', scrollTrigger: { trigger: n, start: 'top 90%', once: true }, onUpdate: () => { n.textContent = String(Math.round(o.v)).padStart(2, '0'); } });
    });
  });

  /* ---------- Pricing: cards rise, featured one lands last with a lift ---------- */
  d.querySelectorAll('.plans').forEach((p) => {
    gsap.fromTo(p.children, { y: 60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, stagger: 0.12, duration: 1.2, scrollTrigger: { trigger: p, start: 'top 85%', once: true } });
  });
  d.querySelectorAll('.offer').forEach((o) => {
    const price = o.querySelector('.offer__price');
    gsap.fromTo(o, { clipPath: 'inset(8% 4% 8% 4% round 6px)' }, { clipPath: 'inset(0% 0% 0% 0% round 6px)', duration: 1.4, scrollTrigger: { trigger: o, start: 'top 85%', once: true } });
    if (price) gsap.fromTo(price, { yPercent: 40, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 1.2, delay: 0.2, scrollTrigger: { trigger: o, start: 'top 85%', once: true } });
    o.querySelectorAll('.offer__spots span').forEach((s, i) => gsap.fromTo(s, { scaleX: 0, transformOrigin: 'left' }, { scaleX: 1, duration: 0.8, delay: 0.5 + i * 0.12, scrollTrigger: { trigger: o, start: 'top 85%', once: true } }));
  });

  /* ---------- CTA + footer name: scrubbed rise ---------- */
  d.querySelectorAll('.cta__title').forEach((t) => {
    const words = split(t, 'words');
    gsap.fromTo(words, { yPercent: 110 }, { yPercent: 0, stagger: 0.06, duration: 1.2, scrollTrigger: { trigger: t, start: 'top 85%', once: true } });
  });
  const big = d.querySelector('.footer__big');
  if (big) {
    const chars = split(big, 'chars');
    gsap.fromTo(chars, { yPercent: 100 }, { yPercent: 0, ease: 'none', stagger: 0.03, scrollTrigger: { trigger: big, start: 'top bottom', end: 'bottom 95%', scrub: true } });
  }

  /* ---------- Magnetic buttons ---------- */
  if (fine) {
    d.querySelectorAll('.magnetic').forEach((b) => {
      const mx = gsap.quickTo(b, 'x', { duration: 0.6, ease: 'elastic.out(1, 0.4)' });
      const my = gsap.quickTo(b, 'y', { duration: 0.6, ease: 'elastic.out(1, 0.4)' });
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        mx((e.clientX - r.left - r.width / 2) * 0.28);
        my((e.clientY - r.top - r.height / 2) * 0.35);
      });
      b.addEventListener('pointerleave', () => { mx(0); my(0); });
    });
  }

  ScrollTrigger.sort();
  addEventListener('load', () => ScrollTrigger.refresh());
  d.fonts?.ready.then(() => ScrollTrigger.refresh());
  clearTimeout(failsafe);
  // Anything the timelines didn't reach is shown after a short grace period
  setTimeout(reveal, 1200);
})();
