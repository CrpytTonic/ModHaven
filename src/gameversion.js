// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Public game versions ("1.0.1.2") from Steam patch notes, and which game version a mod was made for.
const net = require('./net');
const store = require('./store');

const VER = /\b(?:v(?:er(?:sion)?)?\.?\s*)?(\d{1,3}\.\d{1,3}(?:\.\d{1,4}){0,2})\b/gi;
const cmp = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
};

// [{ version, date }] newest first, from the game's Steam announcements.
async function steamVersions(appid) {
  if (!appid) return [];
  try {
    const j = await net.fetchJson(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=100&maxlength=400&feeds=steam_community_announcements`, { ttl: 6 * 3600e3, retries: 1 });
    const out = new Map();
    for (const n of (j.appnews && j.appnews.newsitems) || []) {
      const date = new Date(n.date * 1000).toISOString();
      // Titles are reliable ("1.0.1.2 is now live!"); the body only for "patch notes / update" posts.
      const texts = [n.title, /patch|update|hotfix|live/i.test(n.title) ? n.contents : ''];
      for (const t of texts) for (const m of String(t || '').matchAll(VER)) {
        const v = m[1];
        if (/^(19|20)\d\d\./.test(v) || v.split('.').length < 2) continue; // dates, not versions
        if (t !== n.title && v.split('.').length < 3) continue; // short numbers in body text are too often not versions
        if (!out.has(v) || out.get(v) > date) out.set(v, date); // first time it was mentioned
      }
    }
    // Keep versions that look like this game's scheme (same major as most of them)
    const list = [...out].map(([version, date]) => ({ version, date })).sort((a, b) => b.date.localeCompare(a.date) || cmp(b.version, a.version));
    return list;
  } catch (e) { store.log('steam versions', appid, e.message); return []; }
}

// The public version that was current at a given time (newest patch announced on or before it).
function versionAt(list, iso, slackDays = 1) {
  if (!list || !list.length || !iso) return null;
  const t = Date.parse(iso) + slackDays * 864e5;
  const before = list.filter(v => Date.parse(v.date) <= t);
  if (!before.length) return null;
  // Several versions in the same post: take the highest one from the newest post.
  const newest = before[0].date.slice(0, 10);
  return before.filter(v => v.date.slice(0, 10) === newest).sort((a, b) => cmp(b.version, a.version))[0];
}

// "Made for game version" text on a mod page: description, file names, file descriptions, changelogs.
function statedGameVersion(texts, known, ownVersions = []) {
  const own = new Set(ownVersions.filter(Boolean).map(v => String(v).replace(/^v/i, '')));
  const text = texts.filter(Boolean).map(t => String(t).replace(/<[^>]+>/g, ' ').replace(/\[[^\]]+\]/g, ' ')).join('\n');
  const found = [];
  const near = /(game|patch|update|build|works?|compatible|tested|verified|supports?|for|dragonwilds|release)/i;
  for (const m of text.matchAll(VER)) {
    const v = m[1];
    if (own.has(v)) continue; // the mod's own version, not the game's
    const ctx = text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 25);
    const knownHit = known && known.some(k => k.version === v);
    if (knownHit || near.test(ctx)) found.push({ v, known: !!knownHit, ctx: ctx.replace(/\s+/g, ' ').trim() });
  }
  if (!found.length) return null;
  // Prefer versions that really exist for this game; then the highest.
  const pool = found.some(f => f.known) ? found.filter(f => f.known) : found;
  pool.sort((a, b) => cmp(b.v, a.v));
  return { version: pool[0].v, quote: pool[0].ctx.slice(0, 120) };
}

module.exports = { steamVersions, versionAt, statedGameVersion, cmp };
