// Nexus Mods.
//  Browse/search/details/files: public GraphQL v2 (https://api.nexusmods.com/v2/graphql) — works WITHOUT a key.
//  Fallback (key required): REST v1 (https://api.nexusmods.com/v1, header apikey).
//  Downloads always need the key: premium -> direct link; free -> needs key/expires from an nxm:// link,
//  otherwise {manual:true}.
const { cleanName, gameSlug, iso, num, noKey, qs, mapLimit, bbcodeToHtml } = require('./_util');

const V1 = 'https://api.nexusmods.com/v1';
const GQL = 'https://api.nexusmods.com/v2/graphql';
const WEB = 'https://www.nexusmods.com';
const KEY_HELP = 'Copy your personal API key from https://next.nexusmods.com/settings/api-keys (free account is enough; downloads without Premium go through the website "Mod Manager Download" button).';
const SORT = { popular: ['endorsements', 'DESC'], downloads: ['downloads', 'DESC'], updated: ['updatedAt', 'DESC'], newest: ['createdAt', 'DESC'], name: ['name', 'ASC'] };
const V1_LIST = { popular: 'trending', downloads: 'trending', updated: 'latest_updated', newest: 'latest_added', name: 'trending' };
const CAT_ORDER = { MAIN: 0, UPDATE: 1, OPTIONAL: 2, MISCELLANEOUS: 3, OLD_VERSION: 4, ARCHIVED: 5, DELETED: 6 };
const CAT_BY_ID = { 1: 'MAIN', 2: 'UPDATE', 3: 'OPTIONAL', 4: 'OLD_VERSION', 5: 'MISCELLANEOUS', 6: 'DELETED', 7: 'ARCHIVED' };

const MOD_FIELDS = 'modId uid name summary version author updatedAt createdAt downloads endorsements thumbnailUrl pictureUrl adultContent status modCategory { name } game { id domainName name } uploader { name }';

function apiKey(ctx) { return (ctx.keys && ctx.keys.nexus) || null; }
function needKey(ctx) { const k = apiKey(ctx); if (!k) throw noKey('Nexus Mods', KEY_HELP); return k; }

function v1(ctx, path, opts = {}) {
  return ctx.fetchJson(V1 + path, { ...opts, headers: { apikey: needKey(ctx), ...(opts.headers || {}) } });
}

async function gql(ctx, query, variables, ttl = 2 * 60 * 1000) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey(ctx)) headers.apikey = apiKey(ctx);
  const j = await ctx.fetchJson(GQL, { method: 'POST', body: JSON.stringify({ query, variables }), headers, ttl });
  if (j.errors && j.errors.length && !j.data) throw new Error('Nexus GraphQL: ' + j.errors.map(e => e.message).join('; '));
  if (j.errors && j.errors.length && j.data && Object.values(j.data).every(v => v == null)) throw new Error('Nexus GraphQL: ' + j.errors[0].message);
  return j.data;
}

function modPage(domain, id) { return `${WEB}/${domain}/mods/${id}`; }

function fromGql(m, domain) {
  const d = (m.game && m.game.domainName) || domain;
  return {
    source: 'nexus',
    id: String(m.modId),
    gameId: d,
    name: m.name,
    author: m.author || (m.uploader && m.uploader.name) || null,
    summary: m.summary || '',
    version: m.version || null,
    updatedAt: iso(m.updatedAt),
    createdAt: iso(m.createdAt),
    downloads: num(m.downloads),
    likes: num(m.endorsements),
    icon: m.thumbnailUrl || m.pictureUrl || null,
    url: modPage(d, m.modId),
    categories: m.modCategory && m.modCategory.name ? [m.modCategory.name] : [],
    nsfw: !!m.adultContent,
    deprecated: m.status ? !/^published$/i.test(m.status) : false,
    gameVersions: [],
  };
}

function fromV1(m, domain, cats) {
  const d = m.domain_name || domain;
  return {
    source: 'nexus',
    id: String(m.mod_id),
    gameId: d,
    name: m.name || `Mod ${m.mod_id}`,
    author: m.author || m.uploaded_by || null,
    summary: m.summary || '',
    version: m.version || null,
    updatedAt: iso(m.updated_timestamp || m.updated_time),
    createdAt: iso(m.created_timestamp || m.created_time),
    downloads: num(m.mod_downloads),
    likes: num(m.endorsement_count),
    icon: m.picture_url ? m.picture_url.replace('/images/', '/images/thumbnails/') : null,
    url: modPage(d, m.mod_id),
    categories: cats && cats[m.category_id] ? [cats[m.category_id]] : [],
    nsfw: !!m.contains_adult_content,
    deprecated: m.status ? m.status !== 'published' : m.available === false,
    gameVersions: [],
  };
}

// domain -> numeric game id (GraphQL mod/modFiles queries need the number)
async function gameNumId(ctx, domain) {
  try {
    const d = await gql(ctx, 'query($d:String){ game(domainName:$d){ id } }', { d: domain }, 24 * 3600 * 1000);
    if (d && d.game && d.game.id) return d.game.id;
  } catch (e) { /* fall back to v1 */ }
  const g = await v1(ctx, `/games/${encodeURIComponent(domain)}.json`, { ttl: 24 * 3600 * 1000 });
  return g.id;
}

function mapV1File(f) {
  const cat = f.category_name || CAT_BY_ID[f.category_id] || 'MISCELLANEOUS';
  return {
    id: String(f.file_id),
    version: f.version || f.mod_version || f.name,
    title: f.name || null,
    category: cat,
    archived: cat === 'ARCHIVED' || cat === 'OLD_VERSION' || cat === 'DELETED',
    primary: !!f.is_primary,
    date: iso(f.uploaded_timestamp || f.uploaded_time),
    gameVersions: [],
    loaders: [],
    fileName: f.file_name || null,
    size: f.size_in_bytes != null ? num(f.size_in_bytes) : (f.size_kb != null ? num(f.size_kb) * 1024 : null),
    downloadUrl: null,
    changelog: f.changelog_html || null,
    description: f.description || null,
    dependencies: [],
  };
}

function sortFiles(list) {
  return list.sort((a, b) => (CAT_ORDER[a.category] ?? 3) - (CAT_ORDER[b.category] ?? 3) || String(b.date).localeCompare(String(a.date)));
}

function parseNxm(url) {
  try {
    const u = new URL(String(url).trim());
    if (u.protocol !== 'nxm:') return null;
    const parts = u.pathname.split('/').filter(Boolean); // mods/266/files/1000
    const mi = parts.indexOf('mods'), fi = parts.indexOf('files');
    if (mi < 0 || fi < 0) return null;
    return {
      domain: u.hostname.toLowerCase(),
      modId: parts[mi + 1],
      fileId: parts[fi + 1],
      key: u.searchParams.get('key') || null,
      expires: u.searchParams.get('expires') || null,
      userId: u.searchParams.get('user_id') || null,
    };
  } catch (e) { return null; }
}

module.exports = {
  id: 'nexus',
  name: 'Nexus Mods',
  color: '#d98f40',
  site: WEB,
  needsKey: true,
  keylessBrowse: true, // listGames/listMods/getMod/getVersions work without a key (GraphQL v2); downloads need it
  keyHelp: KEY_HELP,
  parseNxm,

  async listGames(ctx) {
    const TTL = 12 * 3600 * 1000;
    try {
      // GraphQL caps games/mods pages at 80 nodes.
      const Q = 'query($o:Int){ games(count:80, offset:$o, sort:[{downloads:{direction:DESC}}]){ totalCount nodes{ id name domainName modCount } } }';
      const first = await gql(ctx, Q, { o: 0 }, TTL);
      const total = Math.min(num(first.games && first.games.totalCount), 80 * 120);
      const offsets = [];
      for (let o = 80; o < total; o += 80) offsets.push(o);
      const rest = await mapLimit(offsets, 6, o => gql(ctx, Q, { o }, TTL).catch(() => ({ games: { nodes: [] } })));
      const out = [];
      const seen = new Set();
      for (const d of [first, ...rest]) for (const g of (d.games && d.games.nodes) || []) {
        if (!num(g.modCount) || seen.has(g.domainName)) continue;
        seen.add(g.domainName);
        const name = cleanName(g.name);
        out.push({ sourceGameId: g.domainName, name, slug: gameSlug(name), image: `https://images.nexusmods.com/images/games/v2/${g.id}/tile.jpg`, images: [{ url: `https://images.nexusmods.com/images/games/v2/${g.id}/tile.jpg`, kind: 'portrait' }], url: `${WEB}/${g.domainName}`, modCount: num(g.modCount), nexusId: g.id });
      }
      if (out.length) return out;
    } catch (e) { if (!apiKey(ctx)) throw e; }
    const list = await v1(ctx, '/games.json', { ttl: TTL });
    return list.filter(g => num(g.mods)).map(g => {
      const name = cleanName(g.name);
      return { sourceGameId: g.domain_name, name, slug: gameSlug(name), image: `https://images.nexusmods.com/images/games/v2/${g.id}/tile.jpg`, images: [{ url: `https://images.nexusmods.com/images/games/v2/${g.id}/tile.jpg`, kind: 'portrait' }], url: g.nexusmods_url || `${WEB}/${g.domain_name}`, modCount: num(g.mods), nexusId: g.id };
    });
  },

  async listMods(ctx, domain, opts = {}) {
    const { query, sort = 'popular', page = 0, category } = opts;
    const pageSize = Math.max(1, Math.min(80, opts.pageSize || 20));
    const showNsfw = !!(ctx.settings && ctx.settings.showNsfw);
    try {
      const filter = { gameDomainName: [{ value: domain }] };
      const q = (query || '').trim();
      if (q) filter.name = [{ value: q, op: 'WILDCARD' }];
      if (category) filter.categoryName = [{ value: String(category) }];
      if (!showNsfw) filter.adultContent = [{ value: false }];
      const [field, dir] = SORT[sort] || SORT.popular;
      const d = await gql(ctx, `query($f:ModsFilter,$s:[ModsSort!],$o:Int,$c:Int){ mods(filter:$f, sort:$s, offset:$o, count:$c){ totalCount nodes{ ${MOD_FIELDS} } } }`,
        { f: filter, s: [{ [field]: { direction: dir } }], o: page * pageSize, c: pageSize });
      const total = num(d.mods.totalCount);
      return { mods: d.mods.nodes.map(m => fromGql(m, domain)), hasMore: (page + 1) * pageSize < total, total };
    } catch (e) {
      if (!apiKey(ctx)) throw e;
      // v1 has no search; only fixed lists of 10 (trending / latest_added / latest_updated).
      const list = await v1(ctx, `/games/${encodeURIComponent(domain)}/mods/${V1_LIST[sort] || 'trending'}.json`, { ttl: 5 * 60 * 1000 });
      const q = (opts.query || '').trim().toLowerCase();
      const mods = list.filter(m => m.available !== false && (showNsfw || !m.contains_adult_content))
        .map(m => fromV1(m, domain)).filter(m => !q || m.name.toLowerCase().includes(q));
      return page === 0 ? { mods, hasMore: false, total: mods.length } : { mods: [], hasMore: false, total: mods.length };
    }
  },

  async getMod(ctx, domain, modId) {
    try {
      const gid = await gameNumId(ctx, domain);
      const d = await gql(ctx, `query($m:ID!,$g:ID!){ mod(modId:$m, gameId:$g){ ${MOD_FIELDS} description } }`, { m: String(modId), g: String(gid) }, 10 * 60 * 1000);
      const m = d.mod;
      return {
        ...fromGql(m, domain),
        description: bbcodeToHtml(m.description || m.summary || ''),
        descriptionFormat: 'html',
        screenshots: m.pictureUrl ? [m.pictureUrl] : [],
      };
    } catch (e) {
      if (!apiKey(ctx)) throw e;
      const m = await v1(ctx, `/games/${encodeURIComponent(domain)}/mods/${encodeURIComponent(modId)}.json`, { ttl: 10 * 60 * 1000 });
      return {
        ...fromV1(m, domain),
        description: bbcodeToHtml(m.description || m.summary || ''),
        descriptionFormat: 'html',
        screenshots: m.picture_url ? [m.picture_url] : [],
      };
    }
  },

  async getVersions(ctx, domain, modId) {
    let files, deps = [];
    try {
      const gid = await gameNumId(ctx, domain);
      const d = await gql(ctx, `query($m:ID!,$g:ID!){
        modFiles(modId:$m, gameId:$g){ fileId name version category date sizeInBytes size primary uri changelogText description }
        mod(modId:$m, gameId:$g){ modRequirements{ nexusRequirements{ nodes{ modId modName gameId externalRequirement url } } } }
      }`, { m: String(modId), g: String(gid) }, 5 * 60 * 1000);
      files = (d.modFiles || []).map(f => {
        const cat = String(f.category || 'MISCELLANEOUS').toUpperCase();
        return {
          id: String(f.fileId),
          version: f.version || f.name,
          title: f.name || null,
          category: cat,
          archived: cat === 'ARCHIVED' || cat === 'OLD_VERSION' || cat === 'DELETED',
          primary: !!f.primary,
          date: iso(f.date),
          gameVersions: [],
          loaders: [],
          fileName: f.uri || null,
          size: f.sizeInBytes != null ? num(f.sizeInBytes) : (f.size != null ? num(f.size) * 1024 : null),
          downloadUrl: null,
          changelog: Array.isArray(f.changelogText) && f.changelogText.length ? f.changelogText.join('\n') : null,
          description: f.description || null,
          dependencies: [],
        };
      });
      const reqs = (d.mod && d.mod.modRequirements && d.mod.modRequirements.nexusRequirements && d.mod.modRequirements.nexusRequirements.nodes) || [];
      const myGid = String(gid);
      deps = reqs.filter(r => !r.externalRequirement && r.modId).map(r => ({
        source: 'nexus', modId: String(r.modId), name: r.modName || undefined, required: true,
        ...(r.gameId && String(r.gameId) !== myGid ? { gameNumId: Number(r.gameId) } : {}),
      }));
    } catch (e) {
      if (!apiKey(ctx)) throw e;
      const j = await v1(ctx, `/games/${encodeURIComponent(domain)}/mods/${encodeURIComponent(modId)}/files.json`, { ttl: 5 * 60 * 1000 });
      files = (j.files || []).map(mapV1File);
    }
    files = files.filter(f => f.category !== 'DELETED');
    for (const f of files) f.dependencies = deps;
    return sortFiles(files);
  },

  async resolveDownload(ctx, domain, modId, versionId) {
    const pageUrl = `${modPage(domain, modId)}?tab=files${versionId ? `&file_id=${versionId}` : ''}`;
    needKey(ctx);
    let fileId = versionId;
    let fileName = null;
    try {
      const vs = await this.getVersions(ctx, domain, modId);
      const f = fileId ? vs.find(v => v.id === String(fileId)) : (vs.find(v => v.primary) || vs[0]);
      if (f) { fileId = f.id; fileName = f.fileName; }
    } catch (e) { /* name is optional */ }
    if (!fileId) return { manual: true, pageUrl, reason: 'No downloadable file found for this mod.' };
    const nxm = ctx.nxm && (!ctx.nxm.fileId || String(ctx.nxm.fileId) === String(fileId)) ? ctx.nxm : null;
    const extra = nxm && nxm.key && nxm.expires ? '?' + qs({ key: nxm.key, expires: nxm.expires }) : '';
    try {
      const links = await v1(ctx, `/games/${encodeURIComponent(domain)}/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}/download_link.json${extra}`);
      const link = Array.isArray(links) && links[0];
      if (link && link.URI) {
        if (!fileName) { try { fileName = decodeURIComponent(new URL(link.URI).pathname.split('/').pop()); } catch (e) { /* ignore */ } }
        return { url: link.URI, fileName: fileName || `${modId}-${fileId}` };
      }
    } catch (e) {
      if (e.status === 401) { const k = noKey('Nexus Mods', 'The saved API key was rejected. ' + KEY_HELP); k.code = 'BAD_KEY'; k.message = 'Nexus Mods rejected the saved API key. ' + KEY_HELP; throw k; }
      if (e.status !== 403 && e.status !== 410) throw e;
    }
    return {
      manual: true,
      pageUrl: `${modPage(domain, modId)}?tab=files&file_id=${fileId}`,
      reason: 'Nexus free accounts must click "Mod Manager Download" on the website',
    };
  },

  async categories(ctx, domain) {
    try {
      // Mod categories come from the categoryName facet; the filter matches by name, so id === name.
      const d = await gql(ctx, 'query($f:ModsFilter,$fa:ModsFacet){ mods(filter:$f, facets:$fa, count:0){ facets{ facet value count } } }',
        { f: { gameDomainName: [{ value: domain }] }, fa: { categoryName: [] } }, 12 * 3600 * 1000);
      return ((d.mods && d.mods.facets) || []).filter(f => f.facet === 'categoryName' && f.value)
        .map(f => ({ id: f.value, name: f.value, count: num(f.count) }))
        .sort((x, y) => x.name.localeCompare(y.name));
    } catch (e) {
      if (!apiKey(ctx)) throw e;
      const g = await v1(ctx, `/games/${encodeURIComponent(domain)}.json`, { ttl: 24 * 3600 * 1000 });
      return (g.categories || []).map(c => ({ id: c.name, name: c.name }));
    }
  },
};
