// Modrinth (api.modrinth.com/v2) — keyless. Minecraft only (project_type:mod).
const { iso, num, qs } = require('./_util');

const API = 'https://api.modrinth.com/v2';
const WEB = 'https://modrinth.com';
const INDEX = { popular: 'relevance', downloads: 'downloads', updated: 'updated', newest: 'newest', name: 'relevance' };
const LOADERS = new Set(['fabric', 'forge', 'neoforge', 'quilt', 'liteloader', 'rift', 'modloader', 'risugami', 'babric', 'bta-babric', 'java-agent', 'legacy-fabric', 'nilloader', 'ornithe', 'bukkit', 'paper', 'spigot', 'purpur', 'folia', 'sponge', 'velocity', 'waterfall', 'bungeecord', 'datapack', 'iris', 'optifine', 'canvas', 'vanilla', 'minecraft']);

function fromHit(h, versionNumbers) {
  return {
    source: 'modrinth',
    id: h.project_id,
    slug: h.slug,
    gameId: 'minecraft',
    name: h.title,
    author: h.author || null,
    summary: h.description || '',
    version: (versionNumbers && versionNumbers[h.latest_version]) || null,
    updatedAt: iso(h.date_modified),
    createdAt: iso(h.date_created),
    downloads: num(h.downloads),
    likes: num(h.follows),
    icon: h.icon_url || null,
    url: `${WEB}/${h.project_type || 'mod'}/${h.slug || h.project_id}`,
    categories: (h.display_categories || h.categories || []).filter(c => !LOADERS.has(c)),
    loaders: (h.categories || []).filter(c => LOADERS.has(c)),
    nsfw: false,
    deprecated: false,
    gameVersions: h.versions || [],
  };
}

function mapVersion(v) {
  const file = (v.files || []).find(f => f.primary) || (v.files || [])[0] || {};
  return {
    id: v.id,
    version: v.version_number,
    title: v.name || null,
    channel: v.version_type || 'release',
    date: iso(v.date_published),
    gameVersions: v.game_versions || [],
    loaders: v.loaders || [],
    fileName: file.filename || null,
    size: file.size != null ? num(file.size) : null,
    downloadUrl: file.url || null,
    sha1: (file.hashes && file.hashes.sha1) || null,
    changelog: v.changelog || null,
    dependencies: (v.dependencies || [])
      .filter(d => (d.dependency_type === 'required' || d.dependency_type === 'optional') && (d.project_id || d.version_id))
      .map(d => ({
        source: 'modrinth',
        modId: d.project_id || null,
        ...(d.version_id ? { versionId: d.version_id } : {}),
        ...(d.file_name ? { name: d.file_name } : {}),
        required: d.dependency_type === 'required',
      })),
  };
}

async function versionNumbersFor(ctx, ids) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!ids.length) return {};
  try {
    const list = await ctx.fetchJson(`${API}/versions?` + qs({ ids: JSON.stringify(ids) }), { ttl: 15 * 60 * 1000 });
    const map = {};
    for (const v of list) map[v.id] = v.version_number;
    return map;
  } catch (e) { return {}; }
}

// Project ids from version-only dependencies.
async function fillDependencyProjects(ctx, versions) {
  const need = new Set();
  for (const v of versions) for (const d of v.dependencies) if (!d.modId && d.versionId) need.add(d.versionId);
  if (!need.size) return;
  try {
    const list = await ctx.fetchJson(`${API}/versions?` + qs({ ids: JSON.stringify([...need]) }), { ttl: 60 * 60 * 1000 });
    const map = Object.fromEntries(list.map(x => [x.id, x.project_id]));
    for (const v of versions) for (const d of v.dependencies) if (!d.modId && map[d.versionId]) d.modId = map[d.versionId];
  } catch (e) { /* leave null */ }
  for (const v of versions) v.dependencies = v.dependencies.filter(d => d.modId);
}

module.exports = {
  id: 'modrinth',
  name: 'Modrinth',
  color: '#1bd96a',
  site: WEB,
  needsKey: false,
  keyHelp: 'No key needed.',

  async listGames(ctx) {
    let modCount;
    try { modCount = num((await ctx.fetchJson(`${API}/search?` + qs({ limit: 1, facets: JSON.stringify([['project_type:mod']]) }), { ttl: 6 * 3600 * 1000 })).total_hits, undefined); } catch (e) { /* optional */ }
    return [{
      sourceGameId: 'minecraft', name: 'Minecraft', slug: 'minecraft',
      image: 'https://www.minecraft.net/content/dam/minecraftnet/games/minecraft/key-art/Homepage_Discover-our-games_MC-Vanilla-KeyArt_864x864.jpg',
      images: [{ url: 'https://www.minecraft.net/content/dam/minecraftnet/games/minecraft/key-art/Homepage_Discover-our-games_MC-Vanilla-KeyArt_864x864.jpg', kind: 'any' }],
      url: `${WEB}/mods`, ...(modCount !== undefined ? { modCount } : {}),
    }];
  },

  async listMods(ctx, gameId, opts = {}) {
    const { query, sort = 'popular', page = 0, gameVersion, category } = opts;
    const pageSize = Math.max(1, Math.min(100, opts.pageSize || 20));
    const facets = [['project_type:mod']];
    if (gameVersion) facets.push([`versions:${gameVersion}`]);
    if (category) facets.push([`categories:${category}`]);
    const j = await ctx.fetchJson(`${API}/search?` + qs({
      query: query && query.trim(), facets: JSON.stringify(facets),
      index: INDEX[sort] || 'relevance', offset: page * pageSize, limit: pageSize,
    }), { ttl: 2 * 60 * 1000 });
    const hits = j.hits || [];
    const vmap = await versionNumbersFor(ctx, hits.map(h => h.latest_version));
    const mods = hits.map(h => fromHit(h, vmap));
    if (sort === 'name') mods.sort((a, b) => a.name.localeCompare(b.name)); // no name index on Modrinth
    const total = num(j.total_hits);
    return { mods, hasMore: (page + 1) * pageSize < total, total };
  },

  async getMod(ctx, gameId, modId) {
    const p = await ctx.fetchJson(`${API}/project/${encodeURIComponent(modId)}`, { ttl: 10 * 60 * 1000 });
    let author = null, version = null;
    const [members, versions] = await Promise.all([
      ctx.fetchJson(`${API}/project/${encodeURIComponent(modId)}/members`, { ttl: 60 * 60 * 1000 }).catch(() => []),
      ctx.fetchJson(`${API}/project/${encodeURIComponent(modId)}/version`, { ttl: 10 * 60 * 1000 }).catch(() => []),
    ]);
    const owner = members.find(m => m.role === 'Owner' || m.is_owner) || members[0];
    if (owner && owner.user) author = owner.user.username;
    if (versions[0]) version = versions[0].version_number;
    const gallery = (p.gallery || []).slice().sort((a, b) => (b.featured - a.featured) || (a.ordering - b.ordering));
    return {
      source: 'modrinth',
      id: p.id,
      slug: p.slug,
      gameId: 'minecraft',
      name: p.title,
      author,
      summary: p.description || '',
      version,
      updatedAt: iso(p.updated),
      createdAt: iso(p.published),
      downloads: num(p.downloads),
      likes: num(p.followers),
      icon: p.icon_url || null,
      url: `${WEB}/${p.project_type || 'mod'}/${p.slug || p.id}`,
      categories: [...(p.categories || []), ...(p.additional_categories || [])].filter(c => !LOADERS.has(c)),
      loaders: p.loaders || [],
      nsfw: false,
      deprecated: p.status === 'archived',
      gameVersions: p.game_versions || [],
      description: p.body || p.description || '',
      descriptionFormat: p.body ? 'markdown' : 'text',
      screenshots: gallery.map(g => g.raw_url || g.url).filter(Boolean),
      websiteUrl: p.source_url || p.wiki_url || null,
    };
  },

  async getVersions(ctx, gameId, modId) {
    const list = await ctx.fetchJson(`${API}/project/${encodeURIComponent(modId)}/version`, { ttl: 10 * 60 * 1000 });
    const out = list.map(mapVersion).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    await fillDependencyProjects(ctx, out);
    return out;
  },

  async resolveDownload(ctx, gameId, modId, versionId) {
    let v;
    if (versionId) v = await ctx.fetchJson(`${API}/version/${encodeURIComponent(versionId)}`, { ttl: 10 * 60 * 1000 });
    else v = (await ctx.fetchJson(`${API}/project/${encodeURIComponent(modId)}/version`, { ttl: 10 * 60 * 1000 }))[0];
    if (!v) throw new Error(`Modrinth: no version found for ${modId}`);
    const f = (v.files || []).find(x => x.primary) || (v.files || [])[0];
    if (!f) return { manual: true, pageUrl: `${WEB}/mod/${modId}/version/${v.id}`, reason: 'This version has no downloadable file.' };
    return { url: f.url, fileName: f.filename };
  },

  async categories(ctx) {
    const list = await ctx.fetchJson(`${API}/tag/category`, { ttl: 24 * 3600 * 1000 });
    return list.filter(c => c.project_type === 'mod')
      .map(c => ({ id: c.name, name: c.name.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) }));
  },
};
