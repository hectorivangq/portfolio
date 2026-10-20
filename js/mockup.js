/* ==========================================================================
   /mockup and /es/diseno-gratis only: the hero screenshot and the request form.
   Runs after main.js (GSAP, ScrollTrigger and Lenis are already loaded there).
   The form posts to Formspree in the background; without JS it posts normally.
   Meta Pixel ready: when a Pixel is installed later, a sent request fires the
   standard Lead event (reserved for mockup requests, see growth/prelaunch-audit.md).
   A request that reaches Formspree also fires GA4 generate_lead (bots caught by the
   honeypot don't).
   ========================================================================== */
(() => {
  const d = document;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const g = window.gsap;

  /* ---------- Hero: the homepage opens from a slit, then scrolls top to bottom ---------- */
  const shot = d.querySelector('[data-mk-shot]');
  if (shot) {
    const frame = shot.querySelector('.mk-shot__frame');
    const img = frame.querySelector('img');
    const size = () => frame.style.setProperty('--view-h', frame.clientHeight + 'px');
    size(); addEventListener('resize', size); addEventListener('load', size);
    const scroll = () => { size(); shot.classList.add('is-scrolling'); };
    if (reduce || !g) {
      frame.style.clipPath = 'none';
    } else {
      g.fromTo(frame, { clipPath: 'inset(46% 0% 46% 0% round 6px)' }, { clipPath: 'inset(0% 0% 0% 0% round 6px)', duration: 1.5, ease: 'expo.out', delay: 0.3 });
      g.fromTo(img, { scale: 1.16 }, { scale: 1, duration: 1.9, ease: 'expo.out', delay: 0.3, clearProps: 'transform', onComplete: scroll });
      if (window.ScrollTrigger) {
        g.to(shot, { yPercent: -10, ease: 'none', scrollTrigger: { trigger: '.mk-hero', start: 'top top', end: 'bottom top', scrub: true } });
      }
    }
  }

  /* ---------- Request form ---------- */
  const form = d.querySelector('[data-mk-form]');
  if (!form) return;
  const card = form.closest('.mk-card');
  const live = card.querySelector('[data-mk-live]');
  const fail = form.querySelector('[data-mk-fail]');
  const btn = form.querySelector('button[type="submit"]');
  const btnLabel = btn.querySelector('[data-mk-label]');
  const sendLabel = btnLabel.textContent;
  const msg = form.dataset;
  form.noValidate = true;

  // Where the lead came from: UTM tags on the link (bio, reels, ads) and the referring page
  const qs = new URLSearchParams(location.search);
  form.querySelectorAll('[data-utm]').forEach((i) => { i.value = qs.get(i.name) || ''; });
  const ref = form.querySelector('[data-referrer]');
  if (ref) ref.value = d.referrer || '';

  const setError = (field, text) => {
    const name = field.dataset.group || field.name;
    const err = form.querySelector(`#mk-${name}-err`);
    if (field.dataset.group) { if (text) field.setAttribute('data-invalid', ''); else field.removeAttribute('data-invalid'); }
    else field.setAttribute('aria-invalid', text ? 'true' : 'false');
    if (err) { err.textContent = text || ''; err.hidden = !text; }
  };

  const check = (field) => {
    if (field.dataset.group) {
      const ok = !!form.querySelector(`input[name="${field.dataset.group}"]:checked`);
      setError(field, ok ? '' : msg.errChoice);
      return ok;
    }
    const v = field.value.trim();
    let text = '';
    if (field.required && !v) text = msg.errRequired;
    else if (v && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) text = msg.errEmail;
    else if (v && field.type === 'tel' && v.replace(/\D/g, '').length < 10) text = msg.errPhone;
    setError(field, text);
    return !text;
  };

  const fields = [...form.querySelectorAll('.mk-input, fieldset[data-group]')];
  fields.forEach((f) => {
    if (f.dataset.group) f.addEventListener('change', () => check(f));
    else {
      f.addEventListener('blur', () => { if (f.value.trim()) check(f); });
      f.addEventListener('input', () => { if (f.getAttribute('aria-invalid') === 'true') check(f); });
    }
  });

  const goTo = (el) => {
    const y = el.getBoundingClientRect().top + scrollY - 128;
    if (window.__lenis) window.__lenis.scrollTo(y, { duration: reduce ? 0 : 1 }); else scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  };

  const done = (kind) => {
    const panel = card.querySelector(`[data-mk-done="${kind}"]`);
    form.hidden = true;
    panel.hidden = false;
    const title = panel.querySelector('.mk-done__title');
    live.textContent = title.textContent;
    goTo(card);
    title.focus({ preventScroll: true });
    if (g && !reduce) g.fromTo(panel.children, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, stagger: 0.08, ease: 'expo.out' }); // opacity only, so the focused title keeps focus
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'Lead', { content_name: 'mockup_request', content_category: d.documentElement.lang });
    }
  };

  const busy = (on) => {
    btn.setAttribute('aria-busy', String(on));
    btnLabel.textContent = on ? msg.sending : sendLabel;
    if (on) live.textContent = msg.sending;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    fail.hidden = true;
    const bad = fields.filter((f) => !check(f));
    if (bad.length) {
      const first = bad[0];
      const target = first.dataset.group ? first.querySelector('input') : first;
      goTo(first.closest('.mk-field') || first);
      target.focus({ preventScroll: true });
      return;
    }
    const looking = (form.querySelector('input[name="timing"]:checked') || {}).value === 'Just looking';
    if (form.elements._gotcha && form.elements._gotcha.value) { done(looking ? 'looking' : 'ready'); return; }
    if (form.dataset.connected !== '1') { fail.hidden = false; live.textContent = fail.textContent; return; }
    busy(true);
    try {
      const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      try { window.gtag && gtag('event', 'generate_lead', { form: 'mockup_request', timing: looking ? 'looking' : 'ready', language: d.documentElement.lang }); } catch (_) {}
      done(looking ? 'looking' : 'ready');
    } catch (err) {
      fail.hidden = false;
      live.textContent = fail.textContent;
    } finally {
      busy(false);
    }
  });
})();
