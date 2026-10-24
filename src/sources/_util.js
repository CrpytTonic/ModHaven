// Shared helpers for source adapters. Not an adapter (index.js does not list it).

// Display name cleanup: strip trademark symbols and collapse whitespace.
function cleanName(name) {
  return String(name || '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
}

// Cross-site merge key for a game: lowercase ascii, '&' -> 'and', apostrophes dropped,
// everything else non-alphanumeric -> '-'. "Baldur's Gate 3" -> "baldurs-gate-3".
function gameSlug(name) {
  return cleanName(name)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Anything date-like -> ISO string (or null). Numbers < 1e12 are treated as unix seconds.
function iso(v) {
  if (v === null || v === undefined || v === '' || v === 0) return null;
  let d;
  if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v);
  else if (/^\d+$/.test(String(v))) { const n = Number(v); d = new Date(n < 1e12 ? n * 1000 : n); }
  else d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function num(v, dflt = 0) {
  if (v === null || v === undefined || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function str(v) { return v === null || v === undefined ? null : String(v); }

function noKey(siteName, help) {
  const e = new Error(`${siteName} needs an API key. ${help || ''}`.trim());
  e.code = 'NO_KEY';
  return e;
}

// Run fn over items with at most n in flight; returns results in order.
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.append(k, String(v));
  }
  return p.toString();
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(u) {
  // u is already HTML-escaped text; undo &amp; for the check only.
  const raw = String(u || '').trim().replace(/&amp;/g, '&');
  if (!/^https?:\/\//i.test(raw)) return null;
  return escapeHtml(raw);
}

// BBCode (Nexus flavour, which also mixes in literal <br />) -> small safe HTML subset.
function bbcodeToHtml(src) {
  if (!src) return '';
  let s = String(src).replace(/\r\n?/g, '\n').replace(/<br\s*\/?>\s*\n?/gi, '\n');
  // Nexus sometimes stores a few raw html entities; decode the common ones before escaping.
  s = s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  s = s.replace(/\[(\w+)=["']([^\]"']*)["']\]/g, '[$1=$2]'); // [size="5"] -> [size=5]
  s = escapeHtml(s);

  const sizes = { 1: '0.75em', 2: '0.875em', 3: '1em', 4: '1.2em', 5: '1.5em', 6: '1.8em', 7: '2.2em' };
  const rules = [
    [/\[(b|i|u|s)\]([\s\S]*?)\[\/\1\]/gi, (m, t, x) => `<${t.toLowerCase()}>${x}</${t.toLowerCase()}>`],
    [/\[strike\]([\s\S]*?)\[\/strike\]/gi, (m, x) => `<s>${x}</s>`],
    [/\[url=([^\]]*?)\]([\s\S]*?)\[\/url\]/gi, (m, u, x) => { const h = safeUrl(u); return h ? `<a href="${h}">${x}</a>` : x; }],
    [/\[url\]([\s\S]*?)\[\/url\]/gi, (m, u) => { const h = safeUrl(u); return h ? `<a href="${h}">${u}</a>` : u; }],
    [/\[img(?:=[^\]]*|\s+[^\]]*)?\]([\s\S]*?)\[\/img\]/gi, (m, u) => { const h = safeUrl(u); return h ? `<img src="${h}" alt="">` : ''; }],
    [/\[size=(\d+)(?:px|pt)?\]([\s\S]*?)\[\/size\]/gi, (m, n, x) => { const k = Number(n); const v = sizes[k] || (k > 7 ? Math.min(k, 40) + 'px' : '1em'); return `<span style="font-size:${v}">${x}</span>`; }],
    [/\[colou?r=(#[0-9a-f]{3,8}|[a-z]{3,20})\]([\s\S]*?)\[\/colou?r\]/gi, (m, c, x) => `<span style="color:${c}">${x}</span>`],
    [/\[font=[^\]]*\]([\s\S]*?)\[\/font\]/gi, (m, x) => x],
    [/\[(center|left|right|justify)\]([\s\S]*?)\[\/\1\]/gi, (m, a, x) => `<div style="text-align:${a.toLowerCase()}">${x}</div>`],
    [/\[quote(?:=[^\]]*)?\]([\s\S]*?)\[\/quote\]/gi, (m, x) => `<blockquote>${x}</blockquote>`],
    [/\[code\]([\s\S]*?)\[\/code\]/gi, (m, x) => `<pre><code>${x}</code></pre>`],
    [/\[spoiler(?:=([^\]]*))?\]([\s\S]*?)\[\/spoiler\]/gi, (m, t, x) => `<details><summary>${t || 'Spoiler'}</summary>${x}</details>`],
    [/\[heading\]([\s\S]*?)\[\/heading\]/gi, (m, x) => `<h3>${x}</h3>`],
    [/\[youtube\]\s*([\w-]{6,20})\s*\[\/youtube\]/gi, (m, id) => `<a href="https://www.youtube.com/watch?v=${id}"><img src="https://img.youtube.com/vi/${id}/hqdefault.jpg" alt="YouTube video"></a>`],
    [/\[list(=1|=a|=i)?\]([\s\S]*?)\[\/list\]/gi, (m, o, x) => {
      const items = x.split(/\[\*\]/).slice(1).map(t => `<li>${t.trim().replace(/\n+$/, '')}</li>`).join('');
      const tag = o ? 'ol' : 'ul';
      return `<${tag}>${items || x}</${tag}>`;
    }],
  ];
  for (let pass = 0; pass < 8; pass++) {
    const before = s;
    for (const [re, fn] of rules) s = s.replace(re, fn);
    if (s === before) break;
  }
  s = s.replace(/\[(?:line|hr)\]/gi, '<hr>');
  s = s.replace(/\n/g, '<br>');
  // Tidy breaks right after block elements.
  s = s.replace(/(<\/(?:div|blockquote|pre|ul|ol|li|h3|details)>|<hr>)<br>/g, '$1');
  return s;
}

// First image URLs found in markdown or html (skips badges).
function extractImages(text, max = 8) {
  const out = [];
  const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)[^)]*\)|<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(text || ''))) && out.length < max) {
    const u = m[1] || m[2];
    if (/shields\.io|badge|img\.youtube\.com/i.test(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

module.exports = { cleanName, gameSlug, iso, num, str, noKey, mapLimit, qs, escapeHtml, bbcodeToHtml, extractImages };
