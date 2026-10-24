// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
/* ModHaven renderer */
'use strict';
const call = (ch, arg) => window.mh.call(ch, arg);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = esc;

const S = {
  info: null, settings: null, catalog: null, catalogErrors: {}, managed: [],
  view: 'games', gamesFilter: { q: '', mode: 'all', source: null, sort: 'smart' },
  game: null, profileName: null, profile: null, analysis: null, tab: 'installed',
  inst: { sel: null, q: '', filter: 'all' },
  browse: { q: '', sort: 'popular', sources: [], page: 0, mods: [], hasMore: true, loading: false, sel: null, token: 0, perSource: {}, gameVersion: '' },
  runs: [], runSel: 'overview', running: {}, search: null, downloads: [], cfgSel: null,
};
const detailCache = new Map();

// ---------- icons ----------
const I = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/></svg>',
  vanilla: '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14" transform="rotate(45 12 12)"/><circle cx="12" cy="12" r="9"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 20V9M7 13l5-5 5 5M5 4h14"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  bug: '<svg viewBox="0 0 24 24"><path d="M8 8a4 4 0 0 1 8 0v1H8zM6 10h12v4a6 6 0 0 1-12 0zM12 14v6M3 13h3M18 13h3M4 19l3-2M20 19l-3-2M4 7l3 2M20 7l-3 2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
  grip: '<svg viewBox="0 0 24 24" width="14" height="14"><g fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></g></svg>',
  box: '<svg viewBox="0 0 24 24"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>',
  pulse: '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
};

// Status triangles: red = broken/out of date, yellow = conflict, green = updated + works, half = untested
function tri(status, size = 18) {
  const p = 'M12 2.6c.5 0 1 .3 1.3.8l9.1 15.8c.6 1-.1 2.2-1.3 2.2H2.9c-1.2 0-1.9-1.2-1.3-2.2l9.1-15.8c.3-.5.8-.8 1.3-.8z';
  const fill = { broken: 'var(--red)', conflict: 'var(--yellow)', works: 'var(--green)', untested: 'url(#halfYG)' }[status] || 'var(--text-3)';
  const mark = status === 'works' ? '<path d="m8.3 14.2 2.6 2.5 4.9-5.4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
    : status === 'untested' ? '<text x="12" y="18.6" text-anchor="middle" font-size="9.5" font-weight="800" fill="#1b1d24" font-family="Segoe UI">?</text>'
      : `<path d="M12 8.6v4.9" stroke="${status === 'conflict' ? '#2a2100' : '#fff'}" stroke-width="2.3" stroke-linecap="round"/><circle cx="12" cy="17" r="1.3" fill="${status === 'conflict' ? '#2a2100' : '#fff'}"/>`;
  return `<svg class="tri" viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${p}" fill="${fill}"/>${mark}</svg>`;
}
const STATUS_LABEL = { broken: 'Out of date / broken', conflict: 'Conflicts with another mod', works: 'Updated and working', untested: 'Not tested yet' };

// ---------- helpers ----------
function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
function ago(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!t) return '—';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  const m = s / 60, h = m / 60, d = h / 24;
  if (m < 60) return `${Math.floor(m)} min ago`;
  if (h < 24) return `${Math.floor(h)} h ago`;
  if (d < 30) return `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago`;
  if (d < 365) return `${Math.floor(d / 30)} month${Math.floor(d / 30) === 1 ? '' : 's'} ago`;
  return `${Math.floor(d / 365)} year${Math.floor(d / 365) === 1 ? '' : 's'} ago`;
}
const fullDate = iso => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const fmtBytes = b => (b == null ? '' : b > 1 << 30 ? (b / (1 << 30)).toFixed(1) + ' GB' : b > 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB');
const srcMeta = id => (S.info.sources.find(s => s.id === id) || { id, name: id === 'local' ? 'Local file' : id, color: '#8a8f9c' });
const srcBadge = id => { const s = srcMeta(id); return `<span class="badge src-badge" style="--c:${attr(s.color)}"><i class="dot" style="background:${attr(s.color)}"></i>${esc(s.name)}</span>`; };
const img = (src, cls, alt = '') => (src ? `<img class="${cls}" src="${attr(src)}" alt="${attr(alt)}" loading="lazy" referrerpolicy="no-referrer" data-hideonerr>` : `<div class="${cls}"></div>`);
// Game artwork that fits any image shape. Tall box art fills the frame; wide banners and
// small icons sit on a blurred copy of themselves. Broken links fall through to the next
// image, and a generated cover is the last resort.
const artGood = new Map(); // game name -> the url that last loaded, so re-rendered frames skip dead links
// Managed games saved by older versions have no image list: borrow the catalog's when it is loaded.
function withArt(g) {
  if (!g || !S.catalog || (g.images && g.images.length)) return g;
  const e = S.catalog.find(x => x.key === g.key);
  return e && e.images && e.images.length ? { ...g, images: e.images, image: g.image || e.image } : g;
}
const artList = g => (g.images && g.images.length ? g.images : g.image ? [{ url: g.image, kind: 'any' }] : []);
// For CSS url("..."): keep quotes and parens in local file paths from ending the string early.
const cssUrl = u => `url("${String(u).replace(/["'()\\\r\n]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))}")`;
function gameArt(g, cls = '') {
  let list = artList(withArt(g)).map(x => x.url);
  const good = artGood.get(g.name);
  if (good) list = [good, ...list.filter(u => u !== good)];
  const hue = hueOf(g.name || g.key || '?');
  return `<div class="gart ${cls}" style="--h:${hue}" data-imgs="${attr(JSON.stringify(list))}" data-i="0" data-name="${attr(g.name || '')}"${list.length ? '' : ' data-needart'}>
    <div class="gart-ph"><b>${esc(initials(g.name))}</b><span>${esc(g.name || '')}</span></div>
    ${list.length ? `<img class="gart-img" src="${attr(list[0])}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</div>`;
}
function artLoaded(img) {
  const box = img.closest('.gart');
  if (!box) return;
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return artFailed(img);
  const r = w / h;
  // Every frame is 2:3 box art except the square sidebar thumbs. Measure when laid out; a hidden or
  // collapsed frame (display:none view, not yet sized) would give a wrong shape, so fall back to 2:3.
  const bw = box.clientWidth, bh = box.clientHeight;
  const boxR = bw > 8 && bh > 8 ? bw / bh : 2 / 3;
  // Close enough to the frame's own shape: fill it. Tiny images: show as an icon. Otherwise fit.
  const mode = box.classList.contains('thumb') || Math.abs(Math.log(r / boxR)) < 0.22 ? 'fill' : (w < 160 || h < 160) ? 'icon' : 'fit';
  box.dataset.mode = mode;
  if (mode !== 'fill') box.style.setProperty('--art', cssUrl(img.src)); else box.style.removeProperty('--art');
  box.classList.remove('noimg');
  box.classList.add('ready');
  if (box.dataset.name) artGood.set(box.dataset.name, img.getAttribute('src'));
}
function artFailed(img) {
  const box = img.closest('.gart');
  if (!box) return;
  const list = JSON.parse(box.dataset.imgs || '[]');
  const i = Number(box.dataset.i) + 1;
  if (artGood.get(box.dataset.name) === img.getAttribute('src')) artGood.delete(box.dataset.name);
  box.classList.remove('ready');
  if (i < list.length) { box.dataset.i = i; img.src = list[i]; }
  else { img.remove(); box.classList.add('noimg'); needArt(box); }
}
// No artwork from the mod sites (or all of it is gone): ask the Steam store once the card is on screen.
const artFound = new Map(); // name -> Promise<urls>; failed lookups are dropped so they can be retried
const artObs = new IntersectionObserver(es => {
  for (const e of es) {
    if (!e.isIntersecting) continue;
    artObs.unobserve(e.target);
    fetchArt(e.target);
  }
}, { rootMargin: '300px' });
function needArt(box) {
  if (box.dataset.looked) return;
  box.dataset.looked = '1';
  artObs.observe(box);
}
function lookupArt(name) {
  let p = artFound.get(name);
  if (!p) {
    p = call('art:lookup', name).then(r => (r || []).map(x => x.url).filter(Boolean));
    artFound.set(name, p);
    p.catch(() => artFound.delete(name));
  }
  return p;
}
async function fetchArt(box) {
  const name = box.dataset.name;
  if (!name || !box.isConnected) return;
  let urls;
  try { urls = await lookupArt(name); } catch { delete box.dataset.looked; return; }
  const tried = new Set(JSON.parse(box.dataset.imgs || '[]'));
  const fresh = urls.filter(u => !tried.has(u));
  if (!fresh.length || !box.isConnected || box.querySelector('.gart-img')) return;
  box.dataset.imgs = JSON.stringify(fresh);
  box.dataset.i = '0';
  box.insertAdjacentHTML('beforeend', `<img class="gart-img" src="${attr(fresh[0])}" alt="" decoding="async" referrerpolicy="no-referrer">`);
}
// Hooks up frames as they are added (and lets go of the ones a re-render threw away).
new MutationObserver(ms => {
  for (const m of ms) {
    for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches('.gart[data-needart]')) needArt(n);
      n.querySelectorAll('.gart[data-needart]').forEach(needArt);
      // Already decoded (memory cache) before this ran: make sure it still gets its mode.
      n.querySelectorAll('.gart:not(.ready) > .gart-img').forEach(im => { if (im.complete && im.naturalWidth) artLoaded(im); });
    }
    for (const n of m.removedNodes) {
      if (n.nodeType !== 1 || n.isConnected) continue;
      if (n.matches('.gart[data-looked]')) artObs.unobserve(n);
      n.querySelectorAll('.gart[data-looked]').forEach(b => artObs.unobserve(b));
    }
  }
}).observe(document.body, { childList: true, subtree: true });
const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const hueOf = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

function toast(text, kind = 'info', ms = 5000) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<div class="grow">${text}</div><button aria-label="Close">×</button>`;
  el.querySelector('button').onclick = () => el.remove();
  $('#toasts').appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}
const fail = e => toast(esc(e.message || e), 'error', 8000);

function modal(html, { wide } = {}) {
  const root = $('#modalRoot');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog">${html}</div>`;
  root.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.addEventListener('mousedown', e => { if (e.target === scrim) close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  return { el: scrim.firstChild, close };
}
function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    const m = modal(`<header><div><h2>${esc(title)}</h2></div></header><div class="mbody"><div>${text}</div></div>
      <footer><button class="btn" data-a="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(okLabel)}</button></footer>`);
    m.el.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; m.close(); res(a.dataset.a === 'yes'); });
  });
}
function prompt2(title, label, value = '', okLabel = 'Save', hint = '') {
  return new Promise(res => {
    const m = modal(`<header><div><h2>${esc(title)}</h2></div></header><div class="mbody"><div class="field"><label>${esc(label)}</label>
      <input class="input" id="pv" value="${attr(value)}" spellcheck="false">${hint ? `<span class="hint">${hint}</span>` : ''}</div></div>
      <footer><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="yes">${esc(okLabel)}</button></footer>`);
    const inp = $('#pv', m.el); inp.focus(); inp.select();
    const done = ok => { m.close(); res(ok ? inp.value : null); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); });
    m.el.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (a) done(a.dataset.a === 'yes'); });
  });
}
function menu(anchor, items) {
  $$('.menu').forEach(m => m.remove());
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon || ''}<span>${esc(it.label)}</span></button>`)).join('');
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, hgt = el.offsetHeight;
  el.style.left = Math.min(innerWidth - w - 8, Math.max(8, r.right - w)) + 'px';
  el.style.top = (r.bottom + hgt + 8 > innerHeight ? r.top - hgt - 6 : r.bottom + 6) + 'px';
  $$('.menu svg', el).forEach(s => { s.setAttribute('width', 16); s.setAttribute('height', 16); s.style.cssText = 'fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round'; });
  const off = e => { if (!el.contains(e.target)) { el.remove(); document.removeEventListener('mousedown', off, true); } };
  setTimeout(() => document.addEventListener('mousedown', off, true));
  el.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; el.remove(); items[b.dataset.i].run(); });
}

// Keeps a scroll container where it was while its contents are rebuilt.
function keepScroll(el, fn) { const top = el ? el.scrollTop : 0; fn(); if (el) el.scrollTop = top; }

// ---------- theme ----------
function applyTheme() {
  const st = S.settings;
  const resolved = st.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : st.theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.classList.toggle('compact', st.density === 'compact');
  const acc = st.accent || '#7c5cff';
  const r = document.documentElement.style;
  r.setProperty('--accent', acc);
  r.setProperty('--accent-2', shift(acc));
  r.setProperty('--accent-text', lum(acc) > 0.55 ? '#111' : '#fff');
  const bar = resolved === 'dark' ? { color: '#0f1117', symbolColor: '#c9cfe0' } : { color: '#f3f4f8', symbolColor: '#30364a' };
  call('titlebar:set', bar).catch(() => { });
}
function hexRgb(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lum(h) { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function shift(h) { const [r, g, b] = hexRgb(h); return `rgb(${Math.min(255, b + 40)}, ${Math.min(255, r * 0.5 + 90)}, ${Math.min(255, g + 120)})`; }

// ---------- navigation ----------
function showView(v) {
  S.view = v;
  $$('.view').forEach(x => x.classList.toggle('on', x.id === 'view-' + v));
  $$('.nav').forEach(x => x.classList.toggle('on', x.dataset.view === v || (v === 'game' && false)));
  renderSidebar();
  renderCrumbs();
  if (v === 'games' && !S.catalog) loadCatalog();
  if (v === 'downloads') renderDownloads();
  if (v === 'settings') renderSettings();
}
function renderCrumbs() {
  const parts = [];
  if (S.view === 'game' && S.game) parts.push('Games', S.game.name, S.profileName || '');
  else parts.push({ games: 'Games', downloads: 'Downloads', settings: 'Settings' }[S.view] || '');
  $('#crumbs').innerHTML = parts.filter(Boolean).map((p, i) => (i ? '<span>›</span>' : '') + `<b>${esc(p)}</b>`).join('');
}
function renderSidebar() {
  const box = $('#myGames');
  if (!S.managed.length) { box.innerHTML = '<div class="empty-side">Pick a game to start modding. It will show up here.</div>'; }
  else box.innerHTML = S.managed.map(g => `<button class="mygame ${S.view === 'game' && S.game && S.game.key === g.key ? 'on' : ''}" data-key="${attr(g.key)}" title="${attr(g.name)}">
      ${gameArt(g, 'thumb')}<span>${esc(g.name)}</span>${S.running[g.key] ? '<i class="pulse live" title="Running"></i>' : ''}</button>`).join('');
  $('#sideFoot').innerHTML = `ModHaven ${esc(S.info.version)} by <a href="${attr(S.info.homepage)}">${esc(S.info.author)}</a> · <a href="#" id="openData">data folder</a>`;
}
document.addEventListener('click', e => {
  const nav = e.target.closest('.nav');
  if (nav) showView(nav.dataset.view);
  const mg = e.target.closest('.mygame');
  if (mg) openManaged(mg.dataset.key);
  if (e.target.id === 'openData') { e.preventDefault(); call('shell:dataFolder'); }
  const a = e.target.closest('a[href^="http"]');
  if (a) { e.preventDefault(); call('shell:url', a.href); }
});

// Inline handlers are blocked by the page's security policy, so these are delegated.
document.addEventListener('load', e => { if (e.target.classList && e.target.classList.contains('gart-img')) artLoaded(e.target); }, true);
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName !== 'IMG') return;
  if (t.classList.contains('gart-img')) return artFailed(t);
  if (t.hasAttribute('data-removeonerr')) t.remove(); else t.style.visibility = 'hidden';
}, true);
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); setTab(go.dataset.go); }
  if (e.target.closest('[data-allsites]')) { S.browse.sources = []; resetBrowse(); }
  const run = e.target.closest('a[data-run]');
  if (run) { e.preventDefault(); S.runSel = run.dataset.run; showView('game'); setTab('crash'); }
});

// ---------- tooltips ----------
const tip = $('#tip');
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-tip], [data-tipuid]');
  if (!t) { tip.classList.remove('on'); return; }
  let html = '';
  if (t.dataset.tipuid) {
    const st = S.analysis && S.analysis.status[t.dataset.tipuid];
    if (!st) return;
    html = `<b>${esc(STATUS_LABEL[st.status])}</b><ul>${st.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`;
  } else html = esc(t.dataset.tip);
  tip.innerHTML = html;
  tip.classList.add('on');
  const r = t.getBoundingClientRect();
  const w = tip.offsetWidth, hh = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  tip.style.top = (r.top - hh - 8 < 40 ? r.bottom + 8 : r.top - hh - 8) + 'px';
});
document.addEventListener('mousedown', () => tip.classList.remove('on'));

// ======================================================================
// GAMES
// ======================================================================
async function loadCatalog(force) {
  const v = $('#view-games');
  if (!S.catalog) v.innerHTML = `<div class="page-head"><div><h1>Games</h1><div class="sub">Gathering games from every mod site…</div></div></div><div class="center"><span class="spinner"></span>Loading game lists from ${S.info.sources.map(s => esc(s.name)).join(', ')}</div>`;
  try {
    const r = await call('catalog:get', { force });
    S.catalog = r.games; S.catalogErrors = r.errors || {};
    renderGames();
    renderSidebar(); // older saved games pick up the catalog's artwork
  } catch (e) { fail(e); }
}

function filteredGames() {
  const f = S.gamesFilter;
  const q = f.q.trim().toLowerCase();
  const managed = new Set(S.managed.map(g => g.key));
  let list = S.catalog.filter(g => (!q || g.name.toLowerCase().includes(q))
    && (f.mode !== 'installed' || g.installed) && (f.mode !== 'managed' || managed.has(g.key))
    && (!f.source || g.sources[f.source]));
  if (f.mode !== 'installed' && !q) list = list.filter(g => Object.keys(g.sources).length || g.installed);
  if (f.sort === 'az') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  else if (f.sort === 'mods') list = [...list].sort((a, b) => (b.totalMods || 0) - (a.totalMods || 0));
  else if (f.sort === 'sites') list = [...list].sort((a, b) => Object.keys(b.sources).length - Object.keys(a.sources).length || a.name.localeCompare(b.name));
  else list = [...list].sort((a, b) => (managed.has(b.key) - managed.has(a.key)) || (!!b.installed - !!a.installed) || (Object.keys(b.sources).length - Object.keys(a.sources).length) || a.name.localeCompare(b.name));
  return list;
}

function renderGames() {
  const v = $('#view-games');
  const f = S.gamesFilter;
  const cat = S.catalog || [];
  const inst = cat.filter(g => g.installed).length;
  const srcUsed = S.info.sources.filter(s => S.settings.sources[s.id] !== false && (!s.needsKey || s.keylessBrowse || S.settings.keys[s.id]));
  const missingKeys = S.info.sources.filter(s => s.needsKey && !s.keylessBrowse && !S.settings.keys[s.id] && S.settings.sources[s.id] !== false);
  v.innerHTML = `
    <div class="page-head"><div><h1>Games</h1><div class="sub">${fmtNum(cat.length)} games from ${srcUsed.map(s => esc(s.name)).join(', ')} · ${inst} installed on this PC</div></div>
      <div class="grow" style="flex:1"></div>
      <button class="btn" id="gRefresh">${I.refresh}Refresh lists</button></div>
    ${missingKeys.length ? `<div class="banner info" style="margin:0 28px 14px"><div class="grow">Add free API keys for <b>${missingKeys.map(s => esc(s.name)).join(' and ')}</b> to see their games and mods too.</div><button class="btn sm" id="gKeys">Add keys</button></div>` : ''}
    ${Object.keys(S.catalogErrors).length ? `<div class="banner warn" style="margin:0 28px 14px"><div class="grow">Couldn't reach ${Object.keys(S.catalogErrors).map(id => esc(srcMeta(id).name)).join(', ')} — showing saved lists.</div></div>` : ''}
    <div class="toolbar">
      <div class="search" style="width:320px">${I.search}<input class="input" id="gQ" placeholder="Search ${fmtNum(cat.length)} games…" value="${attr(f.q)}" spellcheck="false"></div>
      <div class="seg" id="gMode">${[['all', 'All'], ['installed', `Installed (${inst})`], ['managed', 'Modded']].map(([k, l]) => `<button data-k="${k}" class="${f.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="row" id="gSrc">${srcUsed.map(s => `<button class="chip ${f.source === s.id ? 'on' : ''}" data-s="${s.id}"><i class="dot" style="background:${attr(s.color)}"></i>${esc(s.name)}</button>`).join('')}</div>
      <div class="grow"></div>
      <select class="input" id="gSort"><option value="smart">Installed first</option><option value="az">A–Z</option><option value="mods">Most mods</option><option value="sites">On most sites</option></select>
    </div>
    <div class="scroll" id="gScroll"><div class="grid" id="gGrid"></div></div>`;
  $('#gSort').value = f.sort;
  $('#gQ').addEventListener('input', e => { f.q = e.target.value; fillGrid(); });
  $('#gMode').onclick = e => { const b = e.target.closest('[data-k]'); if (b) { f.mode = b.dataset.k; renderGames(); } };
  $('#gSrc').onclick = e => { const b = e.target.closest('[data-s]'); if (b) { f.source = f.source === b.dataset.s ? null : b.dataset.s; renderGames(); } };
  $('#gSort').onchange = e => { f.sort = e.target.value; fillGrid(); };
  $('#gRefresh').onclick = () => { S.catalog = null; loadCatalog(true); };
  if ($('#gKeys')) $('#gKeys').onclick = () => showView('settings');
  fillGrid();
  if (S.view === 'games') setTimeout(() => $('#gQ') && $('#gQ').focus(), 0);
}

let gridObs = null;
function fillGrid() {
  const grid = $('#gGrid');
  if (!grid) return;
  const list = filteredGames();
  let shown = 0;
  grid.innerHTML = '';
  const more = () => {
    const chunk = list.slice(shown, shown + 96);
    shown += chunk.length;
    const html = chunk.map(gameCard).join('');
    const sentinel = $('.grid-more', grid);
    if (sentinel) sentinel.remove();
    grid.insertAdjacentHTML('beforeend', html + (shown < list.length ? '<div class="grid-more"></div>' : ''));
    const s2 = $('.grid-more', grid);
    if (s2) gridObs.observe(s2);
  };
  if (gridObs) gridObs.disconnect();
  gridObs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more(); }, { root: $('#gScroll'), rootMargin: '600px' });
  if (!list.length) grid.innerHTML = `<div class="placeholder" style="grid-column:1/-1"><div>${I.search.replace('<svg', '<svg width="54" height="54"')}<b>No games match</b>Try a different name, or switch to "All".</div></div>`;
  else more();
  grid.onclick = e => { const c = e.target.closest('.gcard'); if (c) pickGame(c.dataset.key); };
}
function gameCard(g) {
  const ids = Object.keys(g.sources);
  return `<button class="gcard" data-key="${attr(g.key)}">
    <div class="art">${gameArt(g)}
      ${g.installed ? `<span class="badge inst">✓ Installed</span>` : ''}</div>
    <div class="body"><div class="name" title="${attr(g.name)}">${esc(g.name)}</div>
      <div class="srcs">${ids.map(srcBadge).join('') || '<span class="muted" style="font-size:12px">No mod sites yet</span>'}</div></div></button>`;
}

// ---------- picking a game → profile screen ----------
async function pickGame(key) {
  const entry = S.catalog.find(g => g.key === key);
  try {
    const g = await call('games:open', entry);
    await refreshManaged();
    profilePicker(g);
  } catch (e) { fail(e); }
}
async function openManaged(key) {
  try {
    let g = await call('games:get', key);
    if (S.catalog) { const entry = S.catalog.find(x => x.key === key); if (entry) g = await call('games:open', entry); }
    if (g.skipPicker && g.activeProfile) return enterGame(g, g.activeProfile);
    profilePicker(g);
  } catch (e) { fail(e); }
}
async function refreshManaged() { S.managed = await call('games:managed'); renderSidebar(); }

async function profilePicker(g) {
  let profiles = await call('profiles:list', g.key);
  let sel = g.activeProfile && profiles.some(p => p.name === g.activeProfile) ? g.activeProfile : 'Default';
  const m = modal(`<header>${gameArt(g, 'mini')}<div><h2>${esc(g.name)}</h2><p>Choose a profile. Each profile has its own mods and settings.</p></div></header>
    <div class="mbody"><div class="plist" id="pl"></div>
      <div class="row" style="margin-top:4px"><button class="btn sm" data-a="new">${I.plus}New profile</button><button class="btn sm" data-a="import">${I.dl}Import code</button><div style="flex:1"></div><button class="btn sm ghost" data-a="rename">Rename</button><button class="btn sm ghost" data-a="clone">Duplicate</button><button class="btn sm ghost danger" data-a="del">Delete</button></div>
      <label class="row muted" style="font-size:12.5px;margin-top:6px"><input type="checkbox" id="skipP" ${g.skipPicker ? 'checked' : ''}> Skip this screen next time and go straight in</label></div>
    <footer><button class="btn" data-a="default">Use default profile</button><div class="grow"></div><button class="btn primary" data-a="select">${I.check}Select profile</button></footer>`);
  const draw = () => {
    $('#pl', m.el).innerHTML = profiles.map(p => `<div class="prof ${p.name === sel ? 'sel' : ''}" data-n="${attr(p.name)}" tabindex="0">
      <div class="pi" style="background:hsl(${hueOf(p.name)} 55% 45%)">${esc(initials(p.name))}</div>
      <div class="grow"><b>${esc(p.name)}</b><span>${p.mods.length} mod${p.mods.length === 1 ? '' : 's'} · ${p.mods.filter(x => x.enabled).length} on · changed ${esc(ago(p.modified || p.created))}</span></div>
      ${p.name === g.activeProfile ? '<span class="pill info">Last used</span>' : ''}</div>`).join('');
  };
  draw();
  const go = async name => {
    await call('games:save', { key: g.key, skipPicker: $('#skipP', m.el).checked });
    m.close();
    enterGame(await call('games:get', g.key), name);
  };
  m.el.addEventListener('dblclick', e => { const p = e.target.closest('.prof'); if (p) go(p.dataset.n); });
  m.el.addEventListener('click', async e => {
    const p = e.target.closest('.prof');
    if (p) { sel = p.dataset.n; draw(); return; }
    const a = e.target.closest('[data-a]');
    if (!a) return;
    try {
      if (a.dataset.a === 'select') go(sel);
      else if (a.dataset.a === 'default') go('Default');
      else if (a.dataset.a === 'new' || a.dataset.a === 'clone') {
        const name = await prompt2(a.dataset.a === 'new' ? 'New profile' : `Duplicate "${sel}"`, 'Profile name', a.dataset.a === 'clone' ? sel + ' copy' : '', 'Create');
        if (!name) return;
        await call('profiles:create', { key: g.key, name, from: a.dataset.a === 'clone' ? sel : null });
        profiles = await call('profiles:list', g.key); sel = name.trim(); draw();
      } else if (a.dataset.a === 'rename') {
        if (sel === 'Default') return toast('The Default profile keeps its name.', 'warn');
        const name = await prompt2('Rename profile', 'New name', sel, 'Rename');
        if (!name) return;
        await call('profiles:rename', { key: g.key, from: sel, to: name });
        profiles = await call('profiles:list', g.key); sel = name.trim(); draw();
      } else if (a.dataset.a === 'del') {
        if (sel === 'Default') return toast('The Default profile can\'t be deleted.', 'warn');
        if (!(await confirmBox('Delete profile?', `"${esc(sel)}" and its mod list will be removed. Downloaded mod files used by other profiles are kept.`, 'Delete', true))) return;
        await call('profiles:delete', { key: g.key, name: sel });
        profiles = await call('profiles:list', g.key); sel = 'Default'; draw();
      } else if (a.dataset.a === 'import') {
        const code = await prompt2('Import a profile', 'Profile code', '', 'Import', 'Paste a code made with "Share profile" (starts with MODHAVEN1:).');
        if (!code) return;
        const t = toast('<span class="spinner"></span> Importing profile and downloading its mods…', 'info', 0);
        try {
          const r = await call('profiles:import', { key: g.key, code });
          t.remove();
          toast(`Imported <b>${esc(r.profile)}</b>: ${r.installed.length} mods installed${r.manual.length ? `, ${r.manual.length} need a manual download` : ''}${r.errors.length ? `, ${r.errors.length} failed` : ''}.`, r.errors.length ? 'warn' : 'ok', 9000);
          profiles = await call('profiles:list', g.key); sel = r.profile; draw();
        } catch (err) { t.remove(); fail(err); }
      }
    } catch (err) { fail(err); }
  });
}

// ======================================================================
// GAME VIEW
// ======================================================================
async function enterGame(g, profileName) {
  const switching = !S.game || S.game.key !== g.key;
  S.game = g;
  S.profileName = profileName;
  await call('profiles:select', { key: g.key, name: profileName });
  S.game.activeProfile = profileName;
  if (switching) {
    S.tab = 'installed';
    S.inst = { sel: null, q: '', filter: 'all' };
    S.browse = { q: '', sort: 'popular', sources: [], page: 0, mods: [], hasMore: true, loading: false, sel: null, token: 0, perSource: {}, gameVersion: '' };
    S.runSel = 'overview'; S.cfgSel = null;
  }
  showView('game');
  renderGameShell();
  await reloadProfile();
  call('run:status', g.key).then(st => { S.running[g.key] = st.running ? st : null; renderHeroActions(); renderSidebar(); });
  call('search:state', g.key).then(st => { S.search = st; });
  quickExternal();
  refreshManaged();
}

async function reloadProfile() {
  const [p, a, runs] = await Promise.all([
    call('profiles:get', { key: S.game.key, name: S.profileName }),
    call('analysis:get', { key: S.game.key, profile: S.profileName }).catch(() => null),
    call('run:list', S.game.key),
  ]);
  S.profile = p; S.analysis = a; S.runs = runs;
  renderHeroMeta();
  renderBanners();
  renderTabCounts();
  if (S.tab === 'installed') renderInstalled();
  if (S.tab === 'browse') markInstalledInBrowse();
  if (S.tab === 'crash') renderCrash();
}

// Blurred backdrop behind the game header: a wide banner suits it best, else whatever art works.
function heroBg(g) {
  const list = artList(withArt(g));
  const pick = artGood.get(g.name) && !list.some(x => x.kind === 'wide') ? { url: artGood.get(g.name) } : list.find(x => x.kind === 'wide') || list[0];
  return pick ? `<div class="bgart" style="background-image:${attr(cssUrl(pick.url))}"></div>` : '';
}
function renderGameShell() {
  const g = S.game;
  const v = $('#view-game');
  v.innerHTML = `
    <div class="hero">${heroBg(g)}
      <div class="hero-top">
        ${gameArt(g, 'hero-art')}
        <div style="min-width:0"><h1>${esc(g.name)}</h1><div class="hero-meta" id="heroMeta"></div></div>
        <div class="hero-actions">
          <button class="profile-btn" id="profBtn"><span><small>Profile</small><b id="profName">${esc(S.profileName)}</b></span>${I.down}</button>
          <span id="heroActs" class="row"></span>
        </div>
      </div>
      <div id="banners"></div>
      <div class="tabs" id="tabs">
        <button class="tab" data-t="installed">Installed <span class="n" id="nInst">0</span></button>
        <button class="tab" data-t="browse">Get mods</button>
        <button class="tab" data-t="crash">Crash center <span class="n" id="nCrash" hidden></span></button>
        <button class="tab" data-t="config">Config editor</button>
      </div>
    </div>
    <div class="tabpane" id="pane-installed"></div>
    <div class="tabpane" id="pane-browse"></div>
    <div class="tabpane" id="pane-crash"></div>
    <div class="tabpane" id="pane-config"></div>`;
  $('#tabs').onclick = e => { const t = e.target.closest('.tab'); if (t) setTab(t.dataset.t); };
  $('#profBtn').onclick = () => profilePicker(S.game);
  renderHeroActions();
  setTab(S.tab, true);
}

function setTab(t, initial) {
  S.tab = t;
  $$('#tabs .tab').forEach(x => x.classList.toggle('on', x.dataset.t === t));
  $$('#view-game .tabpane').forEach(x => x.classList.toggle('on', x.id === 'pane-' + t));
  if (t === 'installed' && !initial) renderInstalled();
  if (t === 'browse') { if (!$('#pane-browse').dataset.built || $('#pane-browse').dataset.built !== S.game.key) buildBrowse(); }
  if (t === 'crash') renderCrash();
  if (t === 'config') renderConfig();
}

function renderHeroMeta() {
  const g = S.game;
  const p = S.profile;
  const el = $('#heroMeta');
  if (!el) return;
  const layoutName = { bepinex: 'BepInEx', melonloader: 'MelonLoader', data: 'Data folder', minecraft: 'Minecraft mods', root: 'Game folder', custom: 'Custom folder', unreal: 'Unreal (~mods / UE4SS)' };
  el.innerHTML = `
    ${g.installPath ? `<span class="pill ok" data-tip="${attr(g.installPath)}">✓ Installed${g.store ? ' · ' + esc(g.store[0].toUpperCase() + g.store.slice(1)) : ''}</span>` : `<span class="pill warn">Game folder not set</span>`}
    ${g.gameVersion ? `<span class="pill" data-tip="Detected game version${g.publicVersion ? ' (' + esc(g.gameVersion) + ', from the game\'s Steam patch notes)' : ''}. When it changes, every mod goes back to “not tested yet” until it runs OK again.">Game ${esc(g.publicVersion || g.gameVersion)}</span>` : ''}
    ${g.pendingVersion ? `<span class="pill warn" data-tip="Steam has a newer build of the game waiting to install. Mods may need updates after it.">Game update ${esc(g.pendingVersion)} pending</span>` : g.updatePending ? '<span class="pill warn">Game update pending</span>' : ''}
    ${g.key === 'minecraft' ? `<span class="pill">MC ${esc(g.mcVersion || 'any')} ${esc(g.mcLoader || '')}</span>` : ''}
    <span class="pill">${p ? p.mods.filter(m => m.enabled).length : 0} of ${p ? p.mods.length : 0} mods on</span>
    ${Object.keys(g.sources || {}).map(srcBadge).join('')}`;
  el.insertAdjacentHTML('beforeend', '<span class="pill" id="layoutPill" data-tip="Where mod files are placed (change in Game settings)" hidden></span>');
  call('games:layout', g.key).then(l => { const lp = $('#layoutPill'); if (lp) { lp.textContent = layoutName[l] || l; lp.hidden = false; } }).catch(() => { });
}

function renderHeroActions() {
  const el = $('#heroActs');
  if (!el || !S.game) return;
  const run = S.running[S.game.key];
  el.innerHTML = run
    ? `<button class="btn big danger" id="stopBtn">${I.stop}Stop game</button>`
    : `<button class="btn big primary" id="playBtn">${I.play}Start modded</button><button class="btn big icon" id="vanBtn" data-tip="Start vanilla (no mods)" style="width:44px">${I.vanilla}</button>`;
  el.insertAdjacentHTML('beforeend', `<button class="btn big icon" id="gMore" style="width:44px" data-tip="More">${I.more}</button>`);
  if ($('#playBtn')) $('#playBtn').onclick = () => launch(false);
  if ($('#vanBtn')) $('#vanBtn').onclick = () => launch(true);
  if ($('#stopBtn')) $('#stopBtn').onclick = () => call('run:stop', S.game.key);
  $('#gMore').onclick = e => menu(e.currentTarget, [
    { label: 'Game settings', icon: I.gear, run: gameSettings },
    { label: 'Open game folder', icon: I.folder, run: () => call('shell:gameFolder', S.game.key).then(ok => ok || toast('Set the game folder in Game settings first.', 'warn')) },
    { label: 'Find mods I installed myself', icon: I.search, run: reviewExternal },
    { label: 'Find the mod that crashes', icon: I.bug, run: () => { setTab('crash'); S.runSel = 'overview'; renderCrash(); } },
    '-',
    { label: 'Share profile (copy code)', icon: I.copy, run: shareProfile },
    { label: 'Check this game version again', icon: I.refresh, run: async () => { const r = await call('games:refreshVersion', S.game.key); S.game = r.game; renderHeroMeta(); toast(r.changed ? `Game updated: ${esc(r.from)} → ${esc(r.to)}` : `Game version: ${esc(r.to || 'unknown')}`, r.changed ? 'warn' : 'info'); reloadProfile(); } },
    { label: 'Remove mods from game folder', icon: I.x, run: async () => { await call('mods:undeploy', S.game.key); toast('Mod files removed from the game folder. They go back in when you start modded.', 'ok'); } },
    '-',
    { label: 'Stop managing this game', icon: I.trash, danger: true, run: forgetGame },
  ]);
}

async function launch(vanilla) {
  const g = S.game;
  if (!g.installPath && !g.exe && g.key !== 'minecraft') { toast('Tell ModHaven where the game is first.', 'warn'); return gameSettings(); }
  try {
    const t = toast(`<span class="spinner"></span> ${vanilla ? 'Starting vanilla' : `Putting ${S.profile.mods.filter(m => m.enabled).length} mods in place and starting`} ${esc(g.name)}…`, 'info', 4000);
    await call('run:launch', { key: g.key, profile: S.profileName, vanilla });
    S.running[g.key] = { running: true };
    renderHeroActions(); renderSidebar();
    if (S.settings.minimizeOnLaunch) { /* main process could minimise; kept simple */ }
    void t;
  } catch (e) { fail(e); }
}

async function shareProfile() {
  try {
    const code = await call('profiles:export', { key: S.game.key, name: S.profileName });
    await navigator.clipboard.writeText(code);
    toast(`Profile code for <b>${esc(S.profileName)}</b> copied. Anyone with ModHaven can import it from the profile screen.`, 'ok');
  } catch (e) { fail(e); }
}
async function forgetGame() {
  if (!(await confirmBox('Stop managing this game?', `ModHaven will remove its mod files from the game folder and delete <b>all profiles, crash history and downloaded mods</b> for ${esc(S.game.name)}. The game itself is not touched.`, 'Remove', true))) return;
  try { await call('games:forget', S.game.key); S.game = null; await refreshManaged(); showView('games'); } catch (e) { fail(e); }
}

function renderBanners() {
  const g = S.game, el = $('#banners');
  if (!el) return;
  const out = [];
  if (g.versionChangedNotice) out.push(`<div class="banner warn">${tri('untested', 20)}<div class="grow"><b>The game updated</b> (${esc(g.versionChangedNotice.from)} → ${esc(g.versionChangedNotice.to)}). Mods are marked “not tested yet” until they run OK on the new version. Mods that break show a red triangle.</div><button class="btn sm" id="bVer">Got it</button></div>`);
  if (!g.installPath && g.key !== 'minecraft') out.push(`<div class="banner info"><div class="grow">ModHaven didn't find ${esc(g.name)} on this PC. You can still browse and download mods — set the game folder to install them.</div><button class="btn sm" id="bSet">Set game folder</button></div>`);
  const last = S.runs.find(r => !r.vanilla && r.profile === S.profileName);
  if (last && ['crashed', 'failed-to-start'].includes(last.outcome) && !last.dismissed) out.push(`<div class="banner bad"><div class="grow"><b>${last.outcome === 'crashed' ? 'The game crashed' : "The game didn't start"}</b> ${esc(ago(last.endedAt))}${last.culprits.length ? ` — most likely <b>${esc(nameFor(last.culprits[0].uid))}</b>` : ' — no mod named in the logs'}.</div><button class="btn sm" id="bCrash">Open crash center</button></div>`);
  const missing = Object.keys(g.sources || {}).filter(id => srcMeta(id).needsKey && !srcMeta(id).keylessBrowse && !S.settings.keys[id]);
  if (missing.length && S.tab === 'browse') out.push(`<div class="banner info"><div class="grow">This game also has mods on ${missing.map(id => esc(srcMeta(id).name)).join(' and ')}. Add an API key to include them.</div><button class="btn sm" id="bKeys">Add keys</button></div>`);
  const ext = S.external && S.external.key === g.key ? S.external : null;
  if (ext && ext.count && !ext.dismissed) {
    const one = ext.count === 1;
    out.push(`<div class="banner info">${I.search.replace('<svg', '<svg width="20" height="20" style="fill:none;stroke:currentColor;stroke-width:2"')}<div class="grow"><b>${ext.found && ext.unlinked ? `Found ${ext.found} mod${ext.found === 1 ? '' : 's'} you installed yourself and ${ext.unlinked} not linked to a mod site` : ext.unlinked ? `${ext.unlinked} mod${ext.unlinked === 1 ? ' isn’t' : 's aren’t'} linked to a mod site yet` : `Found ${ext.count} mod${one ? '' : 's'} you installed yourself`}</b> (${ext.names.slice(0, 4).map(esc).join(', ')}${ext.count > 4 ? '…' : ''}). Find ${one ? 'it' : 'them'} on the mod sites so ModHaven can keep ${one ? 'it' : 'them'} updated.</div><button class="btn sm primary" id="bExt">Review</button><button class="btn sm ghost" id="bExtNo">Not now</button></div>`);
  }
  el.innerHTML = out.join('');
  if ($('#bExt')) $('#bExt').onclick = reviewExternal;
  if ($('#bExtNo')) $('#bExtNo').onclick = () => { S.external.dismissed = true; renderBanners(); };
  if ($('#bVer')) $('#bVer').onclick = async () => { S.game = await call('games:dismissVersionNotice', g.key); renderBanners(); };
  if ($('#bSet')) $('#bSet').onclick = gameSettings;
  if ($('#bCrash')) $('#bCrash').onclick = () => { S.runSel = last.id; setTab('crash'); };
  if ($('#bKeys')) $('#bKeys').onclick = () => showView('settings');
}
const nameFor = uid => ((S.profile && S.profile.mods.find(m => m.uid === uid)) || { name: String(uid).split(':').pop() }).name;

function renderTabCounts() {
  if (!$('#nInst')) return;
  $('#nInst').textContent = S.profile.mods.length;
  const bad = S.analysis ? Object.values(S.analysis.status).filter(s => s.status === 'broken' || s.status === 'conflict').length : 0;
  const n = $('#nCrash');
  n.hidden = !bad; n.textContent = bad; n.classList.toggle('alert', bad > 0);
  if (!bad) { const crashes = S.runs.filter(r => r.outcome === 'crashed').length; if (crashes) { n.hidden = false; n.textContent = crashes; n.classList.remove('alert'); } }
}

// ---------- game settings ----------
async function gameSettings() {
  const g = await call('games:get', S.game.key);
  const isMc = g.key === 'minecraft';
  const m = modal(`<header><div><h2>Game settings</h2><p>${esc(g.name)}</p></div></header>
    <div class="mbody">
      <div class="field"><label>Game folder</label><div class="row"><input class="input" style="flex:1" id="fPath" value="${attr(g.installPath || '')}" spellcheck="false"><button class="btn" data-a="pickPath">${I.folder}Browse</button></div></div>
      <div class="field"><label>Game exe</label><div class="row"><input class="input" style="flex:1" id="fExe" value="${attr(g.exe || '')}" spellcheck="false"><button class="btn" data-a="pickExe">${I.file}Browse</button><button class="btn" data-a="guess">Find</button></div><span class="hint">Used to watch the game for crashes and to read its version.</span></div>
      <div class="row" style="gap:12px">
        <div class="field" style="flex:1"><label>Start the game through</label><select class="input" id="fVia"><option value="exe">The exe directly</option><option value="steam" ${g.steamAppId ? '' : 'disabled'}>Steam${g.steamAppId ? '' : ' (not a Steam game)'}</option><option value="epic" ${g.launchUri ? '' : 'disabled'}>Epic Games${g.launchUri ? '' : ' (not found)'}</option></select></div>
        <div class="field" style="flex:1"><label>Launch options</label><input class="input" id="fArgs" value="${attr(g.args || '')}" placeholder="e.g. -windowed" spellcheck="false"></div>
      </div>
      <div class="row" style="gap:12px">
        <div class="field" style="flex:1"><label>How mods are installed</label><select class="input" id="fLayout">
          <option value="auto">Automatic</option><option value="bepinex">BepInEx (Unity / Thunderstore)</option><option value="melonloader">MelonLoader</option>
          <option value="data">Data folder (Skyrim, Fallout…)</option><option value="unreal">Unreal Engine (~mods, LogicMods, UE4SS)</option><option value="root">Into the game folder</option><option value="custom">Into a custom folder</option><option value="minecraft">Minecraft mods folder</option></select></div>
        <div class="field" style="flex:1"><label>Custom / Minecraft folder</label><div class="row"><input class="input" style="flex:1" id="fCustom" value="${attr(g.customDir || '')}" placeholder="${isMc ? '%APPDATA%\\.minecraft' : 'Only for “custom folder”'}" spellcheck="false"><button class="btn icon" data-a="pickCustom">${I.folder}</button></div></div>
      </div>
      ${isMc ? `<div class="row" style="gap:12px"><div class="field" style="flex:1"><label>Minecraft version</label><input class="input" id="fMc" value="${attr(g.mcVersion || '')}" placeholder="e.g. 1.21.1"></div>
        <div class="field" style="flex:1"><label>Mod loader</label><select class="input" id="fLoader"><option value="">Any</option><option>fabric</option><option>forge</option><option>neoforge</option><option>quilt</option></select></div></div>` : ''}
      <label class="row" style="font-size:13px"><input type="checkbox" id="fSkip" ${g.skipPicker ? 'checked' : ''}> Skip the profile screen when opening this game</label>
    </div>
    <footer><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="save">Save</button></footer>`, { wide: true });
  $('#fVia', m.el).value = g.launchVia || 'exe';
  $('#fLayout', m.el).value = g.layout || 'auto';
  if (isMc) $('#fLoader', m.el).value = g.mcLoader || '';
  m.el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'cancel') m.close();
    if (a.dataset.a === 'pickPath') { const p = await call('dialog:pick', { kind: 'folder', title: 'Game folder' }); if (p) $('#fPath', m.el).value = p; }
    if (a.dataset.a === 'pickCustom') { const p = await call('dialog:pick', { kind: 'folder', title: 'Mods folder' }); if (p) $('#fCustom', m.el).value = p; }
    if (a.dataset.a === 'pickExe') { const p = await call('dialog:pick', { kind: 'file', title: 'Game exe', filters: [{ name: 'Programs', extensions: ['exe'] }] }); if (p) $('#fExe', m.el).value = p; }
    if (a.dataset.a === 'guess') {
      await call('games:save', { key: g.key, installPath: $('#fPath', m.el).value.trim() || null });
      const exe = await call('games:guessExe', g.key);
      if (exe) $('#fExe', m.el).value = exe; else toast('No exe found in that folder.', 'warn');
    }
    if (a.dataset.a === 'save') {
      try {
        const patch = { key: g.key, installPath: $('#fPath', m.el).value.trim() || null, exe: $('#fExe', m.el).value.trim() || null, launchVia: $('#fVia', m.el).value,
          args: $('#fArgs', m.el).value, layout: $('#fLayout', m.el).value, customDir: $('#fCustom', m.el).value.trim(), skipPicker: $('#fSkip', m.el).checked };
        if (isMc) { patch.mcVersion = $('#fMc', m.el).value.trim(); patch.mcLoader = $('#fLoader', m.el).value; }
        await call('games:save', patch);
        const r = await call('games:refreshVersion', g.key);
        S.game = r.game;
        m.close();
        renderGameShell(); reloadProfile();
        if (S.tab === 'browse') buildBrowse();
        toast('Game settings saved.', 'ok');
      } catch (err) { fail(err); }
    }
  });
}

// ======================================================================
// INSTALLED TAB
// ======================================================================
function statusOf(uid) { return (S.analysis && S.analysis.status[uid]) || { status: 'untested', reasons: ['Not launched yet'] }; }
// A wrong link is never an "update" (Replace with this page's mod is the deliberate way to switch).
const hasUpdate = m => m.latest && m.versionGuess !== 'mismatch' && String(m.latest.versionId) !== String(m.versionId);

function renderInstalled() {
  const pane = $('#pane-installed');
  if (!pane) return;
  const p = S.profile;
  if (!pane.dataset.built || pane.dataset.built !== S.game.key + '|' + S.profileName) {
    pane.dataset.built = S.game.key + '|' + S.profileName;
    pane.innerHTML = `<div class="split">
      <div class="listcol">
        <div class="listbar">
          <div class="search">${I.search}<input class="input" id="iQ" placeholder="Filter installed mods…" spellcheck="false"></div>
          <select class="input" id="iF"><option value="all">All mods</option><option value="on">Turned on</option><option value="off">Turned off</option><option value="updates">Updates available</option><option value="problems">Problems</option><option value="untested">Not tested</option></select>
          <button class="btn" id="iUpd">${I.refresh}Check updates</button>
          <button class="btn primary" id="iUpdAll" hidden>${I.up}Update all</button>
          <button class="btn icon" id="iMore" data-tip="More">${I.more}</button>
        </div>
        <div class="listbar2"><div class="legend">
          <span>${tri('works', 14)}Works</span><span>${tri('untested', 14)}Not tested</span><span>${tri('conflict', 14)}Conflict</span><span>${tri('broken', 14)}Out of date / broken</span></div>
          <div style="flex:1"></div><span id="iSum"></span></div>
        <div class="list" id="iList" tabindex="0"></div>
      </div>
      <div class="detailcol" id="iDetail"></div></div>`;
    $('#iQ').value = S.inst.q;
    $('#iF').value = S.inst.filter;
    $('#iQ').addEventListener('input', e => { S.inst.q = e.target.value; drawInstalledList(); });
    $('#iF').onchange = e => { S.inst.filter = e.target.value; drawInstalledList(); };
    $('#iUpd').onclick = checkUpdates;
    $('#iUpdAll').onclick = updateAll;
    $('#iMore').onclick = e => menu(e.currentTarget, [
      { label: 'Install mod from file…', icon: I.file, run: installFromFile },
      { label: 'Find mods I installed myself…', icon: I.search, run: reviewExternal },
      { label: 'Turn all mods on', icon: I.check, run: () => setAll(true) },
      { label: 'Turn all mods off', icon: I.x, run: () => setAll(false) },
      '-',
      { label: 'Put mods in the game folder now', icon: I.box, run: async () => { try { const r = await call('mods:deploy', { key: S.game.key, profile: S.profileName }); toast(`${r.count} files placed in ${esc(r.root)}`, 'ok'); } catch (err) { fail(err); } } },
      { label: 'Share profile (copy code)', icon: I.copy, run: shareProfile },
    ]);
    wireInstalledList();
  }
  drawInstalledList();
  if (S.inst.sel && p.mods.some(m => m.uid === S.inst.sel)) renderInstalledDetail(S.inst.sel);
  else if (!S.inst.sel) $('#iDetail').innerHTML = installedPlaceholder();
  else { S.inst.sel = null; $('#iDetail').innerHTML = installedPlaceholder(); }
}
function installedPlaceholder() {
  const p = S.profile;
  if (!p.mods.length) return `<div class="placeholder"><div>${I.box.replace('<svg', '<svg width="54" height="54"')}<b>No mods in “${esc(S.profileName)}” yet</b>Open <a href="#" data-go="browse">Get mods</a> to find mods from every site,<br>or drop mod files onto this window.</div></div>`;
  return `<div class="placeholder"><div>${I.box.replace('<svg', '<svg width="54" height="54"')}<b>Select a mod</b>to see what it does, its version and its status.<br><br><span class="muted">Drag <span style="display:inline-flex;vertical-align:middle">${I.grip}</span> to change load order (lower loads later and wins).</span></div></div>`;
}

function drawInstalledList() {
  const list = $('#iList');
  if (!list) return;
  const q = S.inst.q.trim().toLowerCase();
  const f = S.inst.filter;
  const mods = S.profile.mods.filter(m => {
    if (q && !(`${m.name} ${m.author || ''}`.toLowerCase().includes(q))) return false;
    const st = statusOf(m.uid).status;
    if (f === 'on') return m.enabled; if (f === 'off') return !m.enabled;
    if (f === 'updates') return hasUpdate(m); if (f === 'problems') return st === 'broken' || st === 'conflict';
    if (f === 'untested') return st === 'untested';
    return true;
  });
  const ups = S.profile.mods.filter(hasUpdate).length;
  $('#iUpdAll').hidden = !ups;
  $('#iUpdAll').innerHTML = `${I.up}Update all (${ups})`;
  $('#iSum').textContent = `${S.profile.mods.filter(m => m.enabled).length} on · ${S.profile.mods.length} total`;
  keepScroll(list, () => {
    list.innerHTML = mods.length ? mods.map(m => {
      const st = statusOf(m.uid);
      return `<div class="mrow ${m.uid === S.inst.sel ? 'sel' : ''} ${m.enabled ? '' : 'off'}" data-uid="${attr(m.uid)}" draggable="${q || f !== 'all' ? 'false' : 'true'}">
        <span class="handle">${I.grip}</span>
        <span data-tipuid="${attr(m.uid)}">${tri(st.status)}</span>
        <label class="switch" data-stop="1"><input type="checkbox" ${m.enabled ? 'checked' : ''} data-toggle="${attr(m.uid)}"><i></i></label>
        ${img(m.icon, 'mico')}
        <div class="mmain"><div class="mtop"><span class="mname">${esc(m.name)}</span>${srcBadge(m.source)}${hasUpdate(m) ? `<span class="pill info" data-tip="New version ${attr(m.latest.version)}">${I.up.replace('<svg', '<svg width="12" height="12" style="fill:none;stroke:currentColor;stroke-width:2.4"')}${esc(m.latest.version)}</span>` : ''}${(m.dependencyOf || []).length ? '<span class="pill" data-tip="Installed because another mod needs it">library</span>' : ''}${m.versionGuess === 'mismatch' ? '<span class="pill bad" data-tip="Your files are older than every release on this page: probably linked to the wrong mod">check link</span>' : ''}</div>
          <div class="msum">${esc(m.summary || (m.author ? 'by ' + m.author : ''))}</div></div>
        <div class="mside"><span class="v">${esc(m.version || '')}</span><span title="${attr(fullDate(m.modUpdatedAt))}">${esc(ago(m.modUpdatedAt))}</span></div></div>`;
    }).join('') : `<div class="list-end">${S.profile.mods.length ? 'No mods match this filter.' : 'Nothing installed yet.'}</div>`;
  });
}

function wireInstalledList() {
  const list = $('#iList');
  list.addEventListener('click', e => {
    if (e.target.closest('[data-stop]')) return;
    const row = e.target.closest('.mrow');
    if (!row) return;
    selectInstalled(row.dataset.uid);
  });
  list.addEventListener('change', async e => {
    const uid = e.target.dataset.toggle;
    if (!uid) return;
    try {
      S.profile = await call('mods:patch', { key: S.game.key, profile: S.profileName, uid, patch: { enabled: e.target.checked } });
      drawInstalledList(); renderHeroMeta();
      if (S.inst.sel === uid) renderInstalledDetail(uid);
    } catch (err) { fail(err); }
  });
  list.addEventListener('keydown', e => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const rows = $$('.mrow', list);
    const i = rows.findIndex(r => r.dataset.uid === S.inst.sel);
    const n = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (n) { selectInstalled(n.dataset.uid); n.scrollIntoView({ block: 'nearest' }); }
  });
  // drag to reorder
  let dragUid = null;
  list.addEventListener('dragstart', e => { const r = e.target.closest('.mrow'); if (!r) return; dragUid = r.dataset.uid; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-mod', dragUid); });
  list.addEventListener('dragend', () => { dragUid = null; $$('.mrow', list).forEach(r => r.classList.remove('dragging', 'drop-above', 'drop-below')); });
  list.addEventListener('dragover', e => {
    if (!dragUid) return;
    const r = e.target.closest('.mrow'); if (!r) return;
    e.preventDefault();
    $$('.mrow', list).forEach(x => x.classList.remove('drop-above', 'drop-below'));
    const box = r.getBoundingClientRect();
    r.classList.add(e.clientY < box.top + box.height / 2 ? 'drop-above' : 'drop-below');
  });
  list.addEventListener('drop', async e => {
    if (!dragUid) return;
    const r = e.target.closest('.mrow'); if (!r) return;
    e.preventDefault(); e.stopPropagation();
    const before = r.classList.contains('drop-above');
    const uids = S.profile.mods.map(m => m.uid).filter(u => u !== dragUid);
    let idx = uids.indexOf(r.dataset.uid); if (!before) idx++;
    uids.splice(idx, 0, dragUid);
    try { S.profile = await call('mods:reorder', { key: S.game.key, profile: S.profileName, uids }); drawInstalledList(); } catch (err) { fail(err); }
  });
}

function selectInstalled(uid) {
  S.inst.sel = uid;
  $$('#iList .mrow').forEach(r => r.classList.toggle('sel', r.dataset.uid === uid));
  renderInstalledDetail(uid);
}

function statusCard(uid) {
  const st = statusOf(uid);
  const conf = (st.conflictsWith || []).map(c => `<li><b>${esc(nameFor(c.uid))}</b> — ${c.confirmed ? 'confirmed by a culprit search' : `crashed ${c.crashes} time${c.crashes === 1 ? '' : 's'} together`}</li>`).join('');
  const files = (st.fileConflicts || []).map(c => `<li>Shares ${c.files.length} file${c.files.length === 1 ? '' : 's'} with <b>${esc(nameFor(c.uid))}</b> (later in load order wins): <span class="mono muted">${esc(c.files.slice(0, 3).join(', '))}</span></li>`).join('');
  return `<div class="card status-card">${tri(st.status, 26)}<div style="flex:1"><b>${esc(STATUS_LABEL[st.status])}</b>
    <ul>${st.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    ${conf ? `<div style="margin-top:8px"><b style="font-size:13px">Conflicts</b><ul>${conf}</ul></div>` : ''}
    ${files ? `<div style="margin-top:8px"><b style="font-size:13px">Overlapping files</b><ul>${files}</ul></div>` : ''}
    <div class="muted" style="font-size:12px;margin-top:6px">${st.launches || 0} launches with this version · ${st.worked || 0} OK · ${st.crashes || 0} crashed</div></div></div>`;
}

async function renderInstalledDetail(uid) {
  const m = S.profile.mods.find(x => x.uid === uid);
  const d = $('#iDetail');
  if (!m) { d.innerHTML = installedPlaceholder(); return; }
  d.scrollTop = 0;
  d.innerHTML = `<div class="dhead">${img(m.icon, 'dico')}<div style="min-width:0;flex:1"><h2>${esc(m.name)}</h2><div class="by">${m.author ? 'by ' + esc(m.author) : ''}</div>
      <div class="tags">${srcBadge(m.source)}${(m.categories || []).slice(0, 4).map(c => `<span class="pill">${esc(c)}</span>`).join('')}</div></div>
      <label class="switch" style="margin-top:6px" data-tip="Turn on/off"><input type="checkbox" id="dTog" ${m.enabled ? 'checked' : ''}><i></i></label></div>
    <div class="dbody">
      <div class="facts">
        <div class="fact"><small>Installed version</small><b class="mono">${m.version && m.version !== 'unknown' ? esc(m.version) : '<span class="muted">unknown</span>'}</b>${m.versionGuess === 'exact file' ? `<span class="muted" style="font-size:11.5px" data-tip="Your files are byte-for-byte the files in this release on the mod page.">exact file match${m.variant && m.variant.title ? ' · ' + esc(m.variant.title) : ''}</span>` : m.versionGuess === 'file date' ? `<span class="muted" style="font-size:11.5px" data-tip="Your files are dated after this release and before any newer one, so this is probably the release you have.">estimated from your files' date</span>` : m.versionGuess === 'mismatch' ? '<span class="muted" style="font-size:11.5px">your own copy (not from this page)</span>' : m.version === 'unknown' && m.source !== 'local' ? '<span class="muted" style="font-size:11.5px">click Check updates to work it out</span>' : ''}</div>
        <div class="fact"><small>Released</small><b title="${attr(fullDate(m.modUpdatedAt))}">${m.modUpdatedAt ? esc(ago(m.modUpdatedAt)) : '<span class="muted">unknown</span>'}</b></div>
        <div class="fact"><small>Made for game</small><b class="mono">${m.madeFor ? esc(m.madeFor.version) : '<span class="muted">not stated</span>'}</b>${m.madeFor ? `<span class="muted" style="font-size:11.5px" ${m.madeFor.quote ? `data-tip="From the mod page: …${attr(m.madeFor.quote)}…"` : ''}>${m.madeFor.how === 'stated' ? 'stated on the mod page' : m.madeFor.how === 'listed' ? 'listed by the site' : 'from its release date'}${S.game.publicVersion ? ` · your game ${esc(S.game.publicVersion)}` : ''}</span>` : ''}</div>
        <div class="fact"><small>Newest version</small><b class="mono">${m.latest ? esc(m.latest.version) : '<span class="muted">not checked</span>'}</b>${m.latest && m.latest.date ? `<span class="muted" style="font-size:11.5px" title="${attr(fullDate(m.latest.date))}">released ${esc(ago(m.latest.date))}</span>` : ''}</div>
        <div class="fact"><small>Installed</small><b>${esc(ago(m.installedAt))}</b></div>
      </div>
      <div class="dactions">
        ${hasUpdate(m) ? `<button class="btn primary" data-a="update">${I.up}Update to ${esc(m.latest.version)}</button>` : ''}
        ${m.source !== 'local' ? `<button class="btn" data-a="versions">${I.down}Change version</button>` : ''}
        ${m.rawLayout && m.source !== 'local' ? `<button class="btn" data-a="unlink" data-tip="Linked to the wrong page? Undo the link; your files stay as they are.">${I.x}Unlink</button>` : ''}
        ${m.source !== 'local' ? `<button class="btn" data-a="usefile" data-tip="Downloaded this mod from its website yourself? Pick the file and ModHaven installs it in place of the old one, keeping the link for updates.">${I.file}Use a file I downloaded</button>` : `<button class="btn" data-a="relink">${I.search}Find on mod sites</button>`}
        ${m.url ? `<button class="btn" data-a="web">${I.ext}Website</button>` : ''}
        <button class="btn" data-a="folder">${I.folder}Files</button>
        <button class="btn danger" data-a="remove">${I.trash}Uninstall</button>
      </div>
      ${m.versionGuess === 'mismatch' ? `<div class="banner bad" style="margin:0"><div class="grow"><b>Your files aren't from this page${m.mismatchBy === 'files' ? '' : ' (probably)'}.</b> ${m.mismatchBy === 'files' ? `None of the downloads on this ${esc(srcMeta(m.source).name)} page contain your files.` : `Your files are dated ${esc(new Date(m.fileDate).toLocaleDateString())}, but every release of “${esc(m.name)}” on ${esc(srcMeta(m.source).name)} came out after that, so your files can't be from this page.`} ModHaven won't change it on its own. Keep your copy and <b>Unlink</b>, or <b>Replace</b> it with this page's mod (your files are backed up).</div><div class="row" style="flex-direction:column;gap:6px"><button class="btn sm primary" data-a="replacepage">${I.dl}Replace with this page's mod</button><button class="btn sm" data-a="unlink">${I.x}Unlink</button></div></div>` : ''}
      ${m.adopted ? adoptedNote(m) : ''}
      ${statusCard(uid)}
      <div class="card"><h3>Updates</h3>
        <div class="srow" style="padding:4px 0;border:0"><div class="sl"><b>Auto-update this mod</b><span>${m.pinned ? 'Pinned to this version (you picked it by hand).' : 'Follows the global setting unless you change it here.'}</span></div>
          <select class="input" id="dAuto"><option value="">Use global setting (${S.settings.autoUpdate ? 'on' : 'off'})</option><option value="on">Always</option><option value="off">Never</option></select></div>
        ${m.pinned ? `<button class="btn sm" data-a="unpin">Unpin version</button>` : ''}
        ${m.autoUpdatedFrom ? `<div class="muted" style="font-size:12.5px;margin-top:6px">Auto-updated from ${esc(m.autoUpdatedFrom)}.</div>` : ''}
        ${m.lastChecked ? `<div class="muted" style="font-size:12.5px;margin-top:6px">Checked ${esc(ago(m.lastChecked))}.</div>` : ''}
      </div>
      <div class="card"><h3>Your notes</h3><textarea id="dNotes" rows="3" style="width:100%" placeholder="Anything to remember about this mod…">${esc(m.notes || '')}</textarea></div>
      <div class="card"><h3>About this mod</h3><div class="desc" id="dDesc">${m.source === 'local' ? '<span class="muted">Installed from a file on this PC.</span>' : '<div class="skel" style="height:80px"></div>'}</div></div>
    </div>`;
  $('#dAuto', d).value = m.autoUpdate === true ? 'on' : m.autoUpdate === false ? 'off' : '';
  $('#dTog', d).onchange = async e => { S.profile = await call('mods:patch', { key: S.game.key, profile: S.profileName, uid, patch: { enabled: e.target.checked } }); drawInstalledList(); renderHeroMeta(); };
  $('#dAuto', d).onchange = async e => { S.profile = await call('mods:patch', { key: S.game.key, profile: S.profileName, uid, patch: { autoUpdate: e.target.value === 'on' ? true : e.target.value === 'off' ? false : null } }); };
  let nt; $('#dNotes', d).oninput = e => { clearTimeout(nt); nt = setTimeout(() => call('mods:patch', { key: S.game.key, profile: S.profileName, uid, patch: { notes: e.target.value } }).then(p => { S.profile = p; }), 500); };
  d.onclick = async e => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    try {
      if (a.dataset.a === 'update') await doInstall({ source: m.source, gameId: m.gameId, modId: m.id, versionId: m.latest.versionId }, `${m.name} ${m.latest.version}`);
      if (a.dataset.a === 'versions') versionPicker(m);
      if (a.dataset.a === 'relink') reviewExternal({ only: 'profile:' + m.uid });
      if (a.dataset.a === 'replacepage') {
        if (!(await confirmBox('Replace with this page\'s mod?', `Your current files for <b>${esc(m.name)}</b> will be replaced with the newest release from its ${esc(srcMeta(m.source).name)} page. Your files are backed up first, and you can switch back with <b>Change version</b> later.`, 'Replace'))) return;
        a.disabled = true; a.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span>Working…';
        try {
          const r = await call('mods:replaceFromPage', { key: S.game.key, profile: S.profileName, uid });
          if (r.installed.length) toast(`Replaced with <b>${esc(r.installed.join(', '))}</b> from the mod page.`, 'ok');
          if (r.manual.length) showApplyResult({ replaced: [], linked: [], tracked: [], failed: [], manual: r.manual.map(x => ({ name: x.name, pageUrl: x.pageUrl, reason: x.reason })), nxmEnabled: r.nxmEnabled });
          await reloadProfile();
        } catch (err) { fail(err); a.disabled = false; a.innerHTML = 'Try again'; }
      }
      if (a.dataset.a === 'unlink') {
        if (!(await confirmBox('Unlink this mod?', `<b>${esc(m.name)}</b> stops being linked to its ${esc(srcMeta(m.source).name)} page. Your files in the game stay exactly as they are; you can link it to the right page afterwards with <b>Find on mod sites</b>.`, 'Unlink'))) return;
        const e2 = await call('external:unlink', { key: S.game.key, profile: S.profileName, uid });
        S.inst.sel = e2.uid;
        toast(`Unlinked. It's back to <b>${esc(e2.name)}</b> (your own files).`, 'ok');
        await reloadProfile();
      }
      if (a.dataset.a === 'usefile') {
        const file = await call('dialog:pick', { kind: 'file', title: `File for ${m.name}`, filters: [{ name: 'Mod files', extensions: ['zip', '7z', 'rar', 'pak', 'dll', 'jar', 'esp', 'esm', 'esl'] }, { name: 'All files', extensions: ['*'] }] });
        if (!file) return;
        S.profile = await call('profiles:get', { key: S.game.key, name: S.profileName });
        await call('mods:installFileFor', { key: S.game.key, profile: S.profileName, uid, path: file });
        toast(`Installed your file as <b>${esc(m.name)}</b>, replacing the old files. It stays linked to its page for updates.`, 'ok', 8000);
        await reloadProfile();
      }
      if (a.dataset.a === 'web') call('shell:url', m.url);
      if (a.dataset.a === 'folder') call('mods:openFolder', { key: S.game.key, profile: S.profileName, uid });
      if (a.dataset.a === 'unpin') { S.profile = await call('mods:patch', { key: S.game.key, profile: S.profileName, uid, patch: { pinned: false } }); renderInstalledDetail(uid); }
      if (a.dataset.a === 'remove') {
        if (!(await confirmBox('Uninstall mod?', `Remove <b>${esc(m.name)}</b> from “${esc(S.profileName)}”? Libraries that only it needed are removed too.`, 'Uninstall', true))) return;
        const removed = await call('mods:uninstall', { key: S.game.key, profile: S.profileName, uid });
        toast(`Removed ${removed.length} mod${removed.length === 1 ? '' : 's'}.`, 'ok');
        S.inst.sel = null;
        await reloadProfile();
      }
    } catch (err) { fail(err); }
  };
  if (m.source !== 'local') {
    try {
      const info = await getDetails(m.source, m.gameId, m.id);
      if (S.inst.sel !== uid || !$('#dDesc')) return;
      $('#dDesc').innerHTML = renderDesc(info);
    } catch (e) { if ($('#dDesc')) $('#dDesc').innerHTML = `<span class="muted">Couldn't load the description (${esc(e.message)}).</span>`; }
  }
}

async function versionPicker(m) {
  const mo = modal(`<header><div><h2>Pick a version</h2><p>${esc(m.name)} — picking an older version pins it so auto-update leaves it alone.</p></div></header><div class="mbody"><div class="center"><span class="spinner"></span></div></div><footer><button class="btn" data-a="close">Close</button></footer>`, { wide: true });
  mo.el.addEventListener('click', e => { if (e.target.closest('[data-a="close"]')) mo.close(); });
  try {
    const info = await getDetails(m.source, m.gameId, m.id, true);
    $('.mbody', mo.el).innerHTML = `<div class="vlist">${versionRows(info, m)}</div>`;
    $('.mbody', mo.el).onclick = async e => {
      const b = e.target.closest('[data-ver]');
      if (!b) return;
      mo.close();
      await doInstall({ source: m.source, gameId: m.gameId, modId: m.id, versionId: b.dataset.ver }, `${m.name} ${b.dataset.vname}`);
    };
  } catch (e) { $('.mbody', mo.el).innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
}
function versionRows(info, inst) {
  const g = S.game;
  return (info.versions || []).map((v, i) => {
    const isCur = inst && String(inst.versionId) === String(v.id);
    const fits = g.key === 'minecraft' && g.mcVersion && v.gameVersions.length ? v.gameVersions.includes(g.mcVersion) : null;
    return `<div class="vrow"><span class="vv">${esc(v.version || v.fileName)}</span>${i === 0 ? '<span class="pill info">newest</span>' : ''}${isCur ? '<span class="pill ok">installed</span>' : ''}${fits === false ? `<span class="pill bad" data-tip="Made for ${attr(v.gameVersions.slice(0, 6).join(', '))}">not for ${esc(g.mcVersion)}</span>` : ''}
      <span class="grow" title="${attr(v.fileName || '')}">${esc(v.gameVersions && v.gameVersions.length ? v.gameVersions.slice(0, 4).join(', ') : v.fileName || '')}</span>
      <span class="vd" title="${attr(fullDate(v.date))}">${esc(ago(v.date))}</span><span class="vd">${esc(fmtBytes(v.size))}</span>
      <button class="btn sm ${isCur ? '' : ''}" data-ver="${attr(v.id)}" data-vname="${attr(v.version || '')}" ${isCur ? 'disabled' : ''}>${isCur ? 'Installed' : 'Install'}</button></div>`;
  }).join('') || '<div class="muted">No files listed.</div>';
}

async function checkUpdates() {
  const b = $('#iUpd'); b.disabled = true; b.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span>Checking…';
  try {
    const r = await call('mods:checkUpdates', { key: S.game.key, profile: S.profileName });
    toast(r.updated.length ? `Updated ${r.updated.length} mod${r.updated.length === 1 ? '' : 's'}:<br>${r.updated.map(esc).join('<br>')}` : r.available.length ? `${r.available.length} update${r.available.length === 1 ? '' : 's'} available.` : 'Everything is up to date.', r.errors.length ? 'warn' : 'ok', 7000);
    if (r.errors.length) toast(`Couldn't check ${r.errors.length}: ${esc(r.errors.slice(0, 3).join('; '))}`, 'warn', 8000);
    await reloadProfile();
  } catch (e) { fail(e); }
  finally { if ($('#iUpd')) { $('#iUpd').disabled = false; $('#iUpd').innerHTML = `${I.refresh}Check updates`; } }
}
async function updateAll() {
  const mods = S.profile.mods.filter(hasUpdate);
  const t = toast(`<span class="spinner"></span> Updating ${mods.length} mods…`, 'info', 0);
  let ok = 0;
  for (const m of mods) {
    try { await call('mods:update', { key: S.game.key, profile: S.profileName, uid: m.uid }); ok++; } catch (e) { toast(`${esc(m.name)}: ${esc(e.message)}`, 'error', 8000); }
  }
  t.remove();
  toast(`Updated ${ok} of ${mods.length} mods.`, ok === mods.length ? 'ok' : 'warn');
  reloadProfile();
}
async function setAll(on) { S.profile = await call('mods:setAll', { key: S.game.key, profile: S.profileName, enabled: on }); drawInstalledList(); renderHeroMeta(); }
async function installFromFile() {
  const paths = await call('dialog:pick', { kind: 'file', multi: true, title: 'Mod files', filters: [{ name: 'Mods', extensions: ['zip', '7z', 'rar', 'dll', 'jar', 'pak', 'esp', 'esm', 'esl'] }, { name: 'All files', extensions: ['*'] }] });
  if (paths && paths.length) installLocal(paths);
}
async function installLocal(paths) {
  try {
    const r = await call('mods:installLocal', { key: S.game.key, profile: S.profileName, paths });
    toast(`Installed ${r.map(m => esc(m.name)).join(', ')}`, 'ok');
    await reloadProfile();
  } catch (e) { fail(e); }
}

// ======================================================================
// BROWSE TAB
// ======================================================================
function buildBrowse() {
  const pane = $('#pane-browse');
  pane.dataset.built = S.game.key;
  const g = S.game;
  const B = S.browse;
  const ids = Object.keys(g.sources || {}).filter(id => S.settings.sources[id] !== false);
  pane.innerHTML = `<div class="split">
    <div class="listcol">
      <div class="listbar">
        <div class="search">${I.search}<input class="input" id="bQ" placeholder="Search mods on ${ids.map(id => esc(srcMeta(id).name)).join(', ') || 'mod sites'}…" spellcheck="false"></div>
        <select class="input" id="bSort"><option value="popular">Most popular</option><option value="downloads">Most downloads</option><option value="updated">Recently updated</option><option value="newest">Newest</option><option value="name">Name A–Z</option></select>
        ${g.key === 'minecraft' ? `<input class="input" id="bMc" style="width:110px" placeholder="MC version" value="${attr(B.gameVersion || g.mcVersion || '')}">` : ''}
      </div>
      <div class="listbar2" id="bSrc"></div>
      <div class="list" id="bList" tabindex="0"></div>
    </div>
    <div class="detailcol" id="bDetail"><div class="placeholder"><div>${I.search.replace('<svg', '<svg width="54" height="54"')}<b>Pick a mod</b>to read what it does, check its version and install it.<br><span class="muted">The list keeps your place while you look.</span></div></div></div></div>`;
  $('#bQ').value = B.q;
  $('#bSort').value = B.sort;
  let qt;
  $('#bQ').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { B.q = e.target.value; resetBrowse(); }, 350); });
  $('#bSort').onchange = e => { B.sort = e.target.value; resetBrowse(); };
  if ($('#bMc')) $('#bMc').addEventListener('change', e => { B.gameVersion = e.target.value.trim(); resetBrowse(); });
  const list = $('#bList');
  list.addEventListener('scroll', () => { if (list.scrollTop + list.clientHeight > list.scrollHeight - 700) loadBrowsePage(); });
  list.addEventListener('click', e => { const r = e.target.closest('.mrow'); if (r) selectBrowse(Number(r.dataset.i)); if (e.target.closest('#bRetry')) loadBrowsePage(true); });
  list.addEventListener('keydown', e => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const i = B.sel == null ? -1 : B.sel;
    const n = Math.max(0, Math.min(B.mods.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    selectBrowse(n);
    const row = $(`.mrow[data-i="${n}"]`, list); if (row) row.scrollIntoView({ block: 'nearest' });
  });
  $('#bSrc').onclick = e => {
    const c = e.target.closest('[data-s]');
    if (!c) return;
    const s = c.dataset.s;
    if (srcMeta(s).needsKey && !srcMeta(s).keylessBrowse && !S.settings.keys[s]) return showView('settings');
    B.sources = B.sources.includes(s) ? B.sources.filter(x => x !== s) : [...B.sources, s];
    resetBrowse();
  };
  renderBrowseSources();
  if (B.mods.length) { drawBrowseRows(0); if (B.sel != null) selectBrowse(B.sel, true); }
  else resetBrowse();
  renderBanners();
}
function renderBrowseSources() {
  const B = S.browse, g = S.game;
  const ids = Object.keys(g.sources || {}).filter(id => S.settings.sources[id] !== false);
  $('#bSrc').innerHTML = `<span>Sites:</span>` + ids.map(id => {
    const ps = B.perSource[id] || {};
    const s = srcMeta(id);
    const noKey = s.needsKey && !s.keylessBrowse && !S.settings.keys[id];
    const on = !B.sources.length || B.sources.includes(id);
    return `<button class="chip ${on && B.sources.length ? 'on' : ''}" data-s="${id}" ${noKey ? 'data-tip="Needs an API key — click to add it in Settings"' : ps.error ? `data-tip="${attr(ps.error)}"` : ''} style="${!on ? 'opacity:.55' : ''}"><i class="dot" style="background:${attr(s.color)}"></i>${esc(s.name)}${noKey ? ' <span class="warn">key</span>' : ps.error ? ' <span class="warn">!</span>' : ps.total != null ? ` <span class="n">${fmtNum(ps.total)}</span>` : ''}</button>`;
  }).join('') + (B.sources.length ? `<button class="btn sm ghost" data-allsites="1">Show all sites</button>` : '') + (ids.length ? '' : '<span>No mod sites list this game.</span>');
}
function resetBrowse() {
  const B = S.browse;
  B.token++; B.page = 0; B.mods = []; B.hasMore = true; B.loading = false; B.sel = null; B.seen = new Set();
  const list = $('#bList');
  if (list) { list.innerHTML = ''; list.scrollTop = 0; }
  renderBrowseSources();
  loadBrowsePage();
}
async function loadBrowsePage(retry) {
  const B = S.browse;
  if (B.loading || (!B.hasMore && !retry)) return;
  B.loading = true;
  const token = B.token;
  const list = $('#bList');
  $$('.list-end', list).forEach(x => x.remove());
  list.insertAdjacentHTML('beforeend', `<div class="list-end" id="bLoading">${B.page === 0 ? Array.from({ length: 8 }, () => '<div class="skel" style="height:52px;margin:6px 0"></div>').join('') : '<span class="spinner"></span>'}</div>`);
  try {
    const r = await call('mods:browse', { key: S.game.key, query: B.q, sort: B.sort, page: B.page, sources: B.sources, gameVersion: B.gameVersion });
    if (token !== B.token) return;
    B.perSource = r.perSource;
    B.page++;
    B.hasMore = r.hasMore;
    B.seen = B.seen || new Set();
    const fresh = r.mods.filter(m => { const k = m.source + ':' + m.id; if (B.seen.has(k)) return false; B.seen.add(k); return true; });
    const start = B.mods.length;
    B.mods.push(...fresh);
    $('#bLoading') && $('#bLoading').remove();
    drawBrowseRows(start);
    renderBrowseSources();
    if (!B.mods.length) list.insertAdjacentHTML('beforeend', `<div class="list-end">${Object.values(r.perSource).some(p => p.error && p.error !== 'NO_KEY') ? 'Some sites could not be reached. <a href="#" id="bRetry">Try again</a>' : 'No mods found.'}</div>`);
    else if (!B.hasMore) list.insertAdjacentHTML('beforeend', `<div class="list-end">That's everything — ${B.mods.length} mods.</div>`);
    B.loading = false;
    // Short page that doesn't fill the view: keep going.
    if (B.hasMore && list.scrollHeight <= list.clientHeight + 100) loadBrowsePage();
  } catch (e) {
    if (token !== B.token) return;
    $('#bLoading') && $('#bLoading').remove();
    list.insertAdjacentHTML('beforeend', `<div class="list-end">Couldn't load mods: ${esc(e.message)} <a href="#" id="bRetry">Try again</a></div>`);
    B.loading = false;
  }
}
const installedMap = () => new Map((S.profile ? S.profile.mods : []).map(m => [m.uid, m]));
function browseRow(m, i, inst) {
  const im = inst.get(`${m.source}:${m.id}`);
  return `<div class="mrow ${S.browse.sel === i ? 'sel' : ''}" data-i="${i}">
    ${img(m.icon, 'mico')}
    <div class="mmain"><div class="mtop"><span class="mname">${esc(m.name)}</span>${srcBadge(m.source)}${m.deprecated ? '<span class="pill bad">deprecated</span>' : ''}</div>
      <div class="msum">${esc(m.summary || '')}</div></div>
    <div class="mside">${im ? `<span class="inst-mark">${I.check.replace('<svg', '<svg width="13" height="13" style="fill:none;stroke:currentColor;stroke-width:3"')}Installed</span>` : `<span class="v">${esc(m.version || '')}</span>`}
      <span>${m.downloads != null ? fmtNum(m.downloads) + ' ↓ · ' : ''}<span title="${attr(fullDate(m.updatedAt))}">${esc(ago(m.updatedAt))}</span></span></div></div>`;
}
function drawBrowseRows(start) {
  const list = $('#bList');
  const inst = installedMap();
  const html = S.browse.mods.slice(start).map((m, j) => browseRow(m, start + j, inst)).join('');
  // Append only: rows already on screen stay put, so the scroll position never jumps.
  const end = $('.list-end', list);
  if (end) end.insertAdjacentHTML('beforebegin', html); else list.insertAdjacentHTML('beforeend', html);
}
function markInstalledInBrowse() {
  const list = $('#bList');
  if (!list || !S.browse.mods.length) return;
  const inst = installedMap();
  $$('.mrow', list).forEach(r => {
    const m = S.browse.mods[Number(r.dataset.i)];
    if (!m) return;
    const side = $('.mside', r);
    const im = inst.get(`${m.source}:${m.id}`);
    side.firstElementChild.outerHTML = im ? `<span class="inst-mark">${I.check.replace('<svg', '<svg width="13" height="13" style="fill:none;stroke:currentColor;stroke-width:3"')}Installed</span>` : `<span class="v">${esc(m.version || '')}</span>`;
  });
  if (S.browse.sel != null) selectBrowse(S.browse.sel, true);
}

async function getDetails(source, gameId, modId, fresh) {
  const k = `${source}|${gameId}|${modId}`;
  // CurseForge's terms forbid caching its data: always ask again.
  if (source === 'curseforge') return call('mods:details', { source, gameId, modId });
  if (!fresh && detailCache.has(k)) return detailCache.get(k);
  const p = call('mods:details', { source, gameId, modId });
  detailCache.set(k, p);
  p.catch(() => detailCache.delete(k));
  return p;
}

let selToken = 0;
async function selectBrowse(i, keepDetailScroll) {
  const B = S.browse;
  const m = B.mods[i];
  if (!m) return;
  B.sel = i;
  $$('#bList .mrow').forEach(r => r.classList.toggle('sel', Number(r.dataset.i) === i));
  const d = $('#bDetail');
  const tok = ++selToken;
  const prevTop = d.scrollTop;
  const inst = installedMap().get(`${m.source}:${m.id}`);
  const head = info => `<div class="dhead">${img(info.icon || m.icon, 'dico')}<div style="min-width:0;flex:1"><h2>${esc(info.name || m.name)}</h2><div class="by">${info.author || m.author ? 'by ' + esc(info.author || m.author) : ''}</div>
      <div class="tags">${srcBadge(m.source)}${(info.categories || m.categories || []).slice(0, 5).map(c => `<span class="pill">${esc(c)}</span>`).join('')}${info.nsfw ? '<span class="pill bad">18+</span>' : ''}</div></div></div>`;
  const facts = (info, latest) => `<div class="facts">
      <div class="fact"><small>Version</small><b class="mono">${esc((latest && latest.version) || info.version || m.version || '—')}</b></div>
      <div class="fact"><small>Last updated</small><b title="${attr(fullDate(info.updatedAt || m.updatedAt))}">${esc(ago(info.updatedAt || m.updatedAt))}</b></div>
      <div class="fact"><small>Downloads</small><b>${fmtNum(info.downloads ?? m.downloads)}</b></div>
      <div class="fact"><small>${m.source === 'nexus' ? 'Endorsements' : 'Likes'}</small><b>${fmtNum(info.likes ?? m.likes)}</b></div>
      ${info.createdAt || m.createdAt ? `<div class="fact"><small>First released</small><b title="${attr(fullDate(info.createdAt || m.createdAt))}">${esc(new Date(info.createdAt || m.createdAt).toLocaleDateString())}</b></div>` : ''}
      ${latest && latest.gameVersions && latest.gameVersions.length ? `<div class="fact"><small>Game versions</small><b>${esc(latest.gameVersions.slice(0, 5).join(', '))}${latest.gameVersions.length > 5 ? '…' : ''}</b></div>` : ''}
    </div>`;
  const actions = latest => {
    const upd = inst && latest && String(inst.versionId) !== String(latest.id);
    return `<div class="dactions">
      ${!inst ? `<button class="btn primary big" data-a="install">${I.dl}Install${latest ? ' ' + esc(latest.version || '') : ''}</button>` : upd ? `<button class="btn primary big" data-a="install">${I.up}Update to ${esc(latest.version || '')}</button>` : `<button class="btn big" disabled>${I.check}Installed ${esc(inst.version || '')}</button>`}
      ${inst ? `<button class="btn big" data-a="goto">Show in installed</button>` : ''}
      ${m.url ? `<button class="btn big" data-a="web">${I.ext}Website</button>` : ''}</div>`;
  };
  d.innerHTML = head(m) + `<div class="dbody">${facts(m, null)}${actions(null)}<div class="card"><h3>About this mod</h3><div class="desc"><div class="skel" style="height:14px;width:80%"></div><div class="skel" style="height:14px;width:60%;margin-top:8px"></div><div class="skel" style="height:120px;margin-top:12px"></div></div></div></div>`;
  wireBrowseDetail(d, m, null);
  try {
    const info = await getDetails(m.source, m.gameId, m.id);
    if (tok !== selToken) return;
    const latest = (info.versions || [])[0] || null;
    const deps = latest && latest.dependencies ? latest.dependencies.filter(x => x.required !== false) : [];
    d.innerHTML = head(info) + `<div class="dbody">${facts(info, latest)}${actions(latest)}
      ${inst ? statusCard(inst.uid) : ''}
      ${deps.length ? `<div class="card"><h3>Needs ${deps.length} other mod${deps.length === 1 ? '' : 's'} (installed automatically)</h3><div style="display:flex;flex-wrap:wrap;gap:6px">${deps.slice(0, 30).map(x => `<span class="pill">${esc(x.name || x.modId)}${x.versionRange ? ' ' + esc(x.versionRange) : ''}</span>`).join('')}</div></div>` : ''}
      ${(info.screenshots || []).length ? `<div class="card"><h3>Screenshots</h3><div class="shots">${info.screenshots.slice(0, 12).map(u => `<img src="${attr(u)}" loading="lazy" referrerpolicy="no-referrer" alt="">`).join('')}</div></div>` : ''}
      <div class="card"><h3>About this mod</h3><div class="desc">${renderDesc(info)}</div></div>
      <div class="card"><h3>All versions</h3><div class="vlist">${versionRows(info, inst)}</div></div></div>`;
    wireBrowseDetail(d, m, latest);
    if (keepDetailScroll) d.scrollTop = prevTop; else d.scrollTop = 0;
  } catch (e) {
    if (tok !== selToken) return;
    const desc = $('.desc', d);
    if (desc) desc.innerHTML = `<span class="muted">Couldn't load details: ${esc(e.message)}</span>`;
  }
}
function wireBrowseDetail(d, m, latest) {
  d.onclick = async e => {
    const im = e.target.closest('.shots img');
    if (im) { const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img src="${attr(im.src)}" referrerpolicy="no-referrer">`; lb.onclick = () => lb.remove(); document.body.appendChild(lb); return; }
    const v = e.target.closest('[data-ver]');
    if (v) return doInstall({ source: m.source, gameId: m.gameId, modId: m.id, versionId: v.dataset.ver }, `${m.name} ${v.dataset.vname}`);
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'install') doInstall({ source: m.source, gameId: m.gameId, modId: m.id, versionId: null }, m.name, a);
    if (a.dataset.a === 'web') call('shell:url', m.url);
    if (a.dataset.a === 'goto') { S.inst.sel = `${m.source}:${m.id}`; setTab('installed'); renderInstalled(); const r = $(`#iList .mrow[data-uid="${CSS.escape(S.inst.sel)}"]`); if (r) r.scrollIntoView({ block: 'center' }); }
  };
}

async function doInstall(req, label, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:16px;height:16px"></span>Installing…'; }
  try {
    const r = await call('mods:install', { key: S.game.key, profile: S.profileName, ...req });
    if (r.installed.length) toast(`Installed ${r.installed.map(esc).join(', ')} into <b>${esc(S.profileName)}</b>`, 'ok');
    else if (r.skipped.length && !r.manual.length) toast(`${esc(label)} is already installed.`, 'info');
    for (const mm of r.manual) {
      const t = toast(`<b>${esc(mm.name)}</b>: ${esc(mm.reason)}${mm.pageUrl ? `<br><a href="${attr(mm.pageUrl)}">Open download page</a> — then drop the file onto ModHaven.` : ''}`, 'warn', 15000);
      void t;
    }
    await reloadProfile();
  } catch (e) { fail(e); if (btn) { btn.disabled = false; btn.innerHTML = `${I.dl}Install`; } }
}

function renderDesc(info) {
  let html = '';
  const raw = info.description || info.summary || '';
  if (!raw) return '<span class="muted">The author didn\'t write a description.</span>';
  if (info.descriptionFormat === 'markdown') html = marked.parse(raw, { gfm: true, breaks: false });
  else if (info.descriptionFormat === 'html') html = raw;
  else html = esc(raw).replace(/\n/g, '<br>');
  const clean = DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'script'], FORBID_ATTR: ['style', 'onerror', 'onload'] });
  const box = document.createElement('div');
  box.innerHTML = clean;
  box.querySelectorAll('img').forEach(i => { i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; });
  box.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noreferrer'; });
  return box.innerHTML;
}

// ======================================================================
// MODS INSTALLED BY HAND
// ======================================================================
async function quickExternal() {
  const g = S.game;
  if (!g || (!g.installPath && g.key !== 'minecraft')) return;
  try {
    const r = await call('external:quick', { key: g.key, profile: S.profileName });
    if (!S.game || S.game.key !== g.key) return;
    const was = S.external && S.external.key === g.key ? S.external : null;
    S.external = { key: g.key, count: r.count, found: r.found, unlinked: r.unlinked, names: r.names, dismissed: !!(was && was.dismissed) };
    renderBanners();
  } catch { }
}

function adoptedNote(m) {
  const why = m.source === 'local' ? `It isn't linked to a mod site yet, so it can't be updated. <a href="#" data-relink="${attr(m.uid)}">Find it on the mod sites</a>`
    : String(m.versionId).startsWith('adopted-') ? "Its exact version wasn't listed on the site, so the next update installs the newest version." : '';
  return `<div class="banner info" style="margin:0"><div class="grow">You installed this yourself; ModHaven took it over ${esc(ago(m.adopted.at))}${m.adopted.how && m.adopted.how !== 'not matched' ? ` (${esc(m.adopted.how)})` : ''}. ${why}</div></div>`;
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-relink]');
  if (a) { e.preventDefault(); reviewExternal({ only: 'profile:' + a.dataset.relink }); }
});

const HOW_LABEL = { 'exact file': ['Exact file match', 'ok'], 'package manifest': ['Package manifest', 'ok'], 'package folder': ['Package folder', 'ok'], name: ['Same name', 'ok'], similar: ['Similar name', 'warn'] };
const howText = mt => {
  if (mt.how === 'similar') return [`${Math.round((mt.score || 0) * 100)}% similar name`, 'warn'];
  if (mt.how === 'name' && mt.versionId) return ['Same name + version', 'ok'];
  return HOW_LABEL[mt.how] || [mt.how, 'info'];
};
// Strong matches start ticked; "similar" ones wait for the user to confirm.
const strong = mt => !!mt && mt.how !== 'similar';

function extRow(it, st, g) {
  const mt = it.matches[st.pick] || null;
  const found = `<div class="ext-found"><b>${esc(it.name)}</b>${it.version ? ` <span class="mono muted">${esc(it.version)}</span>` : ''}
    ${it.profileUid ? '<div><span class="pill">in ModHaven · not linked</span></div>' : ''}
    <div class="mono muted ext-path" title="${attr(it.files.join('\n'))}">${esc(it.primary)}${it.files.length > 1 ? ` +${it.files.length - 1} file${it.files.length > 2 ? 's' : ''}` : ''}</div>
    <button class="btn sm ghost" data-search style="margin-top:6px;padding:0 8px">${I.search}Search the sites…</button></div>`;
  let match;
  if (mt) {
    const [ht, hc] = howText(mt);
    const upd = mt.latest && mt.versionId && String(mt.latest.versionId) !== String(mt.versionId);
    const state = upd ? ' <span class="pill info">update available</span>' : mt.latest && mt.versionId ? ' <span class="pill ok">up to date</span>' : '';
    const picker = it.matches.length > 1 ? `<select class="input" data-pick style="height:28px;margin-top:6px;max-width:100%">${it.matches.map((x, i) => `<option value="${i}" ${i === st.pick ? 'selected' : ''}>${esc(srcMeta(x.source).name)}: ${esc(x.name)}${x.author ? ' by ' + esc(x.author) : ''} (${esc(howText(x)[0])})</option>`).join('')}</select>` : '';
    match = `${img(mt.icon, 'mico')}<div style="min-width:0;flex:1">
        <div class="row" style="gap:6px;flex-wrap:wrap"><b class="ext-name">${esc(mt.name)}</b>${srcBadge(mt.source)}<span class="pill ${hc}">${esc(ht)}</span></div>
        <div class="muted" style="font-size:12.5px">${mt.author ? 'by ' + esc(mt.author) + ' · ' : ''}${mt.version ? `you have ${esc(mt.version)}` : 'your version unknown'}${mt.latest ? ` · newest ${esc(mt.latest.version || '')}` : ''}${state}</div>
        ${picker}
        ${mt.filesDiffer ? '<div class="muted" style="font-size:12px;margin-top:4px;color:var(--yellow)">None of the downloads on this page contain your files: probably a different mod (or a different version of it from somewhere else).</div>' : mt.how === 'similar' ? '<div class="muted" style="font-size:12px;margin-top:4px">Not an exact name match. Check it is the same mod (open the page) before ticking it.</div>' : ''}</div>
      ${mt.url ? `<a class="btn sm ghost" href="${attr(mt.url)}" data-tip="Open on the website">${I.ext}</a>` : ''}`;
  } else {
    const sites = Object.keys(g.sources || {}).map(id => esc(srcMeta(id).name)).join(', ') || 'any mod site';
    match = `<div class="muted" style="font-size:13px">Nothing close found on ${sites}${it.notSearched ? ' (not searched: too many mods)' : ''}.<br>Use <b>Search the sites…</b> to look it up by another name${it.profileUid ? '' : ', or tick it to track it in ModHaven without updates'}.</div>`;
  }
  return `<div class="ext-row ${st.on ? 'on' : ''}" data-k="${attr(it.key)}">
    <label class="row"><input type="checkbox" data-on ${st.on ? 'checked' : ''} ${it.profileUid && !mt ? 'disabled' : ''}></label>
    ${found}<div class="ext-arrow">→</div><div class="ext-match">${match}</div></div>`;
}

async function reviewExternal(opts = {}) {
  const g = S.game;
  if (!g.installPath && g.key !== 'minecraft') { toast('Set the game folder first (Game settings).', 'warn'); return gameSettings(); }
  const m = modal(`<header><div><h2>Find your mods on the mod sites</h2><p>${esc(g.name)}: mods you installed yourself, matched to ${Object.keys(g.sources || {}).map(id => esc(srcMeta(id).name)).join(', ') || 'the mod sites'}. Pick the right page for each, and ModHaven downloads it fresh so it can keep it updated.</p></div></header>
    <div class="mbody" id="extBody"><div id="extProg"><div class="row"><span class="spinner"></span><span>Scanning the game folder…</span></div></div></div>
    <footer id="extFoot"><button class="btn" data-a="close">Close</button></footer>`, { wide: true });
  let items = [], sel = new Map();
  m.el.addEventListener('click', async e => {
    if (e.target.closest('[data-a="close"]')) {
      const box = $('#extIgnore', m.el);
      const loose = items.filter(it => !it.profileUid);
      if (box && box.checked && loose.length && ![...sel.values()].some(x => x.on)) {
        await call('external:ignore', { key: g.key, keys: loose.map(it => it.key) }).catch(() => { });
        S.external = { key: g.key, count: 0, names: [] }; renderBanners();
      }
      m.close();
    }
  });
  let res;
  try { res = await call('external:scan', { key: g.key, profile: S.profileName }); }
  catch (e) { $('#extBody', m.el).innerHTML = `<div class="banner bad" style="margin:0"><div class="grow">${esc(e.message)}</div></div>`; return; }
  items = (res.items || []).filter(it => !opts.only || it.key === opts.only);
  if (!items.length) {
    $('#extBody', m.el).innerHTML = `<div class="placeholder" style="height:auto;padding:30px"><div>${I.check.replace('<svg', '<svg width="54" height="54"')}<b>Nothing to add</b>Every mod in the game folder is managed by ModHaven and linked to a mod site${res.ignored ? ` (${res.ignored} you chose to leave alone: <a href="#" id="extUnignore">show them again</a>)` : ''}.</div></div>`;
    const un = $('#extUnignore', m.el);
    if (un) un.onclick = async ev => { ev.preventDefault(); await call('external:unignore', g.key); m.close(); reviewExternal(); };
    S.external = { key: g.key, count: 0, names: [] }; renderBanners();
    return;
  }
  sel = new Map(items.map(it => [it.key, { on: strong(it.best), pick: 0 }]));
  let replace = true;
  const draw = () => {
    const body = $('#extBody', m.el);
    const top = body.scrollTop;
    const matched = items.filter(i => i.matches.length).length;
    body.innerHTML = `<div class="muted" style="font-size:13px">${items.length} mod${items.length === 1 ? '' : 's'} to check; candidates found for <b>${matched}</b>. Ticked mods go into the profile <b>${esc(S.profileName)}</b>.
        Use the dropdown to pick a different page, or <b>Search the sites…</b> if the right one isn't listed. Your current files are always backed up first.</div>
      <div class="ext-list">${items.map(it => extRow(it, sel.get(it.key), g)).join('')}</div>`;
    body.scrollTop = top;
    const n = [...sel.values()].filter(x => x.on).length;
    const nexusFree = items.some(it => sel.get(it.key).on && (it.matches[sel.get(it.key).pick] || {}).source === 'nexus');
    $('#extFoot', m.el).innerHTML = `<div style="margin-right:auto;display:flex;flex-direction:column;gap:4px">
        <label class="row" style="font-size:13px"><input type="checkbox" id="extReplace" ${replace ? 'checked' : ''}> <b>Replace my files with a fresh download from the site</b> (recommended)</label>
        ${replace && nexusFree ? '<span class="muted" style="font-size:12px;margin-left:22px">Nexus only lets free accounts download through its website: ModHaven links these mods now and opens their pages so you can click “Mod Manager Download”.</span>' : ''}
        ${items.some(it => !it.profileUid) ? '<label class="row muted" style="font-size:12.5px"><input type="checkbox" id="extIgnore" checked> Don\'t ask again about the ones I leave unticked</label>' : ''}</div>
      <button class="btn" data-a="close">Leave as is</button><button class="btn primary" data-a="adopt" ${n ? '' : 'disabled'}>${I.dl}${replace ? 'Download' : 'Add'} ${n} mod${n === 1 ? '' : 's'}</button>`;
  };
  draw();
  m.el.addEventListener('change', e => {
    if (e.target.id === 'extReplace') { replace = e.target.checked; return draw(); }
    const row = e.target.closest('.ext-row');
    if (!row) return;
    const st = sel.get(row.dataset.k);
    if (e.target.matches('[data-on]')) st.on = e.target.checked;
    if (e.target.matches('[data-pick]')) { st.pick = Number(e.target.value); st.on = true; }
    draw();
  });
  m.el.addEventListener('click', async e => {
    const sb = e.target.closest('[data-search]');
    if (sb) {
      const row = sb.closest('.ext-row');
      const it = items.find(x => x.key === row.dataset.k);
      const q = await prompt2('Search the mod sites', `Name to look for (instead of "${it.name}")`, it.matches[0] ? it.matches[0].name : it.name.replace(/^z+(?=[A-Z])/, '').replace(/([a-z])([A-Z])/g, '$1 $2'), 'Search');
      if (!q) return;
      sb.disabled = true; sb.innerHTML = '<span class="spinner" style="width:12px;height:12px"></span>Searching…';
      try {
        const found = await call('external:search', { key: g.key, query: q });
        if (!found.length) { toast(`Nothing found for "${esc(q)}".`, 'warn'); draw(); return; }
        const keep = it.matches.filter(x => x.how !== 'similar' && x.how !== 'name');
        it.matches = [...found, ...keep.filter(k => !found.some(f => f.source === k.source && f.modId === k.modId))];
        it.best = it.matches[0];
        const st = sel.get(it.key); st.pick = 0; st.on = true;
      } catch (err) { fail(err); }
      draw();
      return;
    }
    const btn = e.target.closest('[data-a="adopt"]');
    if (!btn) return;
    const picks = items.filter(it => sel.get(it.key).on).map(it => ({ cand: it, match: it.matches[sel.get(it.key).pick] || null }));
    const leave = items.filter(it => !sel.get(it.key).on && !it.profileUid).map(it => it.key);
    const ignoreRest = $('#extIgnore', m.el) && $('#extIgnore', m.el).checked;
    btn.disabled = true; btn.innerHTML = `<span class="spinner" style="width:14px;height:14px"></span>${replace ? 'Downloading' : 'Adding'}…`;
    try {
      const r = await call('external:adopt', { key: g.key, profile: S.profileName, picks, replace });
      if (ignoreRest && leave.length) await call('external:ignore', { key: g.key, keys: leave });
      m.close();
      S.external = { key: g.key, count: 0, names: [] };
      await reloadProfile();
      setTab('installed');
      showApplyResult(r);
    } catch (err) { fail(err); btn.disabled = false; btn.innerHTML = 'Try again'; }
  });
}

function showApplyResult(r) {
  const parts = [];
  if (r.replaced.length) parts.push(`<b>${r.replaced.length}</b> downloaded fresh and will update automatically`);
  if (r.linked.length) parts.push(`<b>${r.linked.length}</b> linked to their mod page`);
  if (r.tracked.length) parts.push(`<b>${r.tracked.length}</b> tracked without updates`);
  if (!r.manual.length) {
    toast((parts.join(', ') || 'Nothing changed') + '. Your old files are backed up in the game\'s data folder.', r.failed.length ? 'warn' : 'ok', 9000);
    if (r.failed.length) toast(`Couldn't do: ${r.failed.map(esc).join('; ')}`, 'error', 12000);
    return;
  }
  const mo = modal(`<header><div><h2>One more click for ${r.manual.length} mod${r.manual.length === 1 ? '' : 's'}</h2><p>${parts.join(', ') || 'Nothing downloaded yet'}.</p></div></header>
    <div class="mbody">
      <div>These sites only allow downloads through their own website for your account. Open each page and click <b>“Mod Manager Download”</b> (on Nexus: <i>Files</i> tab); ModHaven catches the download and replaces your old files automatically.${r.nxmEnabled ? ' <span class="pill ok">Nexus download links now open in ModHaven</span>' : ''}</div>
      <div class="vlist">${r.manual.map((x, i) => `<div class="vrow"><span class="grow" style="color:var(--text)"><b>${esc(x.name)}</b></span><button class="btn sm primary" data-open="${i}">${I.ext}Open download page</button></div>`).join('')}</div>
      <div class="muted" style="font-size:12.5px">Until then they stay installed as they are, already linked to their page, so ModHaven shows when an update is out.<br>No “Mod Manager Download” button on the page? Download the file normally, then in <b>Installed</b> select the mod and click <b>Use a file I downloaded</b>.</div>
      ${r.failed.length ? `<div class="banner bad" style="margin:0"><div class="grow">Couldn't do: ${r.failed.map(esc).join('; ')}</div></div>` : ''}
    </div>
    <footer><button class="btn" data-a="all">${I.ext}Open all ${r.manual.length}</button><button class="btn primary" data-a="done">Done</button></footer>`, { wide: true });
  mo.el.addEventListener('click', e => {
    const o = e.target.closest('[data-open]');
    if (o) { const x = r.manual[Number(o.dataset.open)]; if (x.pageUrl) call('shell:url', x.pageUrl); o.innerHTML = `${I.check}Opened`; }
    if (e.target.closest('[data-a="all"]')) r.manual.forEach((x, i) => setTimeout(() => x.pageUrl && call('shell:url', x.pageUrl), i * 400));
    if (e.target.closest('[data-a="done"]')) mo.close();
  });
}

// ======================================================================
// CRASH CENTER
// ======================================================================
const OUTCOME = {
  crashed: ['Crashed', I.x], 'failed-to-start': ["Didn't start", I.x], ok: ['Closed normally', I.check], passed: ['Passed test', I.check],
  'closed-with-errors': ['Closed with errors', '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17h.01"/></svg>'], running: ['Running…', I.pulse],
};
function renderCrash() {
  const pane = $('#pane-crash');
  if (!pane || S.tab !== 'crash') return;
  const runs = S.runs;
  const leftTop = $('#ccList') ? $('#ccList').scrollTop : 0;
  pane.innerHTML = `<div class="cc">
    <div class="cc-left">
      <div class="listbar"><b style="flex:1">Launch history</b><button class="btn sm ghost" id="ccClear" ${runs.length ? '' : 'disabled'}>Clear</button></div>
      <div class="list" id="ccList">
        <div class="run ${S.runSel === 'overview' ? 'sel' : ''}" data-r="overview"><div class="ri" style="background:var(--select);color:var(--accent)">${I.bug}</div><div class="rt"><b>Culprit finder & conflict map</b><span>Pinpoint which mods clash</span></div></div>
        ${runs.map(r => {
          const [label, icon] = OUTCOME[r.outcome] || [r.outcome, I.pulse];
          return `<div class="run ${S.runSel === r.id ? 'sel' : ''}" data-r="${attr(r.id)}"><div class="ri ${attr(r.outcome)}">${icon}</div>
          <div class="rt"><b>${esc(label)}${r.durationSec != null ? ` <span class="muted" style="display:inline;font-weight:400">· ${fmtDur(r.durationSec)}</span>` : ''}</b>
          <span>${esc(fullDate(r.startedAt))} · ${r.vanilla ? 'vanilla' : `${esc(r.profile || '')} · ${r.mods.length} mod${r.mods.length === 1 ? '' : 's'}`}${r.search ? ' · test' : ''}</span>
          ${r.culprits && r.culprits[0] ? `<span style="color:var(--red)">Suspect: ${esc(nameFor(r.culprits[0].uid))}</span>` : ''}</div></div>`;
        }).join('')}
        ${runs.length ? '' : '<div class="list-end">No launches yet. Start the game from ModHaven and every run is recorded here — crashes keep their logs.</div>'}
      </div>
    </div>
    <div class="cc-right" id="ccRight"></div></div>`;
  $('#ccList').scrollTop = leftTop;
  $('#ccList').onclick = e => { const r = e.target.closest('[data-r]'); if (!r) return; S.runSel = r.dataset.r; $$('#ccList .run').forEach(x => x.classList.toggle('sel', x.dataset.r === S.runSel)); renderCrashRight(); };
  $('#ccClear').onclick = async () => { if (await confirmBox('Clear launch history?', 'All recorded runs, crash logs verdicts and conflict info for this game are forgotten. Mod statuses go back to “not tested”.', 'Clear', true)) { await call('run:clear', S.game.key); S.runSel = 'overview'; reloadProfile(); } };
  renderCrashRight();
}
const EXIT_NAMES = { C0000005: 'memory access violation', C0000409: 'stack buffer overrun', C00000FD: 'stack overflow', C0000374: 'heap corruption', E0434352: '.NET exception', '80000003': 'breakpoint / assert', C000001D: 'illegal instruction', C0000094: 'divide by zero', '40000015': 'abort' };
function exitText(code) {
  const hex = (Number(code) >>> 0).toString(16).toUpperCase().padStart(8, '0');
  if (Number(code) >>> 0 < 256) return 'exit code ' + code;
  return `exit code 0x${hex}${EXIT_NAMES[hex] ? ' (' + EXIT_NAMES[hex] + ')' : ''}`;
}
const fmtDur = s => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);

function renderCrashRight() {
  const el = $('#ccRight');
  if (!el) return;
  if (S.runSel === 'overview') return renderOverview(el);
  const r = S.runs.find(x => x.id === S.runSel);
  if (!r) { S.runSel = 'overview'; return renderOverview(el); }
  const [label] = OUTCOME[r.outcome] || [r.outcome];
  const bad = ['crashed', 'failed-to-start'].includes(r.outcome);
  const maxScore = Math.max(10, ...(r.culprits || []).map(c => c.score));
  el.innerHTML = `
    <div class="row" style="align-items:flex-start"><div style="flex:1"><h2 style="margin:0;font:650 20px var(--font-display)">${esc(label)}</h2>
      <div class="muted">${esc(fullDate(r.startedAt))} · ran ${r.durationSec != null ? fmtDur(r.durationSec) : '—'} · game ${esc(r.gameVersion || '?')}${r.exitCode != null ? ` · ${esc(exitText(r.exitCode))}` : ''}</div></div>
      <div class="row">${bad ? `<button class="btn sm" data-o="ok">It didn't crash</button>` : r.outcome !== 'running' ? `<button class="btn sm" data-o="crashed">It did crash</button>` : ''}
      <button class="btn sm" id="rFolder">${I.folder}Saved logs</button></div></div>
    ${bad ? `<div class="card"><h3>Most likely cause</h3>${(r.culprits || []).length ? r.culprits.map(c => `<div class="suspect"><div class="meter"><b style="font-size:12px">${Math.round(c.score / maxScore * 100)}%</b><div><i style="width:${Math.round(c.score / maxScore * 100)}%"></i></div></div>
        <div style="flex:1"><b>${esc(nameFor(c.uid))}</b> ${srcBadge(String(c.uid).split(':')[0])}<ul>${c.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        ${S.profile.mods.some(m => m.uid === c.uid && m.enabled) ? `<button class="btn sm" data-off="${attr(c.uid)}">Turn off</button>` : ''}</div>`).join('')
        : `<div class="muted">The logs don't name a mod. Run the <a href="#" id="toFinder">culprit finder</a> — it turns mods off in halves until it finds which one (or which pair) crashes.</div>`}</div>` : ''}
    ${(r.evidence || []).length ? `<div class="card"><h3>What the logs say</h3>${r.evidence.slice(0, 20).map(e => `<div class="ev">${esc(e.text)}</div>`).join('')}</div>` : ''}
    ${(r.logs || []).length ? `<div class="card"><h3>Saved log files</h3><div class="row" style="flex-wrap:wrap;margin-bottom:10px">${r.logs.map(l => `<button class="chip" data-log="${attr(l.name)}">${esc(l.name.split('__').pop())} <span class="n">${esc(fmtBytes(l.size))}</span></button>`).join('')}</div><div id="logBox" class="muted">Pick a log to read it here.</div></div>` : (r.outcome !== 'running' ? '<div class="card muted">No new log files were written during this run.</div>' : '')}
    <div class="card"><h3>Mods that were on (${r.mods.length})</h3><div style="display:flex;flex-wrap:wrap;gap:6px">${r.mods.map(m => `<span class="pill">${esc(m.name)} <span class="mono" style="opacity:.7">${esc(m.version || '')}</span></span>`).join('') || '<span class="muted">None (vanilla run)</span>'}</div></div>`;
  el.onclick = async e => {
    const o = e.target.closest('[data-o]');
    if (o) { await call('run:setOutcome', { key: S.game.key, runId: r.id, outcome: o.dataset.o }); return reloadProfile(); }
    const off = e.target.closest('[data-off]');
    if (off) { S.profile = await call('mods:patch', { key: S.game.key, profile: S.profileName, uid: off.dataset.off, patch: { enabled: false } }); toast(`${esc(nameFor(off.dataset.off))} turned off.`, 'ok'); off.remove(); renderHeroMeta(); return; }
    if (e.target.id === 'toFinder') { e.preventDefault(); S.runSel = 'overview'; return renderCrash(); }
    if (e.target.closest('#rFolder')) return call('run:openFolder', { key: S.game.key, runId: r.id });
    const lg = e.target.closest('[data-log]');
    if (lg) {
      $$('[data-log]', el).forEach(x => x.classList.toggle('on', x === lg));
      const text = await call('run:readLog', { key: S.game.key, runId: r.id, name: lg.dataset.log });
      const lines = text.split(/\r?\n/);
      $('#logBox').outerHTML = `<div class="logview" id="logBox">${lines.slice(-4000).map(l => /error|exception|fatal|crash/i.test(l) ? `<span class="e">${esc(l)}</span>` : /warn/i.test(l) ? `<span class="w">${esc(l)}</span>` : esc(l)).join('\n')}</div>`;
      const lb = $('#logBox'); const firstErr = $('.e', lb); if (firstErr) lb.scrollTop = firstErr.offsetTop - 60;
    }
  };
}

async function renderOverview(el) {
  const s = S.search;
  const running = s && s.state === 'running';
  const enabled = S.profile.mods.filter(m => m.enabled).length;
  el.innerHTML = `
    <div class="card"><h3>${I.bug.replace('<svg', '<svg width="16" height="16" style="fill:none;stroke:currentColor;stroke-width:2"')}Find the mod that crashes</h3>
      ${running ? `<div style="display:flex;flex-direction:column;gap:10px"><div class="row"><span class="spinner"></span><b style="flex:1">Testing… step ${s.step} of about ${s.maxSteps}</b><button class="btn sm danger" id="sCancel">Stop</button></div>
          <div class="progress"><i style="width:${Math.min(100, Math.round(s.step / s.maxSteps * 100))}%"></i></div>
          ${s.current ? `<div class="muted" style="font-size:13px">Now: ${esc(s.current.label)} — ${s.current.mods.length} mods on. ${s.mode === 'auto' ? `If the game is still running after ${s.seconds}s it counts as working and is closed.` : 'Play until it crashes, or close the game if it works fine.'}</div>` : ''}
          <div class="search-log">${s.log.slice(-12).map(l => `<div>${esc(l.text)}</div>`).join('')}</div></div>`
        : `<p style="margin:0 0 12px;color:var(--text-2)">ModHaven starts the game several times with different halves of your ${enabled} turned-on mods. Each run tells it which half the problem is in, until it finds the <b>one mod</b> that crashes, or the <b>pair of mods</b> that crash only together. Your own on/off choices are put back afterwards.</p>
          <div class="row" style="flex-wrap:wrap;gap:10px"><div class="seg" id="sMode"><button data-m="auto" class="on">Automatic</button><button data-m="manual">I'll play each test</button></div>
          <span class="row muted" id="sSecWrap" style="font-size:13px">Count as working after <input class="input" id="sSec" type="number" min="15" max="900" value="${S.settings.autoTestSeconds}" style="width:76px;height:30px"> s</span>
          <div style="flex:1"></div><button class="btn primary" id="sStart" ${enabled ? '' : 'disabled'}>${I.play}Start culprit search</button></div>
          ${s && s.result ? `<div class="banner ${s.result.kind === 'single' || s.result.kind === 'pair' ? 'bad' : 'info'}" style="margin:14px 0 0"><div class="grow"><b>Last search:</b> ${esc(s.result.text)}</div></div>` : ''}`}
    </div>
    <div class="card"><h3>Conflict map</h3><div id="mxBox"><div class="skel" style="height:120px"></div></div></div>`;
  if ($('#sCancel')) $('#sCancel').onclick = () => call('search:cancel', S.game.key);
  let mode = 'auto';
  if ($('#sMode')) $('#sMode').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; $$('#sMode button').forEach(x => x.classList.toggle('on', x === b)); $('#sSecWrap').style.visibility = mode === 'auto' ? 'visible' : 'hidden'; };
  if ($('#sStart')) $('#sStart').onclick = async () => {
    if (!S.game.installPath && !S.game.exe) return toast('Set the game folder first (Game settings).', 'warn');
    try { S.search = await call('search:start', { key: S.game.key, profile: S.profileName, mode, seconds: Number($('#sSec').value) || S.settings.autoTestSeconds }); renderOverview(el); }
    catch (e) { fail(e); }
  };
  try {
    const mx = await call('analysis:matrix', { key: S.game.key, profile: S.profileName });
    const box = $('#mxBox');
    if (!box) return;
    if (mx.mods.length < 2) { box.innerHTML = '<div class="muted">Turn on at least two mods and launch the game to start building the map.</div>'; return; }
    const mods = mx.mods.slice(0, 80);
    const k = (a, b) => [a, b].sort().join('|');
    box.innerHTML = `<div class="legend muted" style="font-size:12.5px;margin-bottom:10px">
        <span><i class="dot mx-ok" style="border-radius:3px;width:12px;height:12px"></i>Worked together</span>
        <span><i class="dot mx-suspect" style="border-radius:3px;width:12px;height:12px"></i>Crash only when together</span>
        <span><i class="dot mx-confirmed" style="border-radius:3px;width:12px;height:12px"></i>Confirmed conflict</span>
        <span><i class="dot mx-files" style="border-radius:3px;width:12px;height:12px"></i>Overwrite the same files</span>
        <span><i class="dot mx-unknown" style="border-radius:3px;width:12px;height:12px"></i>Crashed together with others (unclear)</span>
        <span><i class="dot mx-none" style="border-radius:3px;width:12px;height:12px;border:1px solid var(--border)"></i>Not tested together</span></div>
      <div class="matrix-wrap"><table class="matrix"><thead><tr><th></th>${mods.map(m => `<th title="${attr(m.name)}"><div>${esc(m.name)}</div></th>`).join('')}</tr></thead>
      <tbody>${mods.map(a => `<tr><th title="${attr(a.name)}"><span style="display:inline-flex;gap:6px;align-items:center">${tri(a.status || 'untested', 13)}${esc(a.name)}</span></th>${mods.map(b => {
        if (a.uid === b.uid) return '<td class="mx-self"></td>';
        const c = mx.cell[k(a.uid, b.uid)];
        const p = mx.pairs[k(a.uid, b.uid)];
        const tipTxt = `${a.name} + ${b.name}: ${c === 'ok' ? `worked together ${p.ok}×` : c === 'suspect' ? `crashed ${p.bad}× together, each works without the other` : c === 'confirmed' ? 'confirmed conflict (culprit search)' : c === 'files' ? `both write ${p.files.length} same file(s), e.g. ${p.files[0]}` : c === 'unknown' ? `crashed ${p.bad}× together with other mods on` : 'not tested together yet'}`;
        return `<td class="mx-${c || 'none'}" data-tip="${attr(tipTxt)}"></td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
      ${mx.mods.length > 80 ? `<div class="muted" style="margin-top:8px;font-size:12.5px">Showing the first 80 of ${mx.mods.length} turned-on mods.</div>` : ''}`;
  } catch (e) { if ($('#mxBox')) $('#mxBox').innerHTML = `<span class="muted">${esc(e.message)}</span>`; }
}

// ======================================================================
// CONFIG EDITOR
// ======================================================================
async function renderConfig() {
  const pane = $('#pane-config');
  pane.innerHTML = '<div class="center" style="flex:1"><span class="spinner"></span></div>';
  try {
    const files = await call('config:list', { key: S.game.key, profile: S.profileName });
    if (!files.length) {
      pane.innerHTML = `<div class="placeholder" style="flex:1"><div>${I.file.replace('<svg', '<svg width="54" height="54"')}<b>No config files yet</b>Most mods create their settings file the first time the game runs.<br>Start the game once with “${esc(S.profileName)}”, then come back here.</div></div>`;
      return;
    }
    pane.innerHTML = `<div class="cfg"><div class="cfg-files"><div class="search" style="margin:4px 2px 8px">${I.search}<input class="input" id="cQ" placeholder="Filter ${files.length} files…"></div><div id="cList"></div></div>
      <div class="cfg-edit"><div class="listbar"><b id="cName" class="mono" style="font-size:13px">Pick a file</b><span class="row"><span id="cState" class="muted" style="font-size:12.5px"></span><button class="btn sm" id="cRevert" disabled>Revert</button><button class="btn sm primary" id="cSave" disabled>Save</button></span></div>
      <textarea id="cText" spellcheck="false" disabled placeholder="Select a config file on the left"></textarea></div></div>`;
    const draw = q => { $('#cList').innerHTML = files.filter(f => !q || f.name.toLowerCase().includes(q)).map(f => `<div class="cfg-file ${S.cfgSel === f.file ? 'sel' : ''}" data-f="${attr(f.file)}" title="${attr(f.name)}">${esc(f.name)}</div>`).join(''); };
    draw('');
    $('#cQ').oninput = e => draw(e.target.value.toLowerCase());
    let original = '';
    const open = async file => {
      S.cfgSel = file;
      $$('.cfg-file').forEach(x => x.classList.toggle('sel', x.dataset.f === file));
      original = await call('config:read', { file });
      $('#cText').value = original; $('#cText').disabled = false;
      $('#cName').textContent = files.find(f => f.file === file).name;
      $('#cSave').disabled = $('#cRevert').disabled = true; $('#cState').textContent = '';
    };
    $('#cList').onclick = e => { const f = e.target.closest('[data-f]'); if (f) open(f.dataset.f); };
    $('#cText').oninput = () => { const dirty = $('#cText').value !== original; $('#cSave').disabled = $('#cRevert').disabled = !dirty; $('#cState').textContent = dirty ? 'Unsaved changes' : ''; };
    $('#cText').onkeydown = e => {
      if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.setRangeText('\t', s, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input')); }
      if (e.key === 's' && e.ctrlKey) { e.preventDefault(); $('#cSave').click(); }
    };
    $('#cRevert').onclick = () => { $('#cText').value = original; $('#cText').dispatchEvent(new Event('input')); };
    $('#cSave').onclick = async () => { try { await call('config:write', { file: S.cfgSel, text: $('#cText').value }); original = $('#cText').value; $('#cText').dispatchEvent(new Event('input')); $('#cState').textContent = 'Saved (backup kept as .bak)'; } catch (e) { fail(e); } };
    if (S.cfgSel && files.some(f => f.file === S.cfgSel)) open(S.cfgSel);
  } catch (e) { pane.innerHTML = `<div class="placeholder" style="flex:1"><div>${esc(e.message)}</div></div>`; }
}

// ======================================================================
// DOWNLOADS
// ======================================================================
function renderDownloads() {
  const v = $('#view-downloads');
  const d = S.downloads;
  const active = d.filter(x => x.state === 'downloading').length;
  $('#dlCount').hidden = !active; $('#dlCount').textContent = active;
  if (S.view !== 'downloads') return;
  v.innerHTML = `<div class="page-head"><div><h1>Downloads</h1><div class="sub">${active ? `${active} downloading` : 'Nothing downloading right now'}</div></div><div style="flex:1"></div><button class="btn" id="dlClear" ${d.length ? '' : 'disabled'}>Clear finished</button></div>
    <div class="scroll" style="padding:0 28px 28px">${d.length ? d.map(x => {
      const pct = x.total ? Math.round(x.received / x.total * 100) : null;
      return `<div class="dl"><div class="ri ${x.state === 'done' ? 'ok' : x.state === 'error' ? 'crashed' : x.state === 'manual' ? 'closed-with-errors' : 'running'}" style="width:34px;height:34px;border-radius:9px;display:grid;place-items:center">${x.state === 'done' ? I.check : x.state === 'error' ? I.x : I.dl}</div>
        <div class="grow"><b>${esc(x.name)}</b><div class="muted" style="font-size:12.5px">${x.state === 'downloading' ? `${fmtBytes(x.received)}${x.total ? ' of ' + fmtBytes(x.total) : ''}` : x.state === 'done' ? `Done · ${fmtBytes(x.received)}` : x.state === 'manual' ? esc(x.error || 'Needs a manual download') : 'Failed: ' + esc(x.error || '')}</div>
        ${x.state === 'downloading' ? `<div class="progress"><i style="width:${pct ?? 30}%"></i></div>` : ''}</div>${pct != null && x.state === 'downloading' ? `<b>${pct}%</b>` : ''}</div>`;
    }).join('') : `<div class="placeholder"><div>${I.dl.replace('<svg', '<svg width="54" height="54"')}<b>No downloads yet</b>Mods you install show up here while they download.</div></div>`}</div>`;
  if ($('#dlClear')) $('#dlClear').onclick = async () => { S.downloads = await call('downloads:clear'); renderDownloads(); };
}

// ======================================================================
// SETTINGS
// ======================================================================
const ACCENTS = ['#7c5cff', '#3e8ef7', '#12b5a6', '#2fb16a', '#f07a2a', '#e5487f', '#e5484d', '#d4a514'];
function renderSettings() {
  const st = S.settings;
  const v = $('#view-settings');
  const top = $('#setScroll') ? $('#setScroll').scrollTop : 0;
  const row = (title, help, control) => `<div class="srow"><div class="sl"><b>${title}</b>${help ? `<span>${help}</span>` : ''}</div>${control}</div>`;
  const sw = (key, on) => `<label class="switch"><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}><i></i></label>`;
  v.innerHTML = `<div class="page-head"><div><h1>Settings</h1><div class="sub">Saved in ${esc(S.info.dataRoot)}</div></div></div>
  <div class="scroll" id="setScroll"><div class="settings">
    <div class="sgroup"><h2>Appearance</h2>
      ${row('Theme', 'Text stays readable in both modes.', `<div class="seg" id="sTheme">${[['dark', 'Dark'], ['light', 'Light'], ['system', 'Match Windows']].map(([k, l]) => `<button data-k="${k}" class="${st.theme === k ? 'on' : ''}">${l}</button>`).join('')}</div>`)}
      ${row('Accent colour', '', `<div class="swatches" id="sAcc">${ACCENTS.map(c => `<button class="swatch ${st.accent === c ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`)}
      ${row('List density', 'Compact fits more mods on screen.', `<div class="seg" id="sDen">${[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([k, l]) => `<button data-k="${k}" class="${st.density === k ? 'on' : ''}">${l}</button>`).join('')}</div>`)}
    </div>
    <div class="sgroup"><h2>Mod sites</h2><div class="shelp">Only official APIs are used. Thunderstore, Modrinth, GameBanana and Nexus browsing work straight away. CurseForge needs your own free key, and Nexus needs one to download.</div>
      ${S.info.sources.map(s => row(`<span class="row"><i class="dot" style="background:${attr(s.color)}"></i>${esc(s.name)} <a href="${attr(s.site)}" style="font-weight:400;font-size:12.5px">${esc(s.site.replace(/^https?:\/\//, ''))}</a></span>`,
        s.needsKey ? `${s.keylessBrowse ? 'Browsing works without a key. ' : ''}${esc(s.keyHelp)}<div class="keyrow" style="margin-top:8px"><input class="input" type="password" data-key="${s.id}" value="${attr(st.keys[s.id] || '')}" placeholder="Paste API key" spellcheck="false"><button class="btn sm" data-test="${s.id}">Test</button></div>` : 'No key needed.',
        `<label class="switch"><input type="checkbox" data-src="${s.id}" ${st.sources[s.id] !== false ? 'checked' : ''}><i></i></label>`)).join('')}
    </div>
    <div class="sgroup"><h2>Updates</h2>
      ${row('Update mods automatically', 'New versions download in the background. Mods you pinned to a version are left alone.', sw('autoUpdate', st.autoUpdate))}
      ${row('Check when ModHaven starts', '', sw('checkUpdatesOnStart', st.checkUpdatesOnStart))}
      ${row('Check every', '', `<select class="input" data-set="updateIntervalMin">${[15, 30, 60, 180, 360, 1440].map(m => `<option value="${m}" ${Number(st.updateIntervalMin) === m ? 'selected' : ''}>${m < 60 ? m + ' minutes' : m / 60 + ' hour' + (m > 60 ? 's' : '')}</option>`).join('')}</select>`)}
      ${row('Old versions to keep', 'For rolling back a bad update without downloading again.', `<select class="input" data-set="keepOldVersions">${[1, 2, 3, 5, 10].map(n => `<option ${Number(st.keepOldVersions) === n ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}
      <div class="srow"><div class="sl"><b>Check all games now</b></div><button class="btn" id="sCheckAll">${I.refresh}Check now</button></div>
    </div>
    <div class="sgroup"><h2>Browsing</h2>
      ${row('Show adult (18+) mods', '', sw('showNsfw', st.showNsfw))}
      ${row('Hide deprecated mods', 'Mods their authors marked as abandoned.', sw('hideDeprecated', st.hideDeprecated))}
      ${row('Mods per page', '', `<select class="input" data-set="pageSize">${[20, 40, 60, 100].map(n => `<option ${Number(st.pageSize) === n ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}
    </div>
    <div class="sgroup"><h2>Installing</h2>
      ${row('How files go into the game folder', 'Hard links are instant and use no extra space (falls back to copying across drives). Config files are always copied.', `<select class="input" data-set="deployMode"><option value="hardlink" ${st.deployMode === 'hardlink' ? 'selected' : ''}>Hard links</option><option value="copy" ${st.deployMode === 'copy' ? 'selected' : ''}>Copy files</option></select>`)}
      ${row('Handle Nexus “Mod Manager Download” buttons', 'Lets free Nexus accounts install with one click from the website.', sw('nxmHandler', st.nxmHandler))}
      ${row('7-Zip', S.info.sevenZip ? 'Found — .7z archives are supported' + '' : 'Not found. Install 7-Zip to unpack .7z and .rar mods.', S.info.sevenZip ? '<span class="pill ok">Ready</span>' : '<a class="btn sm" href="https://www.7-zip.org/">Get 7-Zip</a>')}
    </div>
    <div class="sgroup"><h2>Crash testing</h2>
      ${row('Count a test as working after', 'Used by the automatic culprit finder: if the game is still running after this long, that set of mods is OK.', `<span class="row"><input class="input" type="number" min="15" max="900" data-set="autoTestSeconds" value="${attr(st.autoTestSeconds)}" style="width:86px"> seconds</span>`)}
      ${row('Close the game after a passing test', '', sw('closeGameAfterAutoTest', st.closeGameAfterAutoTest))}
    </div>
    <div class="sgroup"><h2>About</h2>
      <div class="srow"><div class="sl"><b>ModHaven ${esc(S.info.version)}</b><span>Created by ${esc(S.info.author)} · Copyright (c) 2026 ${esc(S.info.author)}. All rights reserved.</span></div><a class="btn" href="${attr(S.info.homepage)}">${I.ext}Project page</a></div>
    </div>
    <div class="sgroup"><h2>Storage</h2>
      <div class="srow"><div class="sl"><b>Data folder</b><span class="mono">${esc(S.info.dataRoot)}</span></div><button class="btn" id="sOpenData">${I.folder}Open</button></div>
      <div class="srow"><div class="sl"><b>Clear site cache</b><span>Game lists are fetched again.</span></div><button class="btn" id="sCache">Clear</button></div>
      <div class="srow"><div class="sl"><b>Delete downloaded archives</b><span>Installed mods keep working; reinstalls download again.</span></div><button class="btn danger" id="sDl">Delete</button></div>
    </div>
  </div></div>`;
  $('#setScroll').scrollTop = top;
  const save = async patch => { S.settings = await call('settings:set', patch); applyTheme(); };
  $('#sTheme').onclick = async e => { const b = e.target.closest('[data-k]'); if (b) { await save({ theme: b.dataset.k }); renderSettings(); } };
  $('#sDen').onclick = async e => { const b = e.target.closest('[data-k]'); if (b) { await save({ density: b.dataset.k }); renderSettings(); } };
  $('#sAcc').onclick = async e => { const b = e.target.closest('[data-c]'); if (b) { await save({ accent: b.dataset.c }); renderSettings(); } };
  v.onchange = async e => {
    const t = e.target;
    if (t.dataset.set) await save({ [t.dataset.set]: t.type === 'checkbox' ? t.checked : t.type === 'number' || /^\d+$/.test(t.value) ? Number(t.value) : t.value });
    if (t.dataset.src) { await save({ sources: { [t.dataset.src]: t.checked } }); S.catalog = null; }
    if (t.dataset.key) { await save({ keys: { [t.dataset.key]: t.value.trim() } }); S.catalog = null; }
  };
  v.onclick = async e => {
    const tb = e.target.closest('[data-test]');
    if (tb) {
      const inp = $(`[data-key="${tb.dataset.test}"]`, v);
      await save({ keys: { [tb.dataset.test]: inp.value.trim() } });
      tb.disabled = true; tb.textContent = 'Testing…';
      try { const r = await call('keys:test', tb.dataset.test); toast(`${esc(srcMeta(tb.dataset.test).name)} key works — ${fmtNum(r.games)} games.`, 'ok'); S.catalog = null; }
      catch (err) { toast(`${esc(srcMeta(tb.dataset.test).name)}: ${esc(err.message)}`, 'error', 9000); }
      tb.disabled = false; tb.textContent = 'Test';
    }
    if (e.target.closest('#sOpenData')) call('shell:dataFolder');
    if (e.target.closest('#sCache')) { await call('cache:clear'); S.catalog = null; toast('Cache cleared.', 'ok'); }
    if (e.target.closest('#sDl')) { if (await confirmBox('Delete downloaded archives?', 'Installed mods keep working. Reinstalling or switching versions will download again.', 'Delete', true)) { await call('downloads:clearFiles'); toast('Downloads deleted.', 'ok'); } }
    if (e.target.closest('#sCheckAll')) { const b = $('#sCheckAll'); b.disabled = true; b.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span>Checking…'; try { const r = await call('mods:checkAll'); const up = r.flatMap(x => x.updated); const av = r.reduce((n, x) => n + x.available.length, 0); toast(up.length ? `Updated ${up.length} mods.` : av ? `${av} updates available.` : 'Everything is up to date.', 'ok'); } catch (err) { fail(err); } b.disabled = false; b.innerHTML = `${I.refresh}Check now`; }
  };
}

// ======================================================================
// EVENTS FROM MAIN
// ======================================================================
window.mh.on('downloads', d => { S.downloads = d; renderDownloads(); });
window.mh.on('run', async ({ key, status, run }) => {
  S.running[key] = status.running ? status : null;
  renderSidebar();
  if (S.game && S.game.key === key) {
    renderHeroActions();
    if (!status.running && !run.search) {
      if (['crashed', 'failed-to-start'].includes(run.outcome)) toast(`<b>${esc(S.game.name)} ${run.outcome === 'crashed' ? 'crashed' : "didn't start"}</b>${run.culprits[0] ? ` — most likely ${esc(nameFor(run.culprits[0].uid))}` : ''}. <a href="#" data-run="${attr(run.id)}">See why</a>`, 'error', 12000);
      else if (run.outcome === 'ok' || run.outcome === 'closed-with-errors') toast(`${esc(S.game.name)} closed normally after ${fmtDur(run.durationSec || 0)}. Mods that were on are now marked as working.`, 'ok');
    }
    await reloadProfile();
  } else if (!status.running && ['crashed', 'failed-to-start'].includes(run.outcome)) toast('A game crashed — open it to see why.', 'error');
});
window.mh.on('search', ({ key, state }) => {
  if (S.game && S.game.key === key) { S.search = state; if (S.tab === 'crash' && S.runSel === 'overview') renderOverview($('#ccRight')); }
  if (state.state === 'done' && state.result) toast(`Culprit search: ${esc(state.result.text)}`, ['single', 'pair'].includes(state.result.kind) ? 'warn' : 'info', 15000);
});
window.mh.on('profile', ({ key, profile }) => { if (S.game && S.game.key === key && S.profileName === profile) reloadProfile(); });
window.mh.on('updates', u => {
  if (u.state === 'checking') $('#titleStatus').innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px"></span>Checking for mod updates…';
  else {
    $('#titleStatus').innerHTML = u.state === 'done' ? `Updates checked ${esc(new Date(u.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}` : '';
    if (u.updated && u.updated.length) toast(`Auto-updated ${u.updated.length} mod${u.updated.length === 1 ? '' : 's'}:<br>${u.updated.slice(0, 8).map(esc).join('<br>')}`, 'ok', 10000);
    if (S.game) reloadProfile();
  }
});
window.mh.on('external', p => {
  const el = $('#extProg');
  if (el && S.game && p.key === S.game.key) el.innerHTML = `<div class="row"><span class="spinner"></span><span>Looking up ${p.done} of ${p.total} on the mod sites${p.label ? ' — ' + esc(p.label) : ''}…</span></div><div class="progress" style="margin-top:8px"><i style="width:${p.total ? Math.round(p.done / p.total * 100) : 5}%"></i></div>`;
});
window.mh.on('notice', n => toast(esc(n.text), n.kind === 'error' ? 'error' : n.kind === 'ok' ? 'ok' : 'info', 8000));
window.mh.on('theme', () => applyTheme());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.theme === 'system') applyTheme(); });

// Drag mod files onto the window to install them into the open profile.
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e) || S.view !== 'game') return; dragDepth++; document.body.classList.add('dropping'); });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dropping'); });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
  if (S.view !== 'game' || !S.game) return toast('Open a game first, then drop mod files onto it.', 'warn');
  const paths = [...e.dataTransfer.files].map(f => window.mh.pathOf(f)).filter(Boolean);
  if (paths.length) installLocal(paths);
});
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    const inp = S.view === 'games' ? $('#gQ') : S.view === 'game' ? (S.tab === 'browse' ? $('#bQ') : S.tab === 'installed' ? $('#iQ') : null) : null;
    if (inp) { e.preventDefault(); inp.focus(); inp.select(); }
  }
});

// ---------- start ----------
(async function boot() {
  document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="halfYG" x1="0" y1="0" x2="1" y2="0"><stop offset="0.5" stop-color="var(--yellow)"/><stop offset="0.5" stop-color="var(--green)"/></linearGradient></defs></svg>`);
  [S.info, S.settings, S.managed, S.downloads] = await Promise.all([call('app:info'), call('settings:get'), call('games:managed'), call('downloads:list')]);
  applyTheme();
  renderSidebar();
  showView('games');
  if (S.settings.lastGame && S.managed.some(g => g.key === S.settings.lastGame) && !window.__noAutoOpen) {
    const g = S.managed.find(x => x.key === S.settings.lastGame);
    if (g.skipPicker && g.activeProfile) enterGame(g, g.activeProfile);
  }
})().catch(e => { document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:0;left:0;color:red">${esc(e.stack)}</pre>`); });
