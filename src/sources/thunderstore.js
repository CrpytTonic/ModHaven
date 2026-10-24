// Thunderstore (thunderstore.io) — keyless.
// Listing/search: cyberstorm API (what the new site uses), 20 results per API page.
// Fallback: per-community v1 package dump, cached 15 min, filtered/sorted/paged locally.
const { cleanName, gameSlug, iso, num, mapLimit, qs, extractImages } = require('./_util');

const BASE = 'https://thunderstore.io';
const API_PAGE = 20; // cyberstorm listing page size (fixed by the server)
const ORDERING = { popular: 'top-rated', downloads: 'most-downloaded', updated: 'last-updated', newest: 'newest', name: 'most-downloaded' };
const V1_TTL = 15 * 60 * 1000;
const v1Cache = new Map(); // community -> {t, list}

function splitId(modId) {
  const s = String(modId);
  const i = s.indexOf('-');
  if (i < 1) throw new Error(`Bad Thunderstore mod id "${modId}" (want Namespace-Name)`);
  return { ns: s.slice(0, i), name: s.slice(i + 1) };
}

// "Namespace-Name-1.2.3" -> dependency object
function parseDep(str) {
  const s = String(str);
  const j = s.lastIndexOf('-');
  const full = j > 0 ? s.slice(0, j) : s;
  const ver = j > 0 ? s.slice(j + 1) : undefined;
  const k = full.indexOf('-');
  return { source: 'thunderstore', modId: full, name: k > 0 ? full.slice(k + 1) : full, versionRange: ver, required: true };
}

// Icon files are named Namespace-Name-<version>.png, which gives the latest version for free.
function versionFromIcon(iconUrl, ns, name) {
  if (!iconUrl) return null;
  const file = decodeURIComponent(String(iconUrl).split('/').pop() || '').replace(/\.(png|jpe?g|webp)$/i, '');
  const prefix = `${ns}-${name}-`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : null;
}

function pageUrl(community, ns, name) { return `${BASE}/c/${community}/p/${ns}/${name}/`; }

function fromListing(r, community) {
  const ns = r.namespace, name = r.name;
  return {
    source: 'thunderstore',
    id: `${ns}-${name}`,
    gameId: community,
    name: String(name).replace(/_/g, ' '),
    author: ns,
    summary: r.description || '',
    version: r.latest_version_number || versionFromIcon(r.icon_url, ns, name),
    updatedAt: iso(r.last_updated || r.version_created),
    createdAt: iso(r.datetime_created || r.package_created),
    downloads: num(r.download_count),
    likes: num(r.rating_count),
    icon: r.icon_url || null,
    url: pageUrl(community, ns, name),
    categories: (r.categories || []).map(c => c.name),
    nsfw: !!r.is_nsfw,
    deprecated: !!r.is_deprecated,
    gameVersions: [],
  };
}

function fromV1(p, community) {
  const latest = (p.versions || [])[0] || {};
  return {
    source: 'thunderstore',
    id: p.full_name,
    gameId: community,
    name: String(p.name).replace(/_/g, ' '),
    author: p.owner,
    summary: latest.description || '',
    version: latest.version_number || null,
    updatedAt: iso(p.date_updated),
    createdAt: iso(p.date_created),
    downloads: (p.versions || []).reduce((a, v) => a + num(v.downloads), 0),
    likes: num(p.rating_score),
    icon: latest.icon || null,
    url: pageUrl(community, p.owner, p.name),
    categories: p.categories || [],
    nsfw: !!p.has_nsfw_content,
    deprecated: !!p.is_deprecated,
    gameVersions: [],
  };
}

async function v1List(ctx, community) {
  const hit = v1Cache.get(community);
  if (hit && Date.now() - hit.t < V1_TTL) return hit.list;
  const list = await ctx.fetchJson(`${BASE}/c/${encodeURIComponent(community)}/api/v1/package/`, { ttl: V1_TTL, timeout: 120000 });
  v1Cache.set(community, { t: Date.now(), list });
  return list;
}

async function listModsV1(ctx, community, { query, sort = 'popular', page = 0, pageSize = 20, category } = {}) {
  const list = await v1List(ctx, community);
  const showNsfw = !!(ctx.settings && ctx.settings.showNsfw);
  const q = (query || '').trim().toLowerCase();
  let mods = list
    .filter(p => showNsfw || !p.has_nsfw_content)
    .filter(p => !p.is_deprecated)
    .filter(p => !category || (p.categories || []).some(c => String(c).toLowerCase() === String(category).toLowerCase()))
    .filter(p => !q || p.full_name.toLowerCase().includes(q) || ((p.versions[0] || {}).description || '').toLowerCase().includes(q))
    .map(p => fromV1(p, community));
  const cmp = {
    popular: (a, b) => b.likes - a.likes || b.downloads - a.downloads,
    downloads: (a, b) => b.downloads - a.downloads,
    updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
    newest: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
    name: (a, b) => a.name.localeCompare(b.name),
  }[sort] || ((a, b) => b.downloads - a.downloads);
  mods.sort(cmp);
  const start = page * pageSize;
  return { mods: mods.slice(start, start + pageSize), hasMore: start + pageSize < mods.length, total: mods.length };
}

async function latestDetail(ctx, community, ns, name) {
  return ctx.fetchJson(`${BASE}/api/cyberstorm/listing/${encodeURIComponent(community)}/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/`, { ttl: 10 * 60 * 1000 });
}

module.exports = {
  id: 'thunderstore',
  name: 'Thunderstore',
  color: '#1f8f6a',
  site: BASE,
  needsKey: false,
  keyHelp: 'No key needed.',

  async listGames(ctx) {
    try {
      const out = [];
      let url = `${BASE}/api/cyberstorm/community/`;
      for (let i = 0; url && i < 30; i++) {
        const j = await ctx.fetchJson(url, { ttl: 6 * 3600 * 1000 });
        for (const c of j.results || []) {
          if (c.is_listed === false) continue;
          const name = cleanName(c.name);
          out.push({
            sourceGameId: c.identifier, name, slug: gameSlug(name),
            image: c.community_icon_url || c.cover_image_url || c.icon_url || null,
            images: [
              c.cover_image_url && { url: c.cover_image_url, kind: 'portrait' },
              (c.hero_image_url || c.background_image_url) && { url: c.hero_image_url || c.background_image_url, kind: 'wide' },
              (c.community_icon_url || c.icon_url) && { url: c.community_icon_url || c.icon_url, kind: 'icon' },
            ].filter(Boolean),
            url: `${BASE}/c/${c.identifier}/`,
            modCount: num(c.total_package_count, undefined),
          });
        }
        url = j.next;
      }
      if (out.length) return out;
    } catch (e) { /* fall through to experimental API */ }
    const out = [];
    let url = `${BASE}/api/experimental/community/`;
    for (let i = 0; url && i < 60; i++) {
      const j = await ctx.fetchJson(url, { ttl: 6 * 3600 * 1000 });
      for (const c of j.results || []) {
        const name = cleanName(c.name);
        out.push({ sourceGameId: c.identifier, name, slug: gameSlug(name), image: null, url: `${BASE}/c/${c.identifier}/` });
      }
      url = j.pagination && j.pagination.next_link;
    }
    return out;
  },

  async listMods(ctx, community, opts = {}) {
    const { query, sort = 'popular', page = 0, category } = opts;
    const pageSize = Math.max(1, Math.min(100, opts.pageSize || API_PAGE));
    const showNsfw = !!(ctx.settings && ctx.settings.showNsfw);
    try {
      const start = page * pageSize, end = start + pageSize;
      const first = Math.floor(start / API_PAGE) + 1, last = Math.floor((end - 1) / API_PAGE) + 1;
      const pages = [];
      for (let p = first; p <= last; p++) pages.push(p);
      const results = await mapLimit(pages, 3, p => ctx.fetchJson(`${BASE}/api/cyberstorm/listing/${encodeURIComponent(community)}/?` + qs({
        q: query && query.trim(), ordering: ORDERING[sort] || 'top-rated', page: p,
        included_categories: category, nsfw: showNsfw ? 'true' : undefined,
      }), { ttl: 2 * 60 * 1000 }).catch(e => { if (e.status === 404 && p > 1) return { results: [], count: 0 }; throw e; }));
      const all = results.flatMap(r => r.results || []);
      const offset = start - (first - 1) * API_PAGE;
      let mods = all.slice(offset, offset + pageSize).map(r => fromListing(r, community));
      if (sort === 'name') mods.sort((a, b) => a.name.localeCompare(b.name)); // API has no name ordering
      const total = num(results[0] && results[0].count);
      return { mods, hasMore: end < total, total };
    } catch (e) {
      // Cyberstorm unavailable: fall back to the v1 dump (categories there are names, not ids).
      let cat = category;
      if (cat && /^d+$/.test(String(cat))) {
        try { cat = ((await module.exports.categories(ctx, community)).find(c => c.id === String(cat)) || {}).name || cat; } catch (e2) { /* keep id */ }
      }
      return listModsV1(ctx, community, { ...opts, category: cat, pageSize });
    }
  },

  async getMod(ctx, community, modId) {
    const { ns, name } = splitId(modId);
    let mod, readme = null;
    try {
      const d = await latestDetail(ctx, community, ns, name);
      mod = fromListing({ ...d, last_updated: d.version_created, datetime_created: d.package_created }, community);
      mod.websiteUrl = d.website_url || null;
    } catch (e) {
      const p = await ctx.fetchJson(`${BASE}/api/experimental/package/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/`, { ttl: 10 * 60 * 1000 });
      const l = p.latest || {};
      const listing = (p.community_listings || []).find(c => c.community === community) || (p.community_listings || [])[0] || {};
      mod = {
        source: 'thunderstore', id: `${ns}-${name}`, gameId: community, name: String(name).replace(/_/g, ' '), author: p.owner,
        summary: l.description || '', version: l.version_number || null, updatedAt: iso(p.date_updated), createdAt: iso(p.date_created),
        downloads: num(p.total_downloads > 0 ? p.total_downloads : l.downloads), likes: num(p.rating_score > 0 ? p.rating_score : 0),
        icon: l.icon || null, url: pageUrl(community, ns, name), categories: listing.categories || [],
        nsfw: !!listing.has_nsfw_content, deprecated: !!p.is_deprecated, gameVersions: [], websiteUrl: l.website_url || null,
      };
    }
    try {
      const r = await ctx.fetchJson(`${BASE}/api/experimental/package/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/${encodeURIComponent(mod.version)}/readme/`, { ttl: 30 * 60 * 1000 });
      readme = r.markdown || null;
    } catch (e) { /* no readme */ }
    return { ...mod, description: readme || mod.summary || '', descriptionFormat: readme ? 'markdown' : 'text', screenshots: extractImages(readme) };
  },

  async getVersions(ctx, community, modId) {
    const { ns, name } = splitId(modId);
    // Use the v1 dump when we already have it (full dependency lists + sizes for every version).
    const hit = v1Cache.get(community);
    if (hit && Date.now() - hit.t < V1_TTL) {
      const p = hit.list.find(x => x.full_name === `${ns}-${name}`);
      if (p) return p.versions.map(v => ({
        id: v.version_number, version: v.version_number, date: iso(v.date_created), gameVersions: [], loaders: [],
        fileName: `${v.full_name}.zip`, size: v.file_size != null ? num(v.file_size) : null, downloadUrl: v.download_url,
        changelog: null, dependencies: (v.dependencies || []).map(parseDep),
      }));
    }
    const list = await ctx.fetchJson(`${BASE}/api/cyberstorm/package/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/versions/`, { ttl: 5 * 60 * 1000 });
    list.sort((a, b) => String(b.datetime_created).localeCompare(String(a.datetime_created)));
    let latestSize = null;
    try { latestSize = num((await latestDetail(ctx, community, ns, name)).size, null); } catch (e) { /* optional */ }
    // Dependencies need one call per version; do the newest ones, mark the rest as unknown.
    const DEP_LIMIT = 10;
    const deps = await mapLimit(list.slice(0, DEP_LIMIT), 5, v =>
      ctx.fetchJson(`${BASE}/api/experimental/package/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/${encodeURIComponent(v.version_number)}/`, { ttl: 60 * 60 * 1000 })
        .then(d => (d.dependencies || []).map(parseDep)).catch(() => null));
    return list.map((v, i) => ({
      id: v.version_number,
      version: v.version_number,
      date: iso(v.datetime_created),
      gameVersions: [],
      loaders: [],
      fileName: `${ns}-${name}-${v.version_number}.zip`,
      size: i === 0 ? latestSize : null,
      downloadUrl: v.download_url || `${BASE}/package/download/${ns}/${name}/${v.version_number}/`,
      changelog: null,
      dependencies: deps[i] || [],
      ...(deps[i] ? {} : { dependenciesKnown: false }),
    }));
  },

  async resolveDownload(ctx, community, modId, versionId) {
    const { ns, name } = splitId(modId);
    let ver = versionId;
    if (!ver) ver = (await this.getMod(ctx, community, modId)).version;
    return { url: `${BASE}/package/download/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/${encodeURIComponent(ver)}/`, fileName: `${ns}-${name}-${ver}.zip` };
  },

  async categories(ctx, community) {
    const j = await ctx.fetchJson(`${BASE}/api/cyberstorm/community/${encodeURIComponent(community)}/filters/`, { ttl: 6 * 3600 * 1000 });
    return (j.package_categories || []).map(c => ({ id: String(c.id), name: c.name }));
  },

  parseDep,
};
