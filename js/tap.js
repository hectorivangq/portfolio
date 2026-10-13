/* ==========================================================================
   /3-tap and /es/prueba-3-toques only: the phone that follows the steps and
   the free video test form. Runs after main.js (GSAP and ScrollTrigger are
   already loaded there). The form posts to Formspree in the background;
   without JS it posts normally. No Meta Pixel event here: Lead stays
   reserved for mockup requests.
   ========================================================================== */
(() => {
  const d = document;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const g = window.gsap;

  /* ---------- The test: the phone shows the tap you're reading (desktop) ---------- */
  const stage = d.querySelector('[data-tap-stage]');
  const list = d.querySelector('.tap-steps');
  const steps = [...d.querySelectorAll('[data-tap-step]')];
  if (stage && list && steps.length) {
    const wide = matchMedia('(min-width: 60rem)');
    const set = (n) => {
      if (stage.dataset.active === String(n)) return;
      stage.dataset.active = String(n);
      steps.forEach((s) => s.classList.toggle('is-active', s.dataset.tapStep === String(n)));
    };
    stage.classList.add('is-live');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) set(e.target.dataset.tapStep); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    const on = () => {
      if (wide.matches) { list.classList.add('is-live'); steps[0].classList.add('is-active'); steps.forEach((s) => io.observe(s)); }
      else { list.classList.remove('is-live'); io.disconnect(); }
    };
    on();
    wide.addEventListener('change', on);

    // The phone opens from a slit the first time it comes into view
    const phone = stage.querySelector('.tap-phone');
    if (phone && g && !reduce && window.ScrollTrigger) {
      g.fromTo(phone, { clipPath: 'inset(46% 0% 46% 0% round 24px)' }, {
        clipPath: 'inset(0% 0% 0% 0% round 24px)', duration: 1.5, ease: 'expo.out',
        scrollTrigger: { trigger: stage, start: 'top 80%', once: true },
        onComplete: () => { phone.style.clipPath = 'none'; },
      });
    } else if (phone) {
      phone.style.clipPath = 'none';
    }
  }

  /* Small screens: each cropped screen shows its tap once, when it scrolls into view */
  if (!reduce) {
    const crops = d.querySelectorAll('.tap-crop');
    const cio = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-on'); cio.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -25% 0px' });
    crops.forEach((c) => cio.observe(c));
  }

  /* ---------- Free video test form ---------- */
  const form = d.querySelector('[data-tp-form]');
  if (!form) return;
  const card = form.closest('.mk-card');
  const live = card.querySelector('[data-tp-live]');
  const fail = form.querySelector('[data-tp-fail]');
  const btn = form.querySelector('button[type="submit"]');
  const btnLabel = btn.querySelector('[data-tp-label]');
  const sendLabel = btnLabel.textContent;
  const msg = form.dataset;
  form.noValidate = true;

  // Where the lead came from: UTM tags on the link (DM, bio, reels) and the referring page
  const qs = new URLSearchParams(location.search);
  form.querySelectorAll('[data-utm]').forEach((i) => { i.value = qs.get(i.name) || ''; });
  const ref = form.querySelector('[data-referrer]');
  if (ref) ref.value = d.referrer || '';

  const setError = (field, text) => {
    const name = field.dataset.group || field.name;
    const err = form.querySelector(`#tp-${name}-err`);
    if (field.dataset.group) { if (text) field.setAttribute('data-invalid', ''); else field.removeAttribute('data-invalid'); }
    else field.setAttribute('aria-invalid', text ? 'true' : 'false');
    if (err) { err.textContent = text || ''; err.hidden = !text; }
  };

  // Phone or email in one field: an email address, or at least 10 digits
  const okContact = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || (/^[\d\s()+.-]+$/.test(v) && v.replace(/\D/g, '').length >= 10);

  const check = (field) => {
    if (field.dataset.group) {
      const ok = !!form.querySelector(`input[name="${field.dataset.group}"]:checked`);
      setError(field, ok ? '' : msg.errChoice);
      return ok;
    }
    const v = field.value.trim();
    let text = '';
    if (!v) text = field.name === 'contact' ? msg.errContact : msg.errRequired;
    else if (field.name === 'contact' && !okContact(v)) text = msg.errContact;
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

  const done = () => {
    const panel = card.querySelector('[data-tp-done]');
    form.hidden = true;
    panel.hidden = false;
    const title = panel.querySelector('.mk-done__title');
    live.textContent = title.textContent;
    goTo(card);
    title.focus({ preventScroll: true });
    if (g && !reduce) g.fromTo(panel.children, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, stagger: 0.08, ease: 'expo.out' });
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
    if (form.elements._gotcha && form.elements._gotcha.value) { done(); return; }
    if (form.dataset.connected !== '1') { fail.hidden = false; live.textContent = fail.textContent; return; }
    busy(true);
    try {
      const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      done();
    } catch (err) {
      fail.hidden = false;
      live.textContent = fail.textContent;
    } finally {
      busy(false);
    }
  });
})();
