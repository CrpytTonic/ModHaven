// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
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


// YouTube video id from a bare id or any YouTube URL (watch?v=, youtu.be/, embed/, shorts/).
function youtubeId(s) {
  s = String(s || '').trim().replace(/&amp;/g, '&');
  if (/^[\w-]{6,20}$/.test(s)) return s;
  const m = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/v\/)([\w-]{6,20})/i.exec(s);
  return m ? m[1] : null;
}

const BB_SIZES = { 1: '0.75em', 2: '0.875em', 3: '1em', 4: '1.2em', 5: '1.5em', 6: '1.8em', 7: '2.2em' };
const BB_KNOWN = 'b|i|u|s|sup|sub|strike|colou?r|size|font|center|left|right|justify|quote|spoiler|heading|list|url|img|youtube|email|indent';

// BBCode (Nexus flavour, which also mixes in literal <br />) -> small safe HTML subset.
// Styling is emitted twice: as a class (bb-size-1..7, bb-size-px, bb-color, bb-align-center|left|right|justify,
// bb-indent, bb-youtube, bb-spoiler) and as an inline style, so the UI can keep either one through its sanitizer.
// Nested tags are matched innermost-first; tags the author left unclosed are dropped instead of shown.
function bbcodeToHtml(src) {
  if (!src) return '';
  let s = String(src).replace(/\r\n?/g, '\n').replace(/<br\s*\/?>\s*\n?/gi, '\n');
  // Nexus stores a few raw html entities; decode them before escaping.
  s = s.replace(/&#(\d{1,6});/g, (m, n) => { const c = Number(n); return c > 31 && c < 0x110000 ? String.fromCodePoint(c) : ''; })
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  // [code] content is shown verbatim: park it before any other rule runs.
  const codes = [];
  s = s.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (m, x) => { codes.push(x.replace(/^\n+|\n+$/g, '')); return `\u0001${codes.length - 1}\u0001`; });
  s = s.replace(/\[(\w+)=["']([^\]"']*)["']\]/g, '[$1=$2]'); // [size="5"] -> [size=5]
  s = escapeHtml(s);

  // body that contains no further opening tag of the given names -> innermost match first
  const inner = names => `((?:(?!\\[(?:${names})[=\\]\\s])[\\s\\S])*?)`;
  const R = (open, names, close) => new RegExp(open + inner(names) + close, 'gi');
  const rules = [
    [/\[(b|i|u|s|sup|sub)\]((?:(?!\[\1\])[\s\S])*?)\[\/\1\]/gi, (m, t, x) => `<${t.toLowerCase()}>${x}</${t.toLowerCase()}>`],
    [R('\\[strike\\]', 'strike', '\\[\\/strike\\]'), (m, x) => `<s>${x}</s>`],
    [/\[img(?:=[^\]]*|\s+[^\]]*)?\]\s*([^[\]]*?)\s*\[\/img\]/gi, (m, u) => { const h = safeUrl(u); return h ? `<img src="${h}" alt="" loading="lazy">` : ''; }],
    [R('\\[url=([^\\]]*?)\\]', 'url', '\\[\\/url\\]'), (m, u, x) => { const h = safeUrl(u); return h ? `<a href="${h}">${x || h}</a>` : x; }],
    [/\[url\]\s*([^[\]]*?)\s*\[\/url\]/gi, (m, u) => { const h = safeUrl(u); return h ? `<a href="${h}">${u}</a>` : u; }],
    [/\[email(?:=([^\]]*))?\]([^[\]]*?)\[\/email\]/gi, (m, a, x) => { const e = String(a || x).trim(); return /^[^\s@<>"&]+@[^\s@<>"&]+$/.test(e) ? `<a href="mailto:${e}">${x}</a>` : x; }],
    [/\[youtube(?:=[^\]]*)?\]\s*([^[\]]*?)\s*\[\/youtube\]/gi, (m, v) => {
      const id = youtubeId(v);
      return id ? `<a class="bb-youtube" href="https://www.youtube.com/watch?v=${id}"><img src="https://img.youtube.com/vi/${id}/hqdefault.jpg" alt="YouTube video" loading="lazy"></a>` : '';
    }],
    [R('\\[size=(\\d+)(?:px|pt)?\\]', 'size', '\\[\\/size\\]'), (m, n, x) => {
      const k = Number(n);
      if (BB_SIZES[k]) return `<span class="bb-size-${k}" style="font-size:${BB_SIZES[k]}">${x}</span>`;
      return `<span class="bb-size-px" style="font-size:${Math.max(8, Math.min(k, 40))}px">${x}</span>`;
    }],
    [R('\\[colou?r=([^\\]]{1,40})\\]', 'colou?r', '\\[\\/colou?r\\]'), (m, c, x) => {
      c = c.trim();
      return /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\(\s*[\d.,\s%]+\))$/i.test(c) ? `<span class="bb-color" style="color:${c}">${x}</span>` : x;
    }],
    [R('\\[font=[^\\]]*\\]', 'font', '\\[\\/font\\]'), (m, x) => x],
    [/\[(center|left|right|justify)\]((?:(?!\[\1\])[\s\S])*?)\[\/\1\]/gi, (m, a, x) => `<div class="bb-align-${a.toLowerCase()}" style="text-align:${a.toLowerCase()}">${x}</div>`],
    [R('\\[indent\\]', 'indent', '\\[\\/indent\\]'), (m, x) => `<div class="bb-indent" style="margin-left:2em">${x}</div>`],
    [R('\\[quote(?:=([^\\]]*))?\\]', 'quote', '\\[\\/quote\\]'), (m, who, x) => `<blockquote>${who ? `<cite>${who}</cite><br>` : ''}${x}</blockquote>`],
    [R('\\[spoiler(?:=([^\\]]*))?\\]', 'spoiler', '\\[\\/spoiler\\]'), (m, t, x) => `<details class="bb-spoiler"><summary>${t || 'Spoiler'}</summary>${x}</details>`],
    [R('\\[heading\\]', 'heading', '\\[\\/heading\\]'), (m, x) => `<h3>${x}</h3>`],
    [R('\\[list(=[^\\]]*)?\\]', 'list', '\\[\\/list\\]'), (m, o, x) => {
      const parts = x.replace(/\[\/\*\]/g, '').split(/\[\*\]/);
      const lead = parts.shift().replace(/^\s+|\s+$/g, '');
      const items = parts.map(t => `<li>${t.replace(/^\s+|\s+$/g, '')}</li>`).join('');
      const tag = o ? 'ol' : 'ul';
      const type = o && /^=[aAiI]$/.test(o) ? ` type="${o[1]}"` : '';
      return items ? `${lead ? lead + '\n' : ''}<${tag}${type}>${items}</${tag}>` : `<${tag}${type}><li>${lead}</li></${tag}>`;
    }],
  ];
  for (let pass = 0; pass < 16; pass++) {
    const before = s;
    for (const [re, fn] of rules) s = s.replace(re, fn);
    if (s === before) break;
  }
  // Whatever is left is unbalanced author markup: bullets become text, other known tags vanish.
  s = s.replace(/\[\/\*\]/g, '').replace(/\[\*\]\s*/g, '• ');
  s = s.replace(new RegExp(`\\[\\/?(?:${BB_KNOWN})(?:=[^\\]\\n]*)?\\]`, 'gi'), '');
  s = s.replace(/\[(?:line|hr)\]/gi, '<hr>');
  s = s.replace(/\n/g, '<br>');
  // Tidy breaks around block elements.
  s = s.replace(/(<\/(?:div|blockquote|pre|ul|ol|li|h3|details|summary)>|<hr>|<(?:ul|ol)[^>]*>)<br>/g, '$1');
  s = s.replace(/<br>(<\/?(?:ul|ol|li)[^>]*>)/g, '$1');
  s = s.replace(/^(?:\s|<br>)+|(?:\s|<br>)+$/g, '');
  s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => `<pre><code>${escapeHtml(codes[Number(i)])}</code></pre>`);
  return s;
}

// Images that are buttons/badges/widgets, not pictures of the mod.
const NOT_A_SHOT = /shields\.io|badgen\.net|\/badges?\/|badge\.svg|img\.youtube\.com|i\.ytimg\.com|ko-fi\.com\/img|cdn\.ko-fi\.com|storage\.ko-fi\.com\/cdn\/(?:kofi|brandasset)|buymeacoffee\.com\/(?:buttons|assets)|discordapp\.com\/api\/guilds|discord\.com\/api\/guilds|patreon\.com\/.*button|liberapay\.com\/assets|paypalobjects\.com|github\.com\/[^/]+\/[^/]+\/workflows|forthebadge\.com|visitor-badge|komarev\.com|avatars\d*\.githubusercontent\.com/i;

// Every picture embedded in markdown or html (inline ![](), reference ![][id], <img src>), in order, deduplicated,
// skipping badges/donate buttons/video thumbnails. Relative URLs are skipped.
function extractImages(text, max = 200) {
  const src = String(text || '');
  const refs = {};
  src.replace(/^\s{0,3}\[([^\]]+)\]:\s*<?(https?:\/\/[^\s>]+)>?/gim, (m, id, u) => { refs[id.toLowerCase()] = u; return m; });
  const out = [];
  const re = /!\[([^\]]*)\]\(\s*<?(https?:\/\/[^)\s>]+)>?[^)]*\)|!\[([^\]]*)\]\[([^\]]*)\]|<img\b[^>]*?\bsrc\s*=\s*(?:"(https?:\/\/[^"]+)"|'(https?:\/\/[^']+)'|(https?:\/\/[^\s>]+))/gi;
  let m;
  while ((m = re.exec(src)) && out.length < max) {
    let u = m[2] || m[5] || m[6] || m[7];
    if (!u && m[0][0] === '!') u = refs[String(m[4] || m[3] || '').toLowerCase()];
    if (!u) continue;
    u = u.replace(/&amp;/g, '&');
    if (NOT_A_SHOT.test(u)) continue;
    out.push(u);
  }
  return uniqueUrls(out);
}

// Drop empties and duplicates (same URL ignoring http/https), keep the first occurrence's order.
function uniqueUrls(list) {
  const seen = new Set();
  const out = [];
  for (const u of list || []) {
    if (!u || typeof u !== 'string' || !/^https?:\/\//i.test(u)) continue;
    const k = u.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

// [{url, title, description}] -> same, without entries whose url uniqueUrls would drop.
function uniqueGallery(list) {
  const keep = new Set(uniqueUrls((list || []).map(g => g && g.url)));
  const out = [];
  for (const g of list || []) {
    if (!g || !keep.has(g.url)) continue;
    keep.delete(g.url);
    out.push({ url: g.url, title: g.title || null, description: g.description || null });
  }
  return out;
}

module.exports = { cleanName, gameSlug, iso, num, str, noKey, mapLimit, qs, escapeHtml, bbcodeToHtml, extractImages, uniqueUrls, uniqueGallery, youtubeId };
