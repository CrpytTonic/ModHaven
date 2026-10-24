// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Merges the game lists of every source into one catalog, matched by name / Steam id,
// and marks the ones installed on this PC.
const store = require('./store');
const local = require('./localgames');

const NUMERALS = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
function normName(name) {
  return String(name || '').toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[:\-–—_.,!'’"()\[\]]/g, ' ')
    .split(/\s+/).filter(Boolean)
    .filter((w, i) => !(i === 0 && w === 'the'))
    .map(w => NUMERALS[w] || w)
    .join('');
}

const CATALOG_TTL = 12 * 3600e3;
const CATALOG_VER = 3; // bump when the saved game-list format changes

// sources: adapter array; ctx factory gives each adapter its ctx.
async function build(sources, ctxFor, { force = false } = {}) {
  const file = store.root('cache', 'catalog.json');
  const cached = store.readJson(file, null);
  const settings = store.settings();
  const enabled = sources.filter(s => settings.sources[s.id] !== false && (!s.needsKey || s.keylessBrowse || settings.keys[s.id]));
  const enabledIds = `v${CATALOG_VER}:` + enabled.map(s => s.id).sort().join(',');
  let perSource = {};
  const errors = {};
  const live = enabled.filter(s => s.noStore);
  const fetchLive = s => s.listGames(ctxFor(s)).then(l => { perSource[s.id] = l; }).catch(e => { errors[s.id] = e.message; store.log('listGames failed', s.id, e); });
  if (cached && !force && Date.now() - cached.t < CATALOG_TTL && cached.enabledIds === enabledIds) {
    perSource = { ...cached.perSource };
    await Promise.all(live.map(fetchLive));
  } else {
    await Promise.all(enabled.map(async s => {
      try { perSource[s.id] = await s.listGames(ctxFor(s)); }
      catch (e) {
        errors[s.id] = e.message;
        store.log('listGames failed', s.id, e);
        if (!s.noStore && cached && cached.perSource && cached.perSource[s.id]) perSource[s.id] = cached.perSource[s.id];
      }
    }));
    const keep = Object.fromEntries(Object.entries(perSource).filter(([id]) => !live.some(s => s.id === id)));
    store.writeJson(file, { t: Date.now(), enabledIds, perSource: keep });
  }
  const installed = await local.scan();
  return { games: merge({ ...perSource }, installed), errors };
}

function merge(perSource, installed) {
  const byKey = new Map();
  const bySteam = new Map();
  const add = (sourceId, g) => {
    const key = normName(g.name);
    if (!key) return;
    let entry = (g.steamAppId && bySteam.get(String(g.steamAppId))) || byKey.get(key);
    if (!entry) {
      entry = { key, name: g.name, image: g.image || null, sources: {}, urls: {}, modCounts: {}, art: [], steamAppId: g.steamAppId ? String(g.steamAppId) : null, installed: null };
      byKey.set(key, entry);
    }
    if (entry.sources[sourceId]) return; // duplicate name on one site: keep the first (usually the main one)
    entry.sources[sourceId] = String(g.sourceGameId);
    entry.urls[sourceId] = g.url || null;
    if (g.modCount != null) entry.modCounts[sourceId] = g.modCount;
    for (const im of g.images || (g.image ? [{ url: g.image, kind: 'any' }] : [])) entry.art.push({ ...im, source: sourceId });
    if (!entry.image && g.image) entry.image = g.image;
    if (g.steamAppId && !entry.steamAppId) entry.steamAppId = String(g.steamAppId);
    if (entry.steamAppId) bySteam.set(entry.steamAppId, entry);
  };
  // Sites with tidy names first so the display name comes from them.
  for (const id of ['curseforge', 'nexus', 'thunderstore', 'modrinth', 'gamebanana', ...Object.keys(perSource)]) {
    for (const g of perSource[id] || []) add(id, g);
    delete perSource[id];
  }
  for (const g of installed) {
    const key = normName(g.name);
    let entry = (g.steamAppId && bySteam.get(String(g.steamAppId))) || byKey.get(key);
    if (!entry) {
      entry = { key, name: g.name, image: null, sources: {}, urls: {}, modCounts: {}, art: [], steamAppId: g.steamAppId || null, installed: null };
      byKey.set(key, entry);
    }
    entry.installed = g;
    if (g.steamAppId && !entry.steamAppId) { entry.steamAppId = String(g.steamAppId); bySteam.set(entry.steamAppId, entry); }
    for (const im of g.art || []) entry.art.push({ ...im, source: 'local' });
  }
  for (const e of byKey.values()) {
    e.images = rankArt(e);
    e.image = e.images[0] ? e.images[0].url : null;
    delete e.art;
    e.totalMods = Object.values(e.modCounts).reduce((a, b) => a + (Number(b) || 0), 0);
  }
  return [...byKey.values()].sort((a, b) => (!!b.installed - !!a.installed) || a.name.localeCompare(b.name));
}

// Best artwork first: tall box art suits the game cards, then wide banners, then small icons.
const KIND_RANK = { portrait: 0, any: 1, wide: 2, icon: 3 };
const SOURCE_RANK = { local: -1, steam: 0, nexus: 1, thunderstore: 2, curseforge: 3, modrinth: 4, gamebanana: 5 };
function rankArt(e) {
  const art = [...e.art];
  if (e.steamAppId) {
    art.push({ url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${e.steamAppId}/library_600x900.jpg`, kind: 'portrait', source: 'steam' });
    art.push({ url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${e.steamAppId}/header.jpg`, kind: 'wide', source: 'steam' });
  }
  // Sort first, then drop repeats, so a url listed twice keeps its best kind / source.
  const seen = new Set();
  return art.filter(a => a.url && /^(https?|file):/i.test(a.url))
    .sort((a, b) => (KIND_RANK[a.kind] ?? 1) - (KIND_RANK[b.kind] ?? 1) || (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9))
    .filter(a => { const k = a.url.replace(/^http:/i, 'https:'); return !seen.has(k) && seen.add(k); })
    .map(({ url, kind }) => ({ url, kind: KIND_RANK[kind] == null ? 'any' : kind }));
}

module.exports = { build, normName, merge };
