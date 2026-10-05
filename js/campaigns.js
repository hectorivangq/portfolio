/* ==========================================================================
   Campaign concepts · enlarged post view
   Each feed post has a full-size button over it. It opens the post in a
   <dialog>, with previous/next inside the same feed. No dependencies.
   ========================================================================== */
(() => {
  const d = document;
  const dlg = d.querySelector('.lightbox');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  const stage = dlg.querySelector('.lightbox__stage');
  const count = dlg.querySelector('.lightbox__count');
  let cells = [];
  let i = 0;

  const show = () => {
    const cell = cells[i];
    const post = cell.querySelector('.post').cloneNode(true);
    // The brand class lives on the section; carry it so the post keeps its palette.
    const section = cell.closest('.camp');
    const wrap = d.createElement('div');
    wrap.className = [...section.classList].find((c) => c.startsWith('b-')) || '';
    wrap.style.display = 'contents';
    wrap.append(post);
    stage.replaceChildren(wrap);
    const name = section.querySelector('h2')?.textContent.trim() || '';
    count.textContent = `${name} · ${i + 1} / ${cells.length}`;
  };
  const step = (n) => { i = (i + n + cells.length) % cells.length; show(); };

  d.querySelectorAll('.post__open').forEach((btn) => btn.addEventListener('click', () => {
    const grid = btn.closest('.ig__grid');
    cells = [...grid.children];
    i = cells.indexOf(btn.closest('.post-cell'));
    show();
    dlg.showModal();
    window.__lenis?.stop();
  }));
  dlg.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => step(Number(b.dataset.step))));
  dlg.querySelector('.lightbox__close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  });
  // A click on the dark area around the post closes the view
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target === stage) dlg.close(); });
  dlg.addEventListener('close', () => { window.__lenis?.start(); stage.replaceChildren(); });
})();
