// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// GameBanana (gamebanana.com/apiv11) — keyless.
//  games:   Game/Index (50 per page, ~100 pages) — fetched once, cached 12 h
//  mods:    Mod/Index?_aFilters[Generic_Game]=id&_sSort=...   (browse)
//           Util/Search/Results?_sModelName=Mod&_idGameRow=id  (search, server caps results at ~100)
//  details: Mod/{id}/ProfilePage (_sText html, _aFiles, _aPreviewMedia, _aRequirements)
const { cleanName, gameSlug, iso, num, mapLimit, qs, uniqueGallery } = require('./_util');

const API = 'https://gamebanana.com/apiv11';
const WEB = 'https://gamebanana.com';
const PER = 50;
const MAX_GAME_PAGES = 150;
const SORT = { popular: 'Generic_MostLiked', downloads: 'Generic_MostDownloaded', updated: 'Generic_LatestModified', newest: 'Generic_Newest', name: 'Generic_Alphabetically' };
const SEARCH_ORDER = { popular: 'popularity', downloads: 'popularity', updated: 'date', newest: 'date', name: 'best_match' };

const isPlaceholder = u => !u || /\/_\.(gif|png)$/.test(u);

// First preview image (the author's main picture). size: '100' | '220' | '530' | '800' | 'full'.
// GameBanana only makes the 220/530/800 variants for some uploads; fall back to the next size that exists.
function imageOf(media, size = '220') {
  const imgs = (media && media._aImages) || [];
  const ss = imgs.find(i => i._sType === 'screenshot') || imgs[0];
  if (!ss) return null;
  if (ss._sUrl) return isPlaceholder(ss._sUrl) ? null : ss._sUrl;
  const order = { 100: ['100', '220', 'full'], 220: ['220', '530', '100', 'full'], 530: ['530', '800', 'full'], 800: ['800', 'full'], full: ['full'] }[size] || ['full'];
  for (const k of order) {
    const f = k === 'full' ? ss._sFile : ss[`_sFile${k}`];
    if (ss._sBaseUrl && f) return `${ss._sBaseUrl}/${f}`;
  }
  return null;
}

// Every preview image at full (original upload) size, in the author's order, with captions.
function galleryOf(media) {
  return uniqueGallery(((media && media._aImages) || [])
    .map(i => ({ url: i._sBaseUrl && i._sFile ? `${i._sBaseUrl}/${i._sFile}` : (i._sUrl && !isPlaceholder(i._sUrl) ? i._sUrl : null), title: i._sCaption || null, description: null })));
}

// _aCredits: [{ _sGroupName, _aAuthors: [{ _sRole, _sName, _sProfileUrl?, _sUrl?, _sAvatarUrl? }] }]
function creditsOf(p) {
  const out = [];
  for (const g of p._aCredits || []) {
    for (const a of (g && g._aAuthors) || []) {
      if (!a || !a._sName) continue;
      const role = [g._sGroupName, a._sRole].filter(Boolean).join(': ') || 'Credit';
      out.push({ name: a._sName, role, url: a._sProfileUrl || (/^https?:\/\//i.test(a._sUrl || '') ? a._sUrl : null), avatar: a._sAvatarUrl || null });
    }
  }
  for (const st of p._aContributingStudios || []) if (st && st._sName) out.push({ name: st._sName, role: 'Studio', url: st._sProfileUrl || null, avatar: null });
  const sub = p._aSubmitter;
  if (sub && sub._sName && !out.some(c => c.name === sub._sName)) out.unshift({ name: sub._sName, role: 'Submitter', url: sub._sProfileUrl || null, avatar: sub._sAvatarUrl || null });
  return out;
}

function fromRecord(r, gameId) {
  const cats = [r._aRootCategory && r._aRootCategory._sName, r._aSubCategory && r._aSubCategory._sName, r._aSuperCategory && r._aSuperCategory._sName, r._aCategory && r._aCategory._sName].filter(Boolean);
  return {
    source: 'gamebanana',
    id: String(r._idRow),
    gameId: String((r._aGame && r._aGame._idRow) || gameId),
    name: r._sName,
    author: (r._aSubmitter && r._aSubmitter._sName) || null,
    authorUrl: (r._aSubmitter && (r._aSubmitter._sProfileUrl || (r._aSubmitter._idRow && `${WEB}/members/${r._aSubmitter._idRow}`))) || null,
    summary: r._sDescription || '',
    version: r._sVersion || null,
    updatedAt: iso(r._tsDateModified || r._tsDateUpdated || r._tsDateAdded),
    createdAt: iso(r._tsDateAdded),
    downloads: r._nDownloadCount != null ? num(r._nDownloadCount) : null, // not in list responses
    likes: num(r._nLikeCount),
    views: num(r._nViewCount),
    icon: imageOf(r._aPreviewMedia, '220'),
    image: imageOf(r._aPreviewMedia, '800'),
    url: r._sProfileUrl || `${WEB}/mods/${r._idRow}`,
    categories: [...new Set(cats)],
    nsfw: !!r._bHasContentRatings,
    deprecated: !!r._bIsObsolete,
    gameVersions: [],
  };
}

async function profile(ctx, modId) {
  return ctx.fetchJson(`${API}/Mod/${encodeURIComponent(modId)}/ProfilePage`, { ttl: 10 * 60 * 1000 });
}

function depsFromRequirements(reqs) {
  const out = [];
  for (const r of reqs || []) {
    const [name, url] = Array.isArray(r) ? r : [r && r._sName, r && r._sUrl];
    const m = /gamebanana\.com\/(mods|tools|wips)\/(\d+)/i.exec(url || '');
    if (m && m[1].toLowerCase() === 'mods') out.push({ source: 'gamebanana', modId: m[2], name: name || undefined, required: true });
  }
  return out;
}

module.exports = {
  id: 'gamebanana',
  name: 'GameBanana',
  color: '#c69a00',
  site: WEB,
  needsKey: false,
  keyHelp: 'No key needed.',

  async listGames(ctx) {
    const TTL = 12 * 3600 * 1000;
    const url = p => `${API}/Game/Index?` + qs({ _nPage: p, _nPerpage: PER, _sSort: 'Generic_Alphabetically' });
    const first = await ctx.fetchJson(url(1), { ttl: TTL });
    const total = num(first._aMetadata && first._aMetadata._nRecordCount);
    const pages = Math.min(MAX_GAME_PAGES, Math.ceil(total / PER));
    const rest = [];
    for (let p = 2; p <= pages; p++) rest.push(p);
    const more = await mapLimit(rest, 8, p => ctx.fetchJson(url(p), { ttl: TTL }).catch(() => ({ _aRecords: [] })));
    const seen = new Set();
    const out = [];
    for (const j of [first, ...more]) for (const g of j._aRecords || []) {
      if (seen.has(g._idRow)) continue;
      seen.add(g._idRow);
      const name = cleanName(g._sName);
      const imgs = (g._aPreviewMedia && g._aPreviewMedia._aImages) || [];
      const icon = imgs.find(i => i._sType === 'icon');
      const banner = imgs.find(i => i._sType === 'banner');
      const images = [];
      if (banner && !isPlaceholder(banner._sUrl)) images.push({ url: banner._sUrl, kind: 'wide' });
      if (icon && !isPlaceholder(icon._sUrl)) images.push({ url: icon._sUrl, kind: 'icon' });
      out.push({
        sourceGameId: String(g._idRow), name, slug: gameSlug(name),
        image: icon && !isPlaceholder(icon._sUrl) ? icon._sUrl : null, images,
        url: g._sProfileUrl || `${WEB}/games/${g._idRow}`,
      });
    }
    return out;
  },

  async listMods(ctx, gameId, opts = {}) {
    const { query, sort = 'popular', page = 0, category } = opts;
    const pageSize = Math.max(1, Math.min(PER, opts.pageSize || 20));
    const q = (query || '').trim();
    let j;
    if (q.length >= 2) {
      j = await ctx.fetchJson(`${API}/Util/Search/Results?` + qs({
        _sModelName: 'Mod', _sOrder: SEARCH_ORDER[sort] || 'best_match', _idGameRow: gameId,
        _sSearchString: q, _nPage: page + 1, _nPerpage: pageSize,
      }), { ttl: 2 * 60 * 1000 });
    } else {
      const params = { _nPage: page + 1, _nPerpage: pageSize, '_aFilters[Generic_Game]': gameId, _sSort: SORT[sort] || SORT.popular };
      if (category) params['_aFilters[Generic_Category]'] = category;
      j = await ctx.fetchJson(`${API}/Mod/Index?` + qs(params), { ttl: 2 * 60 * 1000 });
    }
    const recs = (j._aRecords || []).filter(r => !r._sModelName || r._sModelName === 'Mod');
    const meta = j._aMetadata || {};
    const total = num(meta._nRecordCount);
    return {
      mods: recs.map(r => fromRecord(r, gameId)),
      hasMore: meta._bIsComplete === false && (page + 1) * pageSize < total,
      total,
    };
  },

  async getMod(ctx, gameId, modId) {
    const p = await profile(ctx, modId);
    const mod = fromRecord(p, gameId);
    mod.icon = imageOf(p._aPreviewMedia, '220');
    mod.image = imageOf(p._aPreviewMedia, 'full');
    mod.downloads = num(p._nDownloadCount);
    const gallery = galleryOf(p._aPreviewMedia);
    return {
      ...mod,
      description: p._sText || p._sDescription || '',
      descriptionFormat: p._sText ? 'html' : 'text',
      screenshots: gallery.map(g => g.url),
      gallery,
      credits: creditsOf(p),
      requirements: (p._aRequirements || []).map(r => (Array.isArray(r) ? { name: r[0], url: r[1] || null } : r)),
    };
  },

  async getVersions(ctx, gameId, modId) {
    const p = await profile(ctx, modId);
    const deps = depsFromRequirements(p._aRequirements);
    const files = (p._aFiles || []).slice().sort((a, b) =>
      (a._bIsArchived ? 1 : 0) - (b._bIsArchived ? 1 : 0) || num(b._tsDateAdded) - num(a._tsDateAdded));
    return files.map((f, i) => ({
      id: String(f._idRow),
      version: f._sVersion || (i === 0 && p._sVersion) || f._sDescription || f._sFile,
      title: f._sDescription || f._sFile,
      date: iso(f._tsDateAdded),
      gameVersions: [],
      loaders: [],
      fileName: f._sFile,
      size: f._nFilesize != null ? num(f._nFilesize) : null,
      downloadUrl: f._sDownloadUrl || `${WEB}/dl/${f._idRow}`,
      md5: f._sMd5Checksum || null,
      changelog: null,
      archived: !!f._bIsArchived,
      dependencies: deps,
    }));
  },

  async resolveDownload(ctx, gameId, modId, versionId) {
    const p = await profile(ctx, modId);
    const files = p._aFiles || [];
    const f = versionId ? files.find(x => String(x._idRow) === String(versionId)) : files.filter(x => !x._bIsArchived).sort((a, b) => b._tsDateAdded - a._tsDateAdded)[0];
    if (!f) return { manual: true, pageUrl: p._sProfileUrl || `${WEB}/mods/${modId}`, reason: 'File not found on GameBanana (it may have been removed or the mod links to an external host).' };
    return { url: f._sDownloadUrl || `${WEB}/dl/${f._idRow}`, fileName: f._sFile };
  },

  async categories(ctx, gameId) {
    const list = await ctx.fetchJson(`${API}/Mod/Categories?` + qs({ _idGameRow: gameId, _sSort: 'a_to_z', _bShowEmpty: 'true' }), { ttl: 6 * 3600 * 1000 });
    return (Array.isArray(list) ? list : []).map(c => ({ id: String(c._idRow), name: c._sName }));
  },
};
