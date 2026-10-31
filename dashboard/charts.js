// Small chart kit for the dashboard: plain SVG and HTML, no libraries.
// Rules it follows: thin marks, hairline solid grid, one y-axis, values in text tokens
// (never the series colour), a tooltip on hover and keyboard focus, and every chart
// has a table twin (the card's "Table" toggle), so no value hides behind a tooltip.
// All labels are inserted with textContent: names come from API responses.

const SVG = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

function s(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  return node;
}

// ---------- number formats ----------

const full = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const fmt = {
  count: v => (v == null || Number.isNaN(v) ? '—' : Math.abs(v) >= 10000 ? compact.format(v) : full.format(Math.round(v))),
  full: v => (v == null || Number.isNaN(v) ? '—' : full.format(Math.round(v))),
  pct: v => (v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(1)}%`),
  duration: sec => {
    if (sec == null || Number.isNaN(sec)) return '—';
    const m = Math.floor(sec / 60), r = Math.round(sec % 60);
    return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
  },
  hours: min => (min == null ? '—' : min / 60 >= 100 ? full.format(Math.round(min / 60)) : (min / 60).toFixed(1)),
};

// Axis ticks: clean round steps, in full under 10,000, compact past it.
function niceStep(max, count = 4) {
  if (max <= 0) return 1;
  const raw = max / count, mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}
function axisLabel(v, top) { return top >= 10000 ? compact.format(v) : full.format(v); }

// ---------- shared tooltip ----------

let tip;
function tooltip() {
  if (!tip) {
    tip = el('div', { class: 'tip', role: 'status', 'aria-live': 'polite' });
    document.body.append(tip);
  }
  return tip;
}
// rows: [{ value, label, key: css colour or null }]
export function showTip(x, y, title, rows) {
  const t = tooltip();
  t.replaceChildren(
    el('div', { class: 'tip__title', text: title }),
    ...rows.map(r => el('div', { class: 'tip__row' },
      r.key ? el('span', { class: `tip__key${r.dim ? ' tip__key--dim' : ''}` }) : null,
      el('strong', { text: r.value }),
      el('span', { class: 'tip__label', text: r.label }))),
  );
  [...t.querySelectorAll('.tip__key')].forEach((k, i) => { k.style.background = rows.filter(r => r.key)[i].key; });
  t.classList.add('is-on');
  const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
  let left = x + pad, top = y - h - pad;
  if (left + w > window.innerWidth - 8) left = x - w - pad;
  if (top < 8) top = y + pad;
  // Fixed to the viewport: a hidden tooltip never widens the page.
  t.style.left = `${Math.max(8, left)}px`;
  t.style.top = `${Math.max(8, top)}px`;
}
export function hideTip() { if (tip) tip.classList.remove('is-on'); }

// ---------- sparkline (stat tiles, site cards) ----------

export function sparkline(values, { label = '', w = 120, h = 32 } = {}) {
  const svg = s('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'spark', role: 'img', 'aria-label': label, preserveAspectRatio: 'none' });
  if (!values.length) return svg;
  const max = Math.max(...values, 1), n = values.length;
  const x = i => (n === 1 ? w / 2 : 3 + (i * (w - 6)) / (n - 1));
  const y = v => h - 3 - (v / max) * (h - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  svg.append(s('path', { d: `${d}L${x(n - 1)},${h}L${x(0)},${h}Z`, class: 'spark__area' }));
  svg.append(s('path', { d, class: 'spark__line' }));
  svg.append(s('circle', { cx: x(n - 1), cy: y(values[n - 1]), r: 3, class: 'spark__dot' }));
  return svg;
}

// ---------- line chart: one y-axis, crosshair, every series in one tooltip ----------
// series: [{ name, values: number[], tone: 'accent' | 'dim' }], labels: string[] (x)
export function lineChart(host, { labels, series, format = fmt.full, height = 240, ariaLabel }) {
  const wrap = el('div', { class: 'line' });
  host.replaceChildren(wrap);
  const draw = () => {
    const W = Math.max(280, wrap.clientWidth), H = height;
    const m = { t: 12, r: 16, b: 28, l: 48 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const n = labels.length;
    const max = Math.max(1, ...series.flatMap(sr => sr.values.filter(v => v != null)));
    const path = vals => vals.map((v, i) => (v == null ? '' : `${i && vals[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('');
    const step = niceStep(max), top = Math.ceil(max / step) * step;
    const x = i => m.l + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
    const y = v => m.t + ph - (v / top) * ph;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': ariaLabel, tabindex: 0, class: 'line__svg' });
    for (let v = 0; v <= top + 1e-9; v += step) {
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
      const t = s('text', { x: m.l - 8, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' });
      t.textContent = axisLabel(v, top);
      svg.append(t);
    }
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 72))));
    labels.forEach((lab, i) => {
      if (i % every && i !== n - 1) return;
      if (i !== n - 1 && n - 1 - i < every * 0.6) return; // keep the last label clear of its neighbour
      const t = s('text', { x: x(i), y: H - 8, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' });
      t.textContent = lab;
      svg.append(t);
    });
    // previous period underneath, current on top
    [...series].sort((a, b) => (a.tone === 'dim' ? -1 : 1) - (b.tone === 'dim' ? -1 : 1)).forEach(sr => {
      const d = path(sr.values);
      if (!d) return;
      if (sr.tone !== 'dim' && !sr.values.includes(null)) svg.append(s('path', { d: `${d}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`, class: 'line__area' }));
      svg.append(s('path', { d, class: `line__path line__path--${sr.tone}` }));
      const last = sr.values[n - 1];
      if (sr.tone !== 'dim' && last != null) svg.append(s('circle', { cx: x(n - 1), cy: y(last), r: 4, class: 'line__end' }));
    });
    const cross = s('line', { y1: m.t, y2: m.t + ph, class: 'cross', visibility: 'hidden' });
    const dots = series.map(sr => s('circle', { r: 4, class: `line__dot line__dot--${sr.tone}`, visibility: 'hidden' }));
    svg.append(cross, ...dots);
    const hit = s('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent' });
    svg.append(hit);
    let idx = n - 1;
    const show = (i, cx, cy) => {
      idx = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', x(idx)); cross.setAttribute('x2', x(idx)); cross.setAttribute('visibility', 'visible');
      series.forEach((sr, k) => { const v = sr.values[idx]; dots[k].setAttribute('cx', x(idx)); dots[k].setAttribute('cy', y(v ?? 0)); dots[k].setAttribute('visibility', v == null ? 'hidden' : 'visible'); });
      showTip(cx, cy, labels[idx], series.map(sr => ({ value: format(sr.values[idx]), label: sr.tipLabel ? sr.tipLabel(idx) : sr.name, key: sr.tone === 'dim' ? 'var(--c-dim)' : 'var(--c-1)', dim: sr.tone === 'dim' })));
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); hideTip(); };
    svg.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      show(Math.round(((px - m.l) / pw) * (n - 1)), e.clientX, e.clientY);
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('blur', hide);
    svg.addEventListener('focus', () => { const r = svg.getBoundingClientRect(); show(idx, r.left + (x(idx) / W) * r.width, r.top + 20); });
    svg.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const ni = idx + (e.key === 'ArrowRight' ? 1 : -1);
      show(ni, r.left + (x(Math.max(0, Math.min(n - 1, ni))) / W) * r.width, r.top + 20);
    });
    wrap.replaceChildren(svg);
  };
  draw();
  observe(wrap, draw);
}

// Redraw on width change only (height is fixed by the chart, so no loop).
function observe(node, draw) {
  let w = node.clientWidth;
  const ro = new ResizeObserver(() => { if (Math.abs(node.clientWidth - w) > 1) { w = node.clientWidth; draw(); } });
  ro.observe(node);
}

// ---------- ranked horizontal bars: one hue, largest first, value at the tip ----------
// rows: [{ label, value, note? }]
export function barList(host, rows, { format = fmt.full, unit = '', empty = 'No data in this period.' } = {}) {
  if (!rows.length) { host.replaceChildren(el('p', { class: 'empty', text: empty })); return; }
  const max = Math.max(...rows.map(r => r.value), 1);
  const total = rows.reduce((a, r) => a + r.value, 0);
  const list = el('ol', { class: 'bars' });
  for (const r of rows) {
    const share = total ? r.value / total : 0;
    const li = el('li', { class: 'bars__row', tabindex: 0, 'aria-label': `${r.label}: ${format(r.value)}${unit ? ' ' + unit : ''}` },
      el('span', { class: 'bars__label', text: r.label, title: r.label }),
      el('span', { class: 'bars__track' }, el('span', { class: 'bars__bar' })),
      el('span', { class: 'bars__value', text: format(r.value) }));
    li.querySelector('.bars__bar').style.width = `${Math.max(0.5, (r.value / max) * 100)}%`;
    const tipRows = [{ value: format(r.value), label: unit || 'value' }, { value: fmt.pct(share), label: 'of the rows shown' }];
    if (r.note) tipRows.push({ value: r.note, label: '' });
    const on = e => { const b = li.getBoundingClientRect(); showTip(e.clientX ?? b.right - 40, e.clientY ?? b.top, r.label, tipRows); };
    li.addEventListener('pointermove', on);
    li.addEventListener('focus', on);
    li.addEventListener('pointerleave', hideTip);
    li.addEventListener('blur', hideTip);
    list.append(li);
  }
  host.replaceChildren(list);
}

// ---------- tall segmented bar: one whole, <= 6 parts ----------
// parts: [{ label, value }] — coloured by fixed slot order (entity keeps its colour)
export function segmentedBar(host, parts, { format = fmt.full, slots = {} } = {}) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) { host.replaceChildren(el('p', { class: 'empty', text: 'No data in this period.' })); return; }
  const bar = el('div', { class: 'seg', role: 'img', 'aria-label': parts.map(p => `${p.label} ${fmt.pct(p.value / total)}`).join(', ') });
  const legend = el('ul', { class: 'legend' });
  parts.filter(p => p.value > 0).forEach((p, i) => {
    const slot = slots[p.label] ?? (i % 3) + 1;
    const share = p.value / total;
    const block = el('div', { class: `seg__part seg__part--${slot}`, tabindex: 0, 'aria-label': `${p.label}: ${format(p.value)}, ${fmt.pct(share)}` });
    block.style.flexGrow = String(p.value);
    const label = el('span', { class: 'seg__label', text: `${Math.round(share * 100)}%` });
    block.append(label);
    const on = e => { const b = block.getBoundingClientRect(); showTip(e.clientX ?? b.left + 10, e.clientY ?? b.top, p.label, [{ value: format(p.value), label: 'visitors' }, { value: fmt.pct(share), label: 'share' }]); };
    block.addEventListener('pointermove', on);
    block.addEventListener('focus', on);
    block.addEventListener('pointerleave', hideTip);
    block.addEventListener('blur', hideTip);
    bar.append(block);
    legend.append(el('li', {}, el('span', { class: `legend__swatch seg__part--${slot}` }), p.label));
  });
  host.replaceChildren(bar, legend);
  // A label that doesn't fit with padding is dropped (the value stays in the table and tooltip).
  requestAnimationFrame(() => bar.querySelectorAll('.seg__part').forEach(b => {
    const l = b.querySelector('.seg__label');
    if (l.scrollWidth + 16 > b.clientWidth) l.remove();
  }));
}

// ---------- table twin ----------
// cols: [{ label, get: row => string, num?: bool }]
export function table(rows, cols, caption) {
  return el('table', { class: 'tbl' },
    caption ? el('caption', { class: 'visually-hidden', text: caption }) : null,
    el('thead', {}, el('tr', {}, cols.map(c => el('th', { scope: 'col', class: c.num ? 'num' : null, text: c.label })))),
    el('tbody', {}, rows.map(r => el('tr', {}, cols.map((c, i) => el(i ? 'td' : 'th', { scope: i ? null : 'row', class: c.num ? 'num' : null, text: c.get(r) }))))));
}
