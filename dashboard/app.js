// Hector's analytics dashboard: every website's Google Analytics 4 property and the
// content clients' YouTube channels, read live from Google in this browser.
//
// How it stays honest:
// - Only numbers Google's APIs returned are shown. An error is shown as an error.
// - Each period is compared with the period right before it, same number of days.
// - Under 100, a percentage change also shows the raw counts, because a handful of
//   people moves it a lot.
//
// How it stays private:
// - Nothing is stored on a server. The Google token lives in this tab's memory for an
//   hour; closing the tab forgets it. Google only returns what your account can see.

import { OAUTH_CLIENT_ID, SITES, CONTENT } from './config.js';
import { el, fmt, sparkline, lineChart, barList, segmentedBar, table, hideTip } from './charts.js';

const ADMIN = 'https://analyticsadmin.googleapis.com/v1beta/';
const DATA = 'https://analyticsdata.googleapis.com/v1beta/';
const YT = 'https://www.googleapis.com/youtube/v3/';
const YTA = 'https://youtubeanalytics.googleapis.com/v2/reports';
const SCOPE = {
  ga: 'https://www.googleapis.com/auth/analytics.readonly',
  yt: 'https://www.googleapis.com/auth/youtube.readonly',
  yta: 'https://www.googleapis.com/auth/yt-analytics.readonly',
};
const PRESETS = [['7d', 'Last 7 days'], ['28d', 'Last 28 days'], ['90d', 'Last 90 days'], ['mtd', 'Month to date'], ['lm', 'Last month']];
const TOTALS = ['activeUsers', 'newUsers', 'sessions', 'engagedSessions', 'engagementRate', 'userEngagementDuration', 'screenPageViews', 'keyEvents'];
const DEVICE_SLOTS = { desktop: 1, mobile: 2, tablet: 3 };

const app = document.getElementById('app');
const state = {
  range: PRESETS.some(([id]) => id === localStorage.getItem('hq.range')) ? localStorage.getItem('hq.range') : '28d',
  auth: { google: null, channel: null }, // { token, exp }
  props: null,
  sites: [],
  extra: [],
  cache: new Map(),
  updated: null,
  expired: false,
};

// ---------- dates ----------

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayDiff = (a, b) => Math.round((b - a) / 86400000);
const short = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const span = (a, b) => `${short(a)} – ${short(b)}, ${b.getFullYear()}`;

function rangeFor(id, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start, end, pStart, pEnd, partial = false;
  if (id === 'mtd') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = today;
    partial = true;
    pStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const pMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    pEnd = addDays(pStart, dayDiff(start, end));
    if (pEnd > pMonthEnd) pEnd = pMonthEnd;
  } else if (id === 'lm') {
    start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    end = new Date(today.getFullYear(), today.getMonth(), 0);
    pStart = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    pEnd = new Date(today.getFullYear(), today.getMonth() - 1, 0);
  } else {
    const n = parseInt(id, 10);
    end = addDays(today, -1);
    start = addDays(end, -(n - 1));
    pEnd = addDays(start, -1);
    pStart = addDays(pEnd, -(n - 1));
  }
  const days = dayDiff(start, end) + 1, pDays = dayDiff(pStart, pEnd) + 1;
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const pDates = Array.from({ length: pDays }, (_, i) => addDays(pStart, i));
  return { id, start, end, pStart, pEnd, partial, days, pDays, dates, pDates };
}

// ---------- Google sign-in (Google Identity Services, token model) ----------

const clientId = () => OAUTH_CLIENT_ID || localStorage.getItem('hq.clientId') || '';

let gisReady;
function loadGis() {
  gisReady ||= new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const tag = document.createElement('script');
    tag.src = 'https://accounts.google.com/gsi/client';
    tag.async = true;
    tag.addEventListener('load', () => resolve());
    tag.addEventListener('error', () => { gisReady = null; reject(new Error('Google sign-in could not load. Check the connection or an ad blocker.')); });
    document.head.append(tag);
  });
  return gisReady;
}

function requestToken(kind) {
  const scopes = kind === 'channel' ? [SCOPE.yt, SCOPE.yta] : [SCOPE.ga, SCOPE.yt];
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: scopes.join(' '),
      // The channel sign-in always shows the account picker, so you can pick the
      // College Conversations channel (a Brand Account) instead of your own account.
      prompt: kind === 'channel' ? 'select_account' : '',
      include_granted_scopes: false,
      callback: resp => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, ...scopes)) {
          return reject(new Error('Some permissions were left unticked on Google’s screen. Sign in again and allow all of them; they are read-only.'));
        }
        state.auth[kind] = { token: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
        resolve();
      },
      error_callback: err => reject(new Error(err.type === 'popup_closed' ? 'The Google window was closed before sign-in finished.'
        : err.type === 'popup_failed_to_open' ? 'The browser blocked Google’s sign-in window. Allow pop-ups for this page and try again.'
          : 'Google sign-in failed.')),
    });
    client.requestAccessToken();
  });
}

function signOut() {
  for (const k of ['google', 'channel']) {
    const t = state.auth[k];
    if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t.token, () => {});
    state.auth[k] = null;
  }
  state.props = null;
  state.cache.clear();
  state.expired = false;
  location.hash = '#/';
  render();
}

// ---------- API ----------

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function api(kind, url, body) {
  const t = state.auth[kind];
  if (!t || Date.now() > t.exp - 30000) { if (kind === 'google') expire(); throw new ApiError('Your Google sign-in ran out. Sign in again.', 401); }
  let res;
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${t.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(`Couldn’t reach ${new URL(url).hostname}. Check the connection.`, 0);
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && kind === 'google') expire();
  if (!res.ok) throw new ApiError(json.error?.message || `${res.status} ${res.statusText}`, res.status);
  return json;
}

function expire() {
  if (state.expired) return;
  state.expired = true;
  const bar = document.querySelector('.expired');
  if (bar) bar.hidden = false;
}

function cached(key, fn) {
  if (!state.cache.has(key)) {
    const p = fn();
    state.cache.set(key, p);
    p.catch(() => { if (state.cache.get(key) === p) state.cache.delete(key); }); // a failure is retried on the next render
  }
  return state.cache.get(key);
}

function rows(report) {
  const dims = (report.dimensionHeaders || []).map(h => h.name);
  const mets = (report.metricHeaders || []).map(h => h.name);
  return (report.rows || []).map(r => {
    const o = {};
    dims.forEach((d, i) => { o[d] = r.dimensionValues[i].value; });
    mets.forEach((m, i) => { o[m] = Number(r.metricValues[i].value); });
    return o;
  });
}

const hostOf = uri => { try { return new URL(uri).hostname.replace(/^www\./, ''); } catch { return ''; } };
const twoRanges = r => [
  { startDate: ymd(r.start), endDate: ymd(r.end), name: 'current' },
  { startDate: ymd(r.pStart), endDate: ymd(r.pEnd), name: 'previous' },
];

// Which Google Analytics properties can this account see, and which site is each one?
function discover() {
  return cached('discover', async () => {
    const summaries = [];
    let page = '';
    do {
      const r = await api('google', `${ADMIN}accountSummaries?pageSize=200${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
      summaries.push(...(r.accountSummaries || []));
      page = r.nextPageToken;
    } while (page);
    const props = summaries.flatMap(a => (a.propertySummaries || [])
      .filter(p => (p.propertyType || 'PROPERTY_TYPE_ORDINARY') === 'PROPERTY_TYPE_ORDINARY')
      .map(p => ({ id: p.property.split('/')[1], name: p.displayName, account: a.displayName, mids: [], hosts: [] })));
    await Promise.all(props.map(async p => {
      const [streams, detail] = await Promise.allSettled([
        api('google', `${ADMIN}properties/${p.id}/dataStreams`),
        api('google', `${ADMIN}properties/${p.id}`),
      ]);
      if (streams.status === 'fulfilled') {
        const web = (streams.value.dataStreams || []).filter(s => s.webStreamData);
        p.mids = web.map(s => s.webStreamData.measurementId).filter(Boolean);
        p.hosts = web.map(s => hostOf(s.webStreamData.defaultUri)).filter(Boolean);
      }
      if (detail.status === 'fulfilled') p.tz = detail.value.timeZone;
    }));
    state.props = props;
    const used = new Set();
    state.sites = SITES.map(site => {
      let prop = site.measurementId ? props.find(p => p.mids.includes(site.measurementId)) : null;
      let how = prop ? 'id' : null;
      if (!prop) { prop = props.find(p => p.hosts.includes(site.domain)); if (prop) how = 'domain'; }
      if (prop) used.add(prop.id);
      return { ...site, prop, how, status: prop ? 'connected' : site.measurementId ? 'no-access' : 'missing' };
    });
    state.extra = props.filter(p => !used.has(p.id)).map(p => ({
      key: `property-${p.id}`, name: p.name, domain: p.hosts[0] || '', measurementId: p.mids[0] || null,
      kind: 'Not in the site list', prop: p, how: 'extra', status: 'connected', extra: true,
    }));
  });
}

// Totals and a day-by-day line for one site, this period and the one before.
function siteOverview(site, r) {
  return cached(`ov|${site.prop.id}|${r.id}`, async () => {
    const res = await api('google', `${DATA}properties/${site.prop.id}:batchRunReports`, {
      requests: [
        { dateRanges: twoRanges(r), metrics: TOTALS.map(name => ({ name })) },
        {
          dateRanges: twoRanges(r), dimensions: [{ name: 'date' }],
          metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'keyEvents' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 1000,
        },
      ],
    });
    const [tot, daily] = res.reports || [];
    const zero = Object.fromEntries(TOTALS.map(m => [m, 0]));
    const t = { current: { ...zero }, previous: { ...zero } };
    for (const row of rows(tot || {})) Object.assign(t[row.dateRange] || {}, row);
    const line = (name, dates, metric) => {
      const map = new Map(rows(daily || {}).filter(x => x.dateRange === name).map(x => [x.date, x[metric]]));
      return dates.map(d => map.get(ymd(d).replaceAll('-', '')) || 0); // a day with no row had no visits
    };
    return {
      totals: t,
      users: line('current', r.dates, 'activeUsers'),
      pUsers: line('previous', r.pDates, 'activeUsers'),
      sessions: line('current', r.dates, 'sessions'),
      pSessions: line('previous', r.pDates, 'sessions'),
    };
  });
}

function siteLive(site) {
  return cached(`live|${site.prop.id}`, async () => {
    const res = await api('google', `${DATA}properties/${site.prop.id}:runRealtimeReport`, { metrics: [{ name: 'activeUsers' }] });
    return rows(res)[0]?.activeUsers || 0;
  });
}

function siteDetail(site, r) {
  return cached(`dt|${site.prop.id}|${r.id}`, async () => {
    const range = [{ startDate: ymd(r.start), endDate: ymd(r.end) }];
    const q = (dim, metrics, limit) => ({
      dateRanges: range, dimensions: [{ name: dim }], metrics: metrics.map(name => ({ name })),
      orderBys: [{ metric: { metricName: metrics[0] }, desc: true }], limit,
    });
    const [batch, cities] = await Promise.all([
      api('google', `${DATA}properties/${site.prop.id}:batchRunReports`, {
        requests: [
          q('sessionDefaultChannelGroup', ['sessions', 'engagedSessions', 'keyEvents'], 10),
          q('pagePath', ['screenPageViews', 'activeUsers'], 12),
          q('sessionSource', ['sessions', 'keyEvents'], 10),
          q('eventName', ['eventCount', 'keyEvents'], 20),
          q('deviceCategory', ['activeUsers'], 6),
        ],
      }),
      api('google', `${DATA}properties/${site.prop.id}:runReport`, q('city', ['activeUsers'], 10)),
    ]);
    const [channels, pages, sources, events, devices] = (batch.reports || []).map(rows);
    return { channels, pages, sources, events, devices, cities: rows(cities) };
  });
}

// ---------- YouTube ----------

function ytChannel(c) {
  return cached(`yt|${c.handle}`, async () => {
    const r = await api('google', `${YT}channels?part=snippet,statistics,contentDetails&forHandle=${encodeURIComponent(c.handle)}`);
    const ch = r.items?.[0];
    if (!ch) throw new ApiError(`YouTube found no channel with the handle ${c.handle}.`, 404);
    const pl = await api('google', `${YT}playlistItems?part=contentDetails&maxResults=25&playlistId=${encodeURIComponent(ch.contentDetails.relatedPlaylists.uploads)}`);
    const ids = (pl.items || []).map(i => i.contentDetails.videoId);
    const vids = ids.length ? await api('google', `${YT}videos?part=snippet,statistics,contentDetails&id=${ids.join(',')}`) : { items: [] };
    const videos = (vids.items || []).map(v => ({
      id: v.id,
      title: v.snippet.title,
      published: new Date(v.snippet.publishedAt),
      thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
      views: Number(v.statistics.viewCount || 0),
      likes: v.statistics.likeCount == null ? null : Number(v.statistics.likeCount),
      comments: v.statistics.commentCount == null ? null : Number(v.statistics.commentCount),
    })).sort((a, b) => b.published - a.published);
    return { channel: ch, videos, pulled: new Date() };
  });
}

// Watch time, views and subscribers in the period. Needs the channel's own sign-in.
function ytAnalytics(c, ch, r) {
  return cached(`yta|${c.handle}|${r.id}`, async () => {
    const mine = await api('channel', `${YT}channels?part=snippet&mine=true`);
    const signedIn = mine.items?.[0];
    if (!signedIn || signedIn.id !== ch.id) {
      const who = signedIn ? `“${signedIn.snippet.title}”` : 'an account with no YouTube channel';
      throw new ApiError(`You signed in to ${who}, not ${ch.snippet.title}. Use “Connect channel” and pick ${ch.snippet.title} in Google’s account list.`, 403);
    }
    const metrics = 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes';
    const q = (a, b, extra = '') => api('channel', `${YTA}?ids=${encodeURIComponent('channel==MINE')}&startDate=${ymd(a)}&endDate=${ymd(b)}&metrics=${metrics}${extra}`);
    const [cur, prev, daily, pDaily, top] = await Promise.all([
      q(r.start, r.end), q(r.pStart, r.pEnd),
      q(r.start, r.end, '&dimensions=day&sort=day'), q(r.pStart, r.pEnd, '&dimensions=day&sort=day'),
      api('channel', `${YTA}?ids=${encodeURIComponent('channel==MINE')}&startDate=${ymd(r.start)}&endDate=${ymd(r.end)}&metrics=views,estimatedMinutesWatched&dimensions=video&sort=-views&maxResults=10`),
    ]);
    const obj = resp => {
      const names = (resp.columnHeaders || []).map(h => h.name);
      return (resp.rows || []).map(row => Object.fromEntries(names.map((n, i) => [n, row[i]])));
    };
    const tot = resp => obj(resp)[0] || Object.fromEntries(metrics.split(',').map(m => [m, 0]));
    const line = (resp, dates) => { const m = new Map(obj(resp).map(x => [x.day, x.views])); return dates.map(d => m.get(ymd(d)) || 0); };
    return { current: tot(cur), previous: tot(prev), views: line(daily, r.dates), pViews: line(pDaily, r.pDates), top: obj(top) };
  });
}

// ---------- small views ----------

function delta(cur, prev, kind = 'count') {
  if (kind === 'rate') {
    const d = (cur - prev) * 100;
    if (Math.abs(d) < 0.05) return el('span', { class: 'delta delta--flat', text: '— no change' });
    return el('span', { class: `delta ${d > 0 ? 'delta--up' : 'delta--down'}` }, el('span', { 'aria-hidden': 'true', text: d > 0 ? '▲ ' : '▼ ' }), `${d > 0 ? '+' : ''}${d.toFixed(1)} pts`);
  }
  if (cur === prev) return el('span', { class: 'delta delta--flat', text: '— no change' });
  if (!prev) return el('span', { class: 'delta delta--up' }, el('span', { 'aria-hidden': 'true', text: '▲ ' }), `new (0 → ${fmt.full(cur)})`);
  const pct = ((cur - prev) / prev) * 100;
  const raw = kind === 'count' && (cur < 100 || prev < 100) ? ` (${fmt.full(prev)} → ${fmt.full(cur)})` : '';
  return el('span', { class: `delta ${pct > 0 ? 'delta--up' : 'delta--down'}` },
    el('span', { 'aria-hidden': 'true', text: pct > 0 ? '▲ ' : '▼ ' }),
    `${pct > 0 ? '+' : ''}${Math.abs(pct) >= 10 ? Math.round(pct) : pct.toFixed(1)}%${raw}`);
}

function tile(label, value, d, extra) {
  return el('div', { class: 'tile' },
    el('div', { class: 'tile__label', text: label }),
    el('div', { class: 'tile__value', text: value }),
    d || null, extra || null);
}

function status(kind, text) {
  const icon = { ok: '✓', warn: '!', bad: '×', info: 'i' }[kind];
  return el('span', { class: `status status--${kind}` }, el('span', { class: 'status__icon', 'aria-hidden': 'true', text: icon }), text);
}

function errorBox(err) {
  return el('div', { class: 'err', role: 'alert' }, el('strong', { text: 'Google returned an error. ' }), err.message || String(err));
}

// A chart card with its table twin (every chart's values are readable without hovering).
function card(title, sub, chart, tableNode, { wide = false } = {}) {
  const body = el('div', { class: 'card__body' });
  const tbl = el('div', { class: 'card__table', hidden: true });
  if (tableNode) tbl.append(tableNode);
  const toggle = tableNode ? el('button', {
    class: 'link-btn', type: 'button', 'aria-pressed': 'false', text: 'Table',
    onclick: e => {
      const on = tbl.hidden;
      tbl.hidden = !on; body.hidden = on;
      e.currentTarget.setAttribute('aria-pressed', String(on));
      e.currentTarget.textContent = on ? 'Chart' : 'Table';
    },
  }) : null;
  const node = el('section', { class: `card${wide ? ' card--wide' : ''}` },
    el('header', { class: 'card__head' }, el('div', {}, el('h3', { class: 'card__title', text: title }), sub ? el('p', { class: 'card__sub', text: sub }) : null), toggle),
    body, tbl);
  if (chart) body._draw = chart; // drawn once the card is in the page (render → mountCharts)
  return node;
}

// ---------- shell ----------

function topbar() {
  const signedIn = !!state.auth.google;
  return el('header', { class: 'top' },
    el('a', { class: 'top__brand', href: '#/' }, el('span', { class: 'wordmark', text: 'HECTOR GARCIA QUIROS' }), el('span', { class: 'top__title', text: 'Analytics' })),
    el('div', { class: 'top__actions' },
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Switch light or dark', title: 'Light or dark', onclick: toggleTheme }, themeIcon()),
      signedIn ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: signOut, text: 'Sign out' }) : null));
}

function filters(r) {
  const group = el('div', { class: 'seg-ctl', role: 'group', 'aria-label': 'Date range' },
    PRESETS.map(([id, label]) => el('button', {
      type: 'button', class: 'seg-ctl__btn', 'aria-pressed': String(id === state.range), text: label,
      onclick: () => { state.range = id; localStorage.setItem('hq.range', id); render(); },
    })));
  return el('div', { class: 'filters' },
    group,
    el('p', { class: 'filters__note' },
      el('strong', { text: span(r.start, r.end) }), r.partial ? ' (includes today, still filling in)' : '',
      ` · compared with ${span(r.pStart, r.pEnd)}`, r.days !== r.pDays ? ` (${r.days} days vs ${r.pDays})` : ''),
    el('div', { class: 'filters__end' },
      state.updated ? el('span', { class: 'muted', text: `Read from Google at ${state.updated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` }) : null,
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Refresh', onclick: () => { state.cache.clear(); render(); } })));
}

function shell(main, r) {
  const expired = el('div', { class: 'expired', role: 'alert', hidden: !state.expired },
    'Your Google sign-in ran out (it lasts about an hour). The numbers below are from before it ran out. ',
    el('button', { class: 'btn btn--sm', type: 'button', text: 'Sign in again', onclick: () => signIn() }));
  return [topbar(), el('div', { class: 'wrap' }, expired, r ? filters(r) : null, main)];
}

// ---------- screens: setup and sign-in ----------

function setupScreen() {
  const origin = location.origin;
  const input = el('input', { id: 'cid', class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: '1234567890-abc123.apps.googleusercontent.com' });
  const msg = el('p', { class: 'form-msg', 'aria-live': 'polite' });
  const steps = [
    ['Open Google Cloud', ['Go to console.cloud.google.com and create a project (or reuse ', el('code', { text: 'hex-os-analytics' }), ' if you made it for Hex OS).']],
    ['Turn on four APIs', ['APIs & Services → Library: enable ', el('strong', { text: 'Google Analytics Admin API' }), ', ', el('strong', { text: 'Google Analytics Data API' }), ', ', el('strong', { text: 'YouTube Data API v3' }), ' and ', el('strong', { text: 'YouTube Analytics API' }), '.']],
    ['Set up the consent screen', ['Google Auth Platform → Branding: an app name and your email. Audience: External, leave it in ', el('strong', { text: 'Testing' }), ', and add your Google account as a test user. Only test users can sign in.']],
    ['Create the client', ['Google Auth Platform → Clients → Create client → Web application. Under Authorized JavaScript origins add ', el('code', { text: origin }), '.']],
    ['Paste the client ID here', ['It ends in ', el('code', { text: '.apps.googleusercontent.com' }), '. It isn’t a secret: it only names your app to Google.']],
  ];
  return el('main', { class: 'center' },
    el('div', { class: 'panel' },
      el('p', { class: 'eyebrow', text: 'One-time setup · about 10 minutes' }),
      el('h1', { class: 'display', text: 'CONNECT GOOGLE' }),
      el('p', { class: 'lede', text: 'This dashboard reads your numbers straight from Google in your browser. Google needs to know the dashboard is yours first.' }),
      el('ol', { class: 'steps' }, steps.map(([t, body]) => el('li', {}, el('strong', { class: 'steps__t', text: t }), el('span', {}, ...body)))),
      el('form', {
        class: 'form', onsubmit: e => {
          e.preventDefault();
          const v = input.value.trim();
          if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(v)) { msg.textContent = 'That doesn’t look like a web client ID. It looks like 1234567890-abc123.apps.googleusercontent.com.'; return; }
          localStorage.setItem('hq.clientId', v);
          render();
        },
      },
      el('label', { for: 'cid', class: 'label', text: 'OAuth client ID' }),
      el('div', { class: 'form__row' }, input, el('button', { class: 'btn', type: 'submit', text: 'Save' })), msg),
      el('p', { class: 'fine', text: 'Saved in this browser only. Google shows an “unverified app” notice because the app is yours and in Testing; that is expected. In Testing, Google asks you to approve again every 7 days.' })));
}

async function signIn() {
  const msg = document.querySelector('.form-msg');
  try {
    if (msg) msg.textContent = 'Opening Google…';
    await loadGis();
    await requestToken('google');
    state.expired = false;
    state.cache.clear();
    render();
  } catch (e) {
    if (msg) msg.textContent = e.message;
    else alert(e.message);
  }
}

function signInScreen() {
  return el('main', { class: 'center' },
    el('div', { class: 'panel' },
      el('p', { class: 'eyebrow', text: 'Websites · Content' }),
      el('h1', { class: 'display', text: 'ANALYTICS' }),
      el('p', { class: 'lede', text: `Google Analytics for ${SITES.length} websites and YouTube for your content clients, in one place.` }),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--lg', type: 'button', text: 'Sign in with Google', onclick: signIn })),
      el('p', { class: 'form-msg', 'aria-live': 'polite' }),
      el('p', { class: 'fine' }, 'Read-only access. Nothing is saved on a server: the sign-in lasts about an hour in this tab, and Google only shows what your account can see. ',
        el('button', { class: 'link-btn', type: 'button', text: 'Change the client ID', onclick: () => { localStorage.removeItem('hq.clientId'); render(); } }))));
}

// ---------- screen: overview ----------

const STATUS_TEXT = {
  connected: s => (s.how === 'domain' ? ['warn', `Property found by domain (${s.prop.mids[0] || 'no web stream'}). Add the ID to config.js`] : ['ok', 'Connected']),
  'no-access': () => ['warn', 'Tag is live, but this Google account can’t see its property'],
  missing: () => ['bad', 'Not in Google Analytics yet'],
};

async function overview(r) {
  await discover();
  const listed = state.sites.filter(s => s.status === 'connected');
  const all = [...listed, ...state.extra];
  const results = await Promise.all(all.map(s => siteOverview(s, r).then(d => ({ s, d }), e => ({ s, e }))));
  const live = await Promise.all(all.map(s => siteLive(s).catch(() => null)));
  const ok = results.filter(x => x.d && !x.s.extra);
  const sum = (k, which = 'current') => ok.reduce((a, x) => a + (x.d.totals[which][k] || 0), 0);
  const rate = which => (sum('sessions', which) ? sum('engagedSessions', which) / sum('sessions', which) : 0);
  const days = r.dates.map((_, i) => ok.reduce((a, x) => a + (x.d.users[i] || 0), 0));

  const hero = el('section', { class: 'hero' },
    el('div', { class: 'hero__main' },
      el('p', { class: 'eyebrow', text: `Visitors across ${ok.length} website${ok.length === 1 ? '' : 's'}` }),
      el('p', { class: 'hero__value', text: fmt.count(sum('activeUsers')) }),
      delta(sum('activeUsers'), sum('activeUsers', 'previous')),
      el('p', { class: 'fine', text: 'Added up site by site: someone who visited two of your sites counts on both.' })),
    el('div', { class: 'hero__spark' }, sparkline(days, { w: 320, h: 72, label: `Visitors per day, all sites, ${span(r.start, r.end)}` })));
  const kpis = el('section', { class: 'kpis', 'aria-label': 'All websites' },
    tile('Visits', fmt.count(sum('sessions')), delta(sum('sessions'), sum('sessions', 'previous'))),
    tile('Engaged visits', fmt.pct(rate('current')), delta(rate('current'), rate('previous'), 'rate')),
    tile('Page views', fmt.count(sum('screenPageViews')), delta(sum('screenPageViews'), sum('screenPageViews', 'previous'))),
    tile('Key events', fmt.count(sum('keyEvents')), delta(sum('keyEvents'), sum('keyEvents', 'previous')), el('p', { class: 'fine', text: 'Leads and other actions marked as key events, like generate_lead' })));

  // Coverage: every site in the list, and whether Google Analytics has it.
  const coverage = el('section', { class: 'card card--wide' },
    el('header', { class: 'card__head' }, el('div', {},
      el('h3', { class: 'card__title', text: 'Google Analytics coverage' }),
      el('p', { class: 'card__sub', text: `${state.sites.filter(s => s.status === 'connected').length} of ${state.sites.length} sites connected to this Google account` }))),
    el('ul', { class: 'cover' }, state.sites.map(s => {
      const [k, t] = STATUS_TEXT[s.status](s);
      return el('li', { class: 'cover__row' },
        el('span', { class: 'cover__name' }, el('strong', { text: s.name }), el('span', { class: 'muted', text: s.domain })),
        status(k, t),
        el('span', { class: 'cover__id muted', text: s.prop?.mids[0] || s.measurementId || '—' }));
    })),
    state.sites.some(s => s.status === 'missing')
      ? el('p', { class: 'fine pad', text: 'To add a missing site: create a property in Google Analytics (Admin → Create → Property, with a web stream for the domain), put the tag on every page, update the privacy policy to name Google Analytics, then put its G- ID in dashboard/config.js.' }) : null,
    state.sites.some(s => s.status === 'no-access')
      ? el('p', { class: 'fine pad', text: 'For a site whose property sits in someone else’s Google account, they add you under Admin → Property access management (Viewer is enough).' }) : null,
    state.extra.length ? el('p', { class: 'fine pad', text: `Also in your account, not in the site list: ${state.extra.map(x => x.name).join(', ')}.` }) : null);

  const grid = el('section', { class: 'sites' }, results.map(({ s, d, e }, i) => siteCard(s, d, e, live[i], r)));

  const ranked = ok.map(x => ({ label: x.s.name, value: x.d.totals.current.activeUsers })).sort((a, b) => b.value - a.value);
  const rankCard = card('Visitors by site', span(r.start, r.end), body => barList(body, ranked, { unit: 'visitors' }),
    table(ranked, [{ label: 'Site', get: x => x.label }, { label: 'Visitors', get: x => fmt.full(x.value), num: true }], 'Visitors by site'));

  const lineCard = card('Visitors per day, all sites', 'This period against the one before, day by day', body => lineChart(body, {
    labels: r.dates.map(short),
    series: [
      { name: 'Previous period', tone: 'dim', values: r.dates.map((_, i) => (r.pDates[i] ? ok.reduce((a, x) => a + (x.d.pUsers[i] ?? 0), 0) : null)), tipLabel: i => `previous (${r.pDates[i] ? short(r.pDates[i]) : 'no matching day'})` },
      { name: 'This period', tone: 'accent', values: days, tipLabel: () => 'this period' },
    ],
    ariaLabel: `Visitors per day across all sites, ${span(r.start, r.end)}, with the previous period`,
  }), table(r.dates.map((d, i) => ({ d, cur: days[i], prev: r.pDates[i] ? ok.reduce((a, x) => a + (x.d.pUsers[i] ?? 0), 0) : null, pd: r.pDates[i] })), [
    { label: 'Day', get: x => short(x.d) }, { label: 'Visitors', get: x => fmt.full(x.cur), num: true },
    { label: 'Previous period', get: x => (x.pd ? `${fmt.full(x.prev)} (${short(x.pd)})` : '—'), num: true }], 'Visitors per day'), { wide: true });
  lineCard.querySelector('.card__head').after(legend());

  return el('main', { class: 'main' },
    hero, kpis,
    el('h2', { class: 'section-title', text: 'Websites' }),
    coverage, grid,
    el('div', { class: 'two' }, rankCard, lineCard),
    el('h2', { class: 'section-title', text: 'Content clients' }),
    el('section', { class: 'sites' }, await Promise.all(CONTENT.map(c => contentCard(c)))),
    notes());
}

function legend() {
  return el('ul', { class: 'legend legend--line pad' },
    el('li', {}, el('span', { class: 'legend__line' }), 'This period'),
    el('li', {}, el('span', { class: 'legend__line legend__line--dim' }), 'Previous period'));
}

function siteCard(s, d, e, live, r) {
  const head = el('div', { class: 'site__head' },
    el('div', {}, el('h3', { class: 'site__name', text: s.name }), el('p', { class: 'muted small', text: `${s.domain} · ${s.kind}` })),
    live == null ? null : el('span', { class: 'live', title: 'Active in the last 30 minutes' }, el('span', { class: 'live__dot', 'aria-hidden': 'true' }), `${live} now`));
  if (e) return el('article', { class: 'site' }, head, errorBox(e));
  const c = d.totals.current, p = d.totals.previous;
  const node = el('a', { class: 'site site--link', href: `#/site/${encodeURIComponent(s.key)}`, 'aria-label': `${s.name}: open the full report` },
    head,
    el('div', { class: 'site__main' },
      el('div', {}, el('p', { class: 'site__value', text: fmt.count(c.activeUsers) }), el('p', { class: 'muted small', text: 'visitors' }), delta(c.activeUsers, p.activeUsers)),
      sparkline(d.users, { w: 140, h: 44, label: `${s.name} visitors per day` })),
    el('dl', { class: 'site__stats' },
      el('div', {}, el('dt', { text: 'Visits' }), el('dd', { text: fmt.count(c.sessions) })),
      el('div', {}, el('dt', { text: 'Engaged' }), el('dd', { text: c.sessions ? fmt.pct(c.engagementRate) : '—' })),
      el('div', {}, el('dt', { text: 'Key events' }), el('dd', { text: fmt.count(c.keyEvents) }))),
    c.activeUsers === 0 && p.activeUsers === 0 ? status('warn', 'No visits recorded in either period. Check the tag is live') : null,
    s.extra ? status('info', 'Not in the site list in config.js') : null);
  return node;
}

function notes() {
  const tzs = [...new Set(state.sites.filter(s => s.prop?.tz).map(s => s.prop.tz))];
  return el('footer', { class: 'notes' },
    el('h2', { class: 'section-title', text: 'About these numbers' }),
    el('ul', {},
      el('li', { text: 'Source: Google Analytics Data API for websites, YouTube Data and Analytics APIs for channels. Nothing is estimated or filled in; an error shows as an error.' }),
      el('li', { text: `Visitors are GA4 active users; visits are sessions; engaged visits lasted 10+ seconds, saw 2+ pages, or triggered a key event (Google’s definition). Days follow each property’s time zone${tzs.length ? ` (${tzs.join(', ')})` : ''}.` }),
      el('li', { text: 'Under 100, a change also shows the raw counts, because a few people move a percentage a lot. Google may filter known bots and can take a day to finish processing recent data.' }),
      el('li', { text: 'Instagram, TikTok and LinkedIn aren’t here: they offer no API this page can read for a personal account. Hex OS reads them through Metricool or exports.' })));
}

// ---------- screen: one site ----------

async function siteScreen(key, r) {
  await discover();
  const s = [...state.sites, ...state.extra].find(x => x.key === key);
  if (!s) return el('main', { class: 'main' }, back(), el('p', { text: 'There is no site with that name in the list.' }));
  const head = el('section', { class: 'detail-head' },
    back(),
    el('p', { class: 'eyebrow', text: s.kind }),
    el('h1', { class: 'display display--md', text: s.name.toUpperCase() }),
    el('p', { class: 'muted' },
      el('a', { href: `https://${s.domain}/`, target: '_blank', rel: 'noopener', text: s.domain }),
      s.prop ? ` · property ${s.prop.id} · ${s.prop.mids.join(', ') || 'no web stream'}${s.prop.tz ? ` · ${s.prop.tz}` : ''}` : ''));
  if (s.status !== 'connected') {
    const [k, t] = STATUS_TEXT[s.status](s);
    return el('main', { class: 'main' }, head, el('section', { class: 'card card--wide pad' }, status(k, t),
      el('p', { text: s.status === 'missing'
        ? 'This site isn’t in Google Analytics, so there are no numbers to show. Once a property exists for it in your account, it appears here by itself.'
        : 'The tag is on the site, but its property isn’t in this Google account. The owner can add you as a Viewer under Admin → Property access management.' })));
  }
  let ov, dt;
  try { [ov, dt] = await Promise.all([siteOverview(s, r), siteDetail(s, r)]); } catch (e) { return el('main', { class: 'main' }, head, errorBox(e)); }
  const c = ov.totals.current, p = ov.totals.previous;
  const engTime = t => (t.activeUsers ? t.userEngagementDuration / t.activeUsers : 0);
  const kpis = el('section', { class: 'kpis kpis--6' },
    tile('Visitors', fmt.count(c.activeUsers), delta(c.activeUsers, p.activeUsers)),
    tile('New visitors', fmt.count(c.newUsers), delta(c.newUsers, p.newUsers)),
    tile('Visits', fmt.count(c.sessions), delta(c.sessions, p.sessions)),
    tile('Engaged visits', c.sessions ? fmt.pct(c.engagementRate) : '—', c.sessions && p.sessions ? delta(c.engagementRate, p.engagementRate, 'rate') : null),
    tile('Time engaged per visitor', fmt.duration(engTime(c)), engTime(p) ? delta(engTime(c), engTime(p), 'duration') : null),
    tile('Key events', fmt.count(c.keyEvents), delta(c.keyEvents, p.keyEvents)));

  const line = card('Visitors per day', 'This period against the one before', body => lineChart(body, {
    labels: r.dates.map(short),
    series: [
      { name: 'Previous period', tone: 'dim', values: r.dates.map((_, i) => ov.pUsers[i] ?? null), tipLabel: i => `previous (${r.pDates[i] ? short(r.pDates[i]) : 'no matching day'})` },
      { name: 'This period', tone: 'accent', values: ov.users, tipLabel: () => 'this period' },
    ],
    ariaLabel: `${s.name} visitors per day, ${span(r.start, r.end)}, with the previous period`,
  }), table(r.dates.map((d, i) => ({ d, v: ov.users[i], s: ov.sessions[i], pv: ov.pUsers[i], pd: r.pDates[i] })), [
    { label: 'Day', get: x => short(x.d) }, { label: 'Visitors', get: x => fmt.full(x.v), num: true }, { label: 'Visits', get: x => fmt.full(x.s), num: true },
    { label: 'Previous period visitors', get: x => (x.pd ? `${fmt.full(x.pv)} (${short(x.pd)})` : '—'), num: true }], 'Visitors per day'), { wide: true });
  line.querySelector('.card__head').after(legend());

  const ch = dt.channels.map(x => ({ label: x.sessionDefaultChannelGroup || '(not set)', value: x.sessions, note: `${fmt.full(x.keyEvents)} key events` }));
  const src = dt.sources.map(x => ({ label: x.sessionSource || '(not set)', value: x.sessions, note: `${fmt.full(x.keyEvents)} key events` }));
  const cities = dt.cities.map(x => ({ label: x.city || '(not set)', value: x.activeUsers }));
  const devices = dt.devices.map(x => ({ label: x.deviceCategory, value: x.activeUsers })).sort((a, b) => (DEVICE_SLOTS[a.label] || 9) - (DEVICE_SLOTS[b.label] || 9));
  const simple = (lab, unit) => [{ label: lab, get: x => x.label }, { label: unit, get: x => fmt.full(x.value), num: true }];

  const pagesTbl = dt.pages.length ? table(dt.pages, [
    { label: 'Page', get: x => x.pagePath }, { label: 'Views', get: x => fmt.full(x.screenPageViews), num: true },
    { label: 'Visitors', get: x => fmt.full(x.activeUsers), num: true }], 'Top pages') : el('p', { class: 'empty', text: 'No data in this period.' });
  const eventsTbl = dt.events.length ? table(dt.events, [
    { label: 'Event', get: x => x.eventName }, { label: 'Count', get: x => fmt.full(x.eventCount), num: true },
    { label: 'Key event', get: x => (x.keyEvents > 0 ? `Yes (${fmt.full(x.keyEvents)})` : '—') }], 'Events') : el('p', { class: 'empty', text: 'No data in this period.' });

  return el('main', { class: 'main' }, head, kpis, line,
    el('div', { class: 'two' },
      card('Where visits came from', 'Visits by channel', b => barList(b, ch, { unit: 'visits' }), table(ch, simple('Channel', 'Visits'), 'Channels')),
      card('Top sources', 'Visits by source', b => barList(b, src, { unit: 'visits' }), table(src, simple('Source', 'Visits'), 'Sources'))),
    el('div', { class: 'two' },
      el('section', { class: 'card' }, el('header', { class: 'card__head' }, el('div', {}, el('h3', { class: 'card__title', text: 'Top pages' }), el('p', { class: 'card__sub', text: 'By page views' }))), el('div', { class: 'card__scroll' }, pagesTbl)),
      el('section', { class: 'card' }, el('header', { class: 'card__head' }, el('div', {}, el('h3', { class: 'card__title', text: 'Actions' }), el('p', { class: 'card__sub', text: 'Every event, and which ones count as key events' }))), el('div', { class: 'card__scroll' }, eventsTbl))),
    el('div', { class: 'two' },
      card('Devices', 'Visitors by device', b => segmentedBar(b, devices, { slots: DEVICE_SLOTS }), table(devices, simple('Device', 'Visitors'), 'Devices')),
      card('Cities', 'Visitors by city (Google’s estimate from the connection)', b => barList(b, cities, { unit: 'visitors' }), table(cities, simple('City', 'Visitors'), 'Cities'))));
}

function back() { return el('a', { class: 'back', href: '#/', text: '← All analytics' }); }

// ---------- content clients ----------

async function contentCard(c) {
  let data;
  try { data = await ytChannel(c); } catch (e) {
    return el('article', { class: 'site' }, el('div', { class: 'site__head' }, el('h3', { class: 'site__name', text: c.name })), errorBox(e));
  }
  const st = data.channel.statistics;
  const r = rangeFor(state.range);
  const inRange = data.videos.filter(v => v.published >= r.start && v.published < addDays(r.end, 1));
  return el('a', { class: 'site site--link site--wide', href: `#/content/${encodeURIComponent(c.key)}`, 'aria-label': `${c.name}: open the channel report` },
    el('div', { class: 'site__head' },
      el('div', { class: 'yt-id' },
        data.channel.snippet.thumbnails?.default?.url ? el('img', { class: 'yt-id__img', src: data.channel.snippet.thumbnails.default.url, alt: '', width: 44, height: 44 }) : null,
        el('div', {}, el('h3', { class: 'site__name', text: c.name }), el('p', { class: 'muted small', text: `YouTube ${c.handle} · ${c.work}` })))),
    el('dl', { class: 'site__stats site__stats--4' },
      el('div', {}, el('dt', { text: 'Subscribers' }), el('dd', { text: st.hiddenSubscriberCount ? 'hidden' : fmt.count(Number(st.subscriberCount)) })),
      el('div', {}, el('dt', { text: 'Channel views' }), el('dd', { text: fmt.count(Number(st.viewCount)) })),
      el('div', {}, el('dt', { text: 'Videos' }), el('dd', { text: fmt.count(Number(st.videoCount)) })),
      el('div', {}, el('dt', { text: 'Uploads this period' }), el('dd', { text: data.videos.length >= 25 && inRange.length === data.videos.length ? '25+' : String(inRange.length) }))),
    el('p', { class: 'fine', text: `All-time public totals as of ${data.pulled.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Open for watch time and the period’s views.` }));
}

async function contentScreen(key, r) {
  const c = CONTENT.find(x => x.key === key);
  if (!c) return el('main', { class: 'main' }, back(), el('p', { text: 'There is no content client with that name.' }));
  let data;
  try { data = await ytChannel(c); } catch (e) { return el('main', { class: 'main' }, back(), errorBox(e)); }
  const ch = data.channel, st = ch.statistics;
  const head = el('section', { class: 'detail-head' }, back(),
    el('p', { class: 'eyebrow', text: 'Content client · YouTube' }),
    el('h1', { class: 'display display--md', text: c.name.toUpperCase() }),
    el('p', { class: 'muted' }, el('a', { href: `https://www.youtube.com/${c.handle}`, target: '_blank', rel: 'noopener', text: `youtube.com/${c.handle}` }), ` · ${c.work}`));

  const lifetime = el('section', { class: 'kpis' },
    tile('Subscribers', st.hiddenSubscriberCount ? 'hidden' : fmt.count(Number(st.subscriberCount)), null, el('p', { class: 'fine', text: 'Public count; YouTube rounds it down to 3 significant figures' })),
    tile('Channel views, all time', fmt.count(Number(st.viewCount)), null, el('p', { class: 'fine', text: 'Since Aug 24, 2026 YouTube counts a view when playback starts, so older totals aren’t like-for-like' })),
    tile('Videos', fmt.count(Number(st.videoCount))),
    tile('Uploads this period', String(data.videos.filter(v => v.published >= r.start && v.published < addDays(r.end, 1)).length), null, el('p', { class: 'fine', text: 'Among the 25 most recent uploads' })));

  // Period numbers need the channel's own sign-in (YouTube only gives analytics to the channel).
  let period;
  if (!state.auth.channel) {
    period = el('section', { class: 'card card--wide pad connect' },
      el('h3', { class: 'card__title', text: 'Watch time and views for this period' }),
      el('p', { text: `YouTube only gives these numbers to the channel itself. Connect once per session and pick ${ch.snippet.title} in Google’s account list (as a manager of its Brand Account, it is listed under your account).` }),
      el('div', { class: 'btn-row' }, el('button', {
        class: 'btn', type: 'button', text: 'Connect channel', onclick: async e => {
          e.currentTarget.disabled = true;
          try { await loadGis(); await requestToken('channel'); render(); } catch (err) { e.currentTarget.disabled = false; e.currentTarget.after(el('p', { class: 'form-msg', text: err.message })); }
        },
      })));
  } else {
    try {
      const a = await ytAnalytics(c, ch, r);
      const cur = a.current, prev = a.previous;
      const net = x => (x.subscribersGained || 0) - (x.subscribersLost || 0);
      const titles = new Map(data.videos.map(v => [v.id, v.title]));
      const top = a.top.map(x => ({ label: titles.get(x.video) || x.video, value: x.views, note: `${fmt.hours(x.estimatedMinutesWatched)} hours watched` }));
      period = el('div', {},
        el('section', { class: 'kpis' },
          tile('Views', fmt.count(cur.views), delta(cur.views, prev.views)),
          tile('Hours watched', fmt.hours(cur.estimatedMinutesWatched), delta(cur.estimatedMinutesWatched, prev.estimatedMinutesWatched, 'duration')),
          tile('Average view', fmt.duration(cur.averageViewDuration), prev.averageViewDuration ? delta(cur.averageViewDuration, prev.averageViewDuration, 'duration') : null),
          tile('Subscribers, net', `${net(cur) >= 0 ? '+' : ''}${fmt.full(net(cur))}`, null, el('p', { class: 'fine', text: `+${fmt.full(cur.subscribersGained)} gained, −${fmt.full(cur.subscribersLost)} lost. Before: ${net(prev) >= 0 ? '+' : ''}${fmt.full(net(prev))}` }))),
        (() => {
          const k = card('Views per day', 'This period against the one before. YouTube Analytics runs 2–3 days behind', b => lineChart(b, {
            labels: r.dates.map(short),
            series: [
              { name: 'Previous period', tone: 'dim', values: r.dates.map((_, i) => a.pViews[i] ?? null), tipLabel: i => `previous (${r.pDates[i] ? short(r.pDates[i]) : 'no matching day'})` },
              { name: 'This period', tone: 'accent', values: a.views, tipLabel: () => 'this period' },
            ],
            ariaLabel: `${c.name} views per day`,
          }), table(r.dates.map((d, i) => ({ d, v: a.views[i], pv: a.pViews[i], pd: r.pDates[i] })), [
            { label: 'Day', get: x => short(x.d) }, { label: 'Views', get: x => fmt.full(x.v), num: true },
            { label: 'Previous period', get: x => (x.pd ? `${fmt.full(x.pv)} (${short(x.pd)})` : '—'), num: true }], 'Views per day'), { wide: true });
          k.querySelector('.card__head').after(legend());
          return k;
        })(),
        card('Most-watched videos this period', 'Views in the period, any upload date', b => barList(b, top, { unit: 'views' }),
          table(top, [{ label: 'Video', get: x => x.label }, { label: 'Views', get: x => fmt.full(x.value), num: true }, { label: 'Watch time', get: x => x.note }], 'Top videos'), { wide: true }));
    } catch (e) {
      period = el('section', { class: 'card card--wide pad' }, errorBox(e),
        el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--ghost', type: 'button', text: 'Connect a different account', onclick: async () => { state.auth.channel = null; [...state.cache.keys()].filter(k => k.startsWith('yta|')).forEach(k => state.cache.delete(k)); try { await requestToken('channel'); } finally { render(); } } })));
    }
  }

  const uploads = el('section', { class: 'card card--wide' },
    el('header', { class: 'card__head' }, el('div', {}, el('h3', { class: 'card__title', text: 'Recent uploads' }), el('p', { class: 'card__sub', text: `All-time numbers for each video, as of ${data.pulled.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` }))),
    el('div', { class: 'card__scroll' }, el('table', { class: 'tbl tbl--videos' },
      el('thead', {}, el('tr', {}, ['Video', 'Published', 'Views', 'Likes', 'Comments'].map((h, i) => el('th', { scope: 'col', class: i > 1 ? 'num' : null, text: h })))),
      el('tbody', {}, data.videos.slice(0, 15).map(v => el('tr', {},
        el('th', { scope: 'row' }, el('a', { class: 'vid', href: `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`, target: '_blank', rel: 'noopener' },
          v.thumb ? el('img', { src: v.thumb, alt: '', width: 96, height: 54, loading: 'lazy' }) : null, el('span', { text: v.title }))),
        el('td', { text: v.published.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }),
        el('td', { class: 'num', text: fmt.full(v.views) }),
        el('td', { class: 'num', text: v.likes == null ? 'hidden' : fmt.full(v.likes) }),
        el('td', { class: 'num', text: v.comments == null ? 'off' : fmt.full(v.comments) })))))));

  return el('main', { class: 'main' }, head, lifetime, period, uploads);
}

// ---------- theme ----------

// A circle, half filled: the usual light/dark symbol, drawn so it renders the same everywhere.
function themeIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS(NS, 'circle');
  for (const [k, v] of Object.entries({ cx: 8, cy: 8, r: 6.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 })) ring.setAttribute(k, v);
  const half = document.createElementNS(NS, 'path');
  half.setAttribute('d', 'M8 1.5a6.5 6.5 0 0 1 0 13z'); half.setAttribute('fill', 'currentColor');
  svg.append(ring, half);
  return svg;
}

function toggleTheme() {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('hq.theme', next);
}

// ---------- render ----------

function mountCharts() {
  app.querySelectorAll('.card__body').forEach(b => { if (b._draw) { const d = b._draw; delete b._draw; d(b); } });
}

let ticket = 0;
async function render({ keepScroll = true } = {}) {
  hideTip();
  const mine = ++ticket;
  if (!clientId()) { app.replaceChildren(...shell(setupScreen())); return; }
  if (!state.auth.google) { app.replaceChildren(...shell(signInScreen())); return; }
  const r = rangeFor(state.range);
  const hash = location.hash || '#/';
  // Refetch keeps the frame: the old view stays, dimmed, until the new one is ready.
  const current = app.querySelector('.main');
  if (current) current.classList.add('is-loading');
  else app.replaceChildren(...shell(el('main', { class: 'main' }, el('p', { class: 'loading', role: 'status', text: 'Reading your numbers from Google…' })), r));
  let view;
  try {
    const m = hash.match(/^#\/(site|content)\/(.+)$/);
    view = m ? await (m[1] === 'site' ? siteScreen : contentScreen)(decodeURIComponent(m[2]), r) : await overview(r);
    state.updated = new Date();
  } catch (e) {
    view = el('main', { class: 'main' }, errorBox(e));
  }
  if (mine !== ticket) return; // a newer render started while this one waited
  if (state.expired && current) {
    // Keep the last good numbers on screen rather than swapping in "sign-in ran out" errors.
    current.classList.remove('is-loading');
    const bar = document.querySelector('.expired');
    if (bar) bar.hidden = false;
    return;
  }
  const scroll = window.scrollY;
  app.replaceChildren(...shell(view, r));
  mountCharts();
  window.scrollTo(0, keepScroll ? scroll : 0);
}

window.addEventListener('hashchange', () => render({ keepScroll: false }));
render();
