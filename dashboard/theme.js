// Apply the saved light/dark choice before the page paints (no flash). With no saved
// choice, the CSS follows the system setting.
try {
  const t = localStorage.getItem('hq.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* storage blocked: follow the system */ }
