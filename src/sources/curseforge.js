// CurseForge (api.curseforge.com) — needs a free API key (ctx.keys.curseforge, header x-api-key).
const { cleanName, gameSlug, iso, num, noKey, qs } = require('./_util');

const API = 'https://api.curseforge.com';
const WEB = 'https://www.curseforge.com';
const KEY_HELP = 'Get a free API key at https://console.curseforge.com/ (sign in, then "API Keys"). If CurseForge refuses it, your account may still need API approval: apply with the form linked on https://docs.curseforge.com/rest-api/.';
// sortField: 1 Featured, 2 Popularity, 3 LastUpdated, 4 Name, 5 Author, 6 TotalDownloads, 11 ReleasedDate
const SORT = { popular: [2, 'desc'], updated: [3, 'desc'], name: [4, 'asc'], downloads: [6, 'desc'], newest: [11, 'desc'] };
const LOADER_TAGS = new Set(['forge', 'fabric', 'neoforge', 'quilt', 'liteloader', 'rift', 'cauldron']);
const ENV_TAGS = new Set(['client', 'server']);
const CHANNEL = { 1: 'release', 2: 'beta', 3: 'alpha' };

function key(ctx) {
  const k = ctx.keys && ctx.keys.curseforge;
  if (!k) throw noKey('CurseForge', KEY_HELP);
  return k;
}

// CurseForge's API terms (§3.1) forbid saving or caching API data, so every call goes to the API.
async function cf(ctx, path, opts = {}) {
  const { ttl, ...rest } = opts; // eslint-disable-line no-unused-vars
  opts = rest;
  try {
    return await ctx.fetchJson(API + path, { ...opts, headers: { 'x-api-key': key(ctx), ...(opts.headers || {}) } });
  } catch (e) {
    // CurseForge answers 403 to every call made with an invalid key.
    if ((e.status === 401 || e.status === 403) && !opts.raw) {
      const k = noKey('CurseForge', 'The saved API key was rejected. ' + KEY_HELP);
      k.code = 'BAD_KEY';
      k.message = `CurseForge refused this key (HTTP ${e.status}). Use the key from console.curseforge.com → API keys. Keys for other CurseForge services, and keys for accounts CurseForge hasn't approved for API access yet, are refused like this.`;
      throw k;
    }
    throw e;
  }
}

function modUrl(m) {
  return (m.links && m.links.websiteUrl) || `${WEB}/projects/${m.id}`;
}

function newestFile(m) {
  return (m.latestFiles || []).slice().sort((a, b) => String(b.fileDate).localeCompare(String(a.fileDate)))[0] || null;
}

function fromMod(m) {
  const lf = newestFile(m);
  const gv = new Set();
  for (const i of m.latestFilesIndexes || []) if (i.gameVersion) gv.add(i.gameVersion);
  return {
    source: 'curseforge',
    id: String(m.id),
    slug: m.slug,
    gameId: String(m.gameId),
    name: m.name,
    author: (m.authors && m.authors[0] && m.authors[0].name) || null,
    summary: m.summary || '',
    version: lf ? (lf.displayName || lf.fileName) : null,
    updatedAt: iso(m.dateReleased || m.dateModified),
    createdAt: iso(m.dateCreated),
    downloads: num(m.downloadCount),
    likes: num(m.thumbsUpCount),
    icon: (m.logo && (m.logo.thumbnailUrl || m.logo.url)) || null,
    url: modUrl(m),
    categories: (m.categories || []).map(c => c.name),
    nsfw: false,
    deprecated: m.isAvailable === false || m.status === 9 /* abandoned */,
    gameVersions: [...gv],
    allowModDistribution: m.allowModDistribution !== false,
  };
}

function mapFile(f) {
  const tags = f.gameVersions || [];
  return {
    id: String(f.id),
    version: f.displayName || f.fileName,
    title: f.displayName || null,
    channel: CHANNEL[f.releaseType] || 'release',
    date: iso(f.fileDate),
    gameVersions: tags.filter(t => !LOADER_TAGS.has(t.toLowerCase()) && !ENV_TAGS.has(t.toLowerCase())),
    loaders: tags.filter(t => LOADER_TAGS.has(t.toLowerCase())).map(t => t.toLowerCase()),
    fileName: f.fileName,
    size: f.fileLength != null ? num(f.fileLength) : null,
    downloadUrl: f.downloadUrl || null,
    changelog: null,
    dependencies: (f.dependencies || [])
      .filter(d => d.relationType === 3 || d.relationType === 2)
      .map(d => ({ source: 'curseforge', modId: String(d.modId), required: d.relationType === 3 })),
  };
}

module.exports = {
  id: 'curseforge',
  noStore: true, // terms: no saving/caching of API data
  name: 'CurseForge',
  color: '#f16436',
  site: WEB,
  needsKey: true,
  keyHelp: KEY_HELP,

  async listGames(ctx) {
    const TTL = 12 * 3600 * 1000;
    const out = [];
    for (let index = 0, page = 0; page < 20; page++) {
      const j = await cf(ctx, `/v1/games?` + qs({ index, pageSize: 50 }), { ttl: TTL });
      for (const g of j.data || []) {
        const name = cleanName(g.name);
        const a = g.assets || {};
        out.push({ sourceGameId: String(g.id), name, slug: gameSlug(name), image: a.iconUrl || a.tileUrl || a.coverUrl || null, images: [a.coverUrl && { url: a.coverUrl, kind: 'portrait' }, a.tileUrl && { url: a.tileUrl, kind: 'any' }, a.iconUrl && { url: a.iconUrl, kind: 'icon' }].filter(Boolean), url: `${WEB}/${g.slug}` });
      }
      const p = j.pagination || {};
      index += num(p.resultCount, (j.data || []).length);
      if (!(j.data || []).length || index >= num(p.totalCount)) break;
    }
    return out;
  },

  async listMods(ctx, gameId, opts = {}) {
    const { query, sort = 'popular', page = 0, gameVersion, category } = opts;
    const pageSize = Math.max(1, Math.min(50, opts.pageSize || 20));
    const index = page * pageSize;
    if (index + pageSize > 10000) return { mods: [], hasMore: false, total: 10000 };
    const [sortField, sortOrder] = SORT[sort] || SORT.popular;
    const params = { gameId, searchFilter: query && query.trim(), sortField, sortOrder, index, pageSize, gameVersion, categoryId: category };
    // Minecraft (432): restrict to the "Mods" class so resource packs/worlds don't flood the list.
    if (String(gameId) === '432' && !category) params.classId = 6;
    const j = await cf(ctx, `/v1/mods/search?` + qs(params), { ttl: 2 * 60 * 1000 });
    const total = Math.min(10000, num(j.pagination && j.pagination.totalCount));
    return { mods: (j.data || []).map(fromMod), hasMore: index + pageSize < total, total };
  },

  async getMod(ctx, gameId, modId) {
    const [m, desc] = await Promise.all([
      cf(ctx, `/v1/mods/${encodeURIComponent(modId)}`, { ttl: 10 * 60 * 1000 }).then(j => j.data),
      cf(ctx, `/v1/mods/${encodeURIComponent(modId)}/description`, { ttl: 30 * 60 * 1000 }).then(j => j.data).catch(() => null),
    ]);
    return {
      ...fromMod(m),
      description: desc || m.summary || '',
      descriptionFormat: desc ? 'html' : 'text',
      screenshots: (m.screenshots || []).map(s => s.url).filter(Boolean),
    };
  },

  async getVersions(ctx, gameId, modId) {
    const files = [];
    for (let index = 0, page = 0; page < 6; page++) {
      const j = await cf(ctx, `/v1/mods/${encodeURIComponent(modId)}/files?` + qs({ index, pageSize: 50 }), { ttl: 10 * 60 * 1000 });
      files.push(...(j.data || []));
      const p = j.pagination || {};
      index += (j.data || []).length;
      if (!(j.data || []).length || index >= num(p.totalCount)) break;
    }
    return files.filter(f => f.isAvailable !== false).map(mapFile).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },

  async resolveDownload(ctx, gameId, modId, versionId) {
    let fileId = versionId;
    const mod = (await cf(ctx, `/v1/mods/${encodeURIComponent(modId)}`, { ttl: 10 * 60 * 1000 })).data;
    if (!fileId) fileId = mod.mainFileId || (newestFile(mod) || {}).id;
    const f = (await cf(ctx, `/v1/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`, { ttl: 10 * 60 * 1000 })).data;
    // Authors can turn off third-party downloads; CurseForge's terms say to respect that.
    const allowed = mod.allowModDistribution !== false;
    let url = allowed ? f.downloadUrl : null;
    if (!url && allowed) {
      try { url = (await cf(ctx, `/v1/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}/download-url`, { raw: true })).data; } catch (e) { url = null; }
    }
    // CurseForge's download servers want the same key (x-api-key) as the API.
    if (url) return { url, fileName: f.fileName, headers: { 'x-api-key': key(ctx) } };
    return {
      manual: true,
      pageUrl: `${modUrl(mod)}/files/${fileId}`,
      reason: 'The author has disabled third-party downloads for this mod; download it from the CurseForge website.',
    };
  },

  async categories(ctx, gameId) {
    const j = await cf(ctx, `/v1/categories?` + qs({ gameId }), { ttl: 12 * 3600 * 1000 });
    return (j.data || []).filter(c => !c.isClass).map(c => ({ id: String(c.id), name: c.name }));
  },
};
