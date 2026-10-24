#!/usr/bin/env node
// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Live smoke test for src/sources adapters.
//   node tools/test-sources.js              -> call every keyless adapter against the live APIs
//   node tools/test-sources.js --contract   -> same, plus strict type checks against src/sources/README.md
//   node tools/test-sources.js thunderstore -> only that adapter (any ids, space separated)
// Keys: CF_KEY (CurseForge), NEXUS_KEY (Nexus). Without them those adapters must fail with code 'NO_KEY'
// (Nexus browsing still works keyless through GraphQL and is tested).
const path = require('path');
const net = require(path.join(__dirname, '..', 'src', 'net.js'));
const adapters = require(path.join(__dirname, '..', 'src', 'sources'));
const util = require(path.join(__dirname, '..', 'src', 'sources', '_util.js'));

const args = process.argv.slice(2);
const CONTRACT = args.includes('--contract');
const only = args.filter(a => !a.startsWith('--'));

const ctx = {
  fetchJson: net.fetchJson,
  request: net.request,
  keys: { curseforge: process.env.CF_KEY || '', nexus: process.env.NEXUS_KEY || '' },
  settings: {},
};

// details: extra getMod calls that print author/images/description (minShots = gallery size seen on the site).
const PLAN = {
  thunderstore: { game: 'lethal-company', query: 'more company', details: [{ game: 'lethal-company', id: 'notnotnotswipez-MoreCompany', minShots: 1 }] },
  modrinth: { game: 'minecraft', query: 'sodium', gameVersion: '1.20.1', details: [{ game: 'minecraft', id: 'AANobbMI', minShots: 6, minCredits: 3 }, { game: 'minecraft', id: 'YL57xq9U', minShots: 3 }] },
  gamebanana: { game: '6460', query: 'helping hand', details: [{ game: '6460', id: '150759', minShots: 32, minCredits: 3 }] }, // Celeste, D-Sides Pack
  curseforge: { game: '432', query: 'jei' }, // Minecraft
  nexus: { game: 'skyrimspecialedition', query: 'skyui', details: ['298', '542', '547', '450'].map(id => ({ game: 'runescapedragonwilds', id, minShots: 1 })) },
};

let failures = 0, warnings = 0;
const log = (...a) => console.log(...a);
const fail = (msg) => { failures++; log('  \x1b[31mFAIL\x1b[0m ' + msg); };
const warn = (msg) => { warnings++; log('  \x1b[33mWARN\x1b[0m ' + msg); };
const ok = (msg) => log('  \x1b[32mok\x1b[0m   ' + msg);

// ---------------------------------------------------------------- contract checks
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const T = {
  str: v => typeof v === 'string',
  nestr: v => typeof v === 'string' && v.length > 0,
  strN: v => v === null || typeof v === 'string',
  num: v => typeof v === 'number' && Number.isFinite(v),
  numN: v => v === null || (typeof v === 'number' && Number.isFinite(v)),
  bool: v => typeof v === 'boolean',
  iso: v => typeof v === 'string' && ISO_RE.test(v),
  isoN: v => v === null || (typeof v === 'string' && ISO_RE.test(v)),
  url: v => typeof v === 'string' && /^https?:\/\//.test(v),
  urlN: v => v === null || (typeof v === 'string' && /^https?:\/\//.test(v)),
  strArr: v => Array.isArray(v) && v.every(x => typeof x === 'string'),
  urlArr: v => Array.isArray(v) && v.every(x => typeof x === 'string' && /^https?:\/\//.test(x)),
  arr: v => Array.isArray(v),
  obj: v => v && typeof v === 'object' && !Array.isArray(v),
  opt: t => v => v === undefined || T[t](v),
};
const SCHEMA = {
  game: { sourceGameId: 'nestr', name: 'nestr', slug: 'nestr', image: 'urlN', url: 'url', modCount: T.opt('num'), steamAppId: v => v === undefined || T.str(v) || T.num(v) },
  list: { mods: 'arr', hasMore: 'bool', total: T.opt('num') },
  mod: {
    source: 'nestr', id: 'nestr', gameId: 'nestr', name: 'nestr', author: 'strN', summary: 'str', version: 'strN',
    updatedAt: 'isoN', createdAt: 'isoN', downloads: 'numN', likes: 'num', icon: 'urlN', url: 'url',
    categories: 'strArr', nsfw: 'bool', deprecated: 'bool', gameVersions: 'strArr',
    authorUrl: v => v !== undefined && T.urlN(v), image: v => v !== undefined && T.urlN(v),
  },
  detail: {
    description: 'str', descriptionFormat: v => ['html', 'markdown', 'text'].includes(v), screenshots: 'urlArr',
    credits: v => Array.isArray(v) && v.every(c => c && T.nestr(c.name) && T.nestr(c.role) && (c.url === undefined || T.urlN(c.url))),
    gallery: v => Array.isArray(v) && v.every(g => g && T.url(g.url) && T.strN(g.title === undefined ? null : g.title)),
    screenshotsComplete: T.opt('bool'), galleryUrl: T.opt('url'),
  },
  version: {
    id: 'nestr', version: 'nestr', date: 'isoN', gameVersions: 'strArr', loaders: 'strArr', fileName: 'strN',
    size: 'numN', downloadUrl: 'urlN', changelog: 'strN', dependencies: 'arr',
    title: T.opt('strN'), channel: v => v === undefined || ['release', 'beta', 'alpha'].includes(v), archived: T.opt('bool'),
    dependenciesKnown: T.opt('bool'),
  },
  dep: { source: 'nestr', modId: 'nestr', name: T.opt('str'), versionRange: T.opt('str'), versionId: T.opt('str'), required: 'bool', gameNumId: T.opt('num') },
  download: { url: 'url', fileName: 'nestr', headers: T.opt('obj') },
  manual: { manual: v => v === true, pageUrl: 'url', reason: 'nestr' },
  category: { id: 'nestr', name: 'nestr' },
};
function check(kind, obj, where) {
  if (!CONTRACT) return true;
  const errs = [];
  if (!obj || typeof obj !== 'object') errs.push(`not an object (${typeof obj})`);
  else for (const [k, t] of Object.entries(SCHEMA[kind])) {
    const fn = typeof t === 'function' ? t : T[t];
    if (!fn(obj[k])) errs.push(`${k}=${JSON.stringify(obj[k])?.slice(0, 80)} (want ${typeof t === 'string' ? t : 'custom'})`);
  }
  if (errs.length) { fail(`${where} [${kind}] ` + errs.join('; ')); return false; }
  return true;
}
function checkAll(kind, list, where, max = 50) {
  let good = true;
  list.slice(0, max).forEach((o, i) => { good = check(kind, o, `${where}[${i}]`) && good; });
  return good;
}

// ---------------------------------------------------------------- helpers
const short = (o, keys) => JSON.stringify(Object.fromEntries(keys.filter(k => o && o[k] !== undefined).map(k => [k, typeof o[k] === 'string' && o[k].length > 70 ? o[k].slice(0, 70) + '…' : o[k]])));
async function timed(label, fn) {
  const t = Date.now();
  try { const r = await fn(); return { r, ms: Date.now() - t }; } catch (e) { e.ms = Date.now() - t; e.label = label; throw e; }
}
async function probeDownload(url) {
  // Fetch the first byte only; follows redirects to the CDN.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': net.UA, Range: 'bytes=0-0' }, redirect: 'follow', signal: ac.signal });
    try { await res.body?.cancel(); } catch (e) { /* ignore */ }
    return { status: res.status, type: res.headers.get('content-type'), final: res.url };
  } finally { clearTimeout(timer); }
}
async function expectNoKey(label, fn) {
  try { await fn(); fail(`${label}: expected NO_KEY error, call succeeded`); }
  catch (e) { if (e.code === 'NO_KEY') ok(`${label} -> NO_KEY ("${e.message.slice(0, 60)}…")`); else fail(`${label}: expected NO_KEY, got ${e.code || ''} ${e.message}`); }
}

function modSanity(mods, where) {
  if (!mods.length) return;
  const noVer = mods.filter(m => !m.version).length, noUpd = mods.filter(m => !m.updatedAt).length;
  if (noVer) warn(`${where}: ${noVer}/${mods.length} mods without version`);
  if (noUpd) warn(`${where}: ${noUpd}/${mods.length} mods without updatedAt`);
}

// Every list row should credit the author and carry both images.
function mediaSanity(mods, where) {
  if (!mods.length) return;
  for (const k of ['author', 'authorUrl', 'icon', 'image']) {
    const n = mods.filter(m => !m[k]).length;
    if (n) warn(`${where}: ${n}/${mods.length} mods without ${k}`);
  }
}

// getMod on a known mod: print what the preview shows and check it against what the site page has.
async function detailCheck(a, d) {
  try {
    const { r: m, ms } = await timed('getMod', () => a.getMod(ctx, d.game, d.id));
    check('mod', m, `getMod(${d.id})`); check('detail', m, `getMod(${d.id})`);
    ok(`getMod(${d.game}/${d.id}) "${m.name}" ${ms} ms`);
    log(`       author=${m.author}  authorUrl=${m.authorUrl}`);
    log(`       icon=${m.icon}`);
    log(`       image=${m.image}`);
    log(`       screenshots=${m.screenshots.length}${m.screenshotsComplete === false ? ` (partial, site gallery: ${m.galleryUrl})` : ''}  credits=${(m.credits || []).map(c => `${c.name} [${String(c.role).slice(0, 30)}]`).join(', ').slice(0, 200)}`);
    log(`       ${m.descriptionFormat} description ${m.description.length} chars: ${JSON.stringify(m.description.slice(0, 200))}`);
    if (!m.author) fail(`getMod(${d.id}): no author`);
    if (!m.authorUrl) fail(`getMod(${d.id}): no authorUrl`);
    if (!m.icon || !m.image) fail(`getMod(${d.id}): icon/image missing`);
    if (!m.description || m.description.length < 100) fail(`getMod(${d.id}): description too short (${m.description.length})`);
    if (d.minShots && m.screenshots.length < d.minShots) fail(`getMod(${d.id}): ${m.screenshots.length} screenshots, site shows ${d.minShots}`);
    if (d.minCredits && (m.credits || []).length < d.minCredits) fail(`getMod(${d.id}): ${(m.credits || []).length} credits, want >= ${d.minCredits}`);
    if (m.screenshots.some(u => /\/(?:220|100|530)-90_|_350\.webp|\/thumbnails\//.test(u))) fail(`getMod(${d.id}): thumbnail-size URL in screenshots`);
    if (m.descriptionFormat === 'html' && a.id === 'nexus') {
      const left = m.description.match(/\[\/?(?:b|i|u|url|img|size|colou?r|list|\*|center|spoiler|youtube|quote|font)(?:=[^\]]*)?\]/gi);
      if (left) fail(`getMod(${d.id}): BBCode left in html: ${left.slice(0, 5).join(' ')}`);
    }
  } catch (e) { fail(`getMod(${d.game}/${d.id}) threw: ${e.code ? `[${e.code}] ` : ''}${e.message}`); }
}

// ---------------------------------------------------------------- full adapter run
async function runFull(a, plan, { keyless }) {
  // listGames
  const { r: games, ms } = await timed('listGames', () => a.listGames(ctx));
  if (!Array.isArray(games) || !games.length) return fail('listGames returned nothing');
  ok(`listGames: ${games.length} games in ${ms} ms, e.g. ${games.slice(0, 3).map(g => `"${g.name}" (${g.sourceGameId}, slug ${g.slug})`).join(', ')}`);
  checkAll('game', games, 'listGames', 100000);
  const g = games.find(x => x.sourceGameId === plan.game);
  if (g) ok(`test game present: ${short(g, ['sourceGameId', 'name', 'slug', 'modCount', 'image'])}`); else warn(`test game ${plan.game} not in listGames`);
  const ids = new Set(); const dups = games.filter(x => ids.has(x.sourceGameId) || !ids.add(x.sourceGameId));
  if (dups.length) fail(`listGames has ${dups.length} duplicate ids`);

  // categories
  if (a.categories) {
    try {
      const cats = await a.categories(ctx, plan.game);
      ok(`categories: ${cats.length}, e.g. ${cats.slice(0, 4).map(c => `${c.name}(${c.id})`).join(', ')}`);
      checkAll('category', cats, 'categories');
    } catch (e) { fail(`categories: ${e.message}`); }
  }

  // listMods popular
  const { r: pop, ms: ms2 } = await timed('listMods', () => a.listMods(ctx, plan.game, { sort: 'popular', page: 0, pageSize: 20 }));
  check('list', pop, 'listMods(popular)');
  if (!pop.mods.length) return fail('listMods(popular) returned no mods');
  ok(`listMods(popular): ${pop.mods.length} mods, total=${pop.total}, hasMore=${pop.hasMore} (${ms2} ms)`);
  pop.mods.slice(0, 3).forEach(m => log('       · ' + short(m, ['id', 'name', 'version', 'updatedAt', 'downloads', 'likes', 'author'])));
  checkAll('mod', pop.mods, 'listMods(popular).mods');
  if (pop.mods.some(m => m.source !== a.id)) fail('listMods: Mod.source != adapter id');
  modSanity(pop.mods, 'listMods(popular)');
  mediaSanity(pop.mods, 'listMods(popular)');

  // page 2 differs
  try {
    const p2 = await a.listMods(ctx, plan.game, { sort: 'popular', page: 1, pageSize: 20 });
    const overlap = p2.mods.filter(m => pop.mods.some(x => x.id === m.id)).length;
    if (!p2.mods.length && pop.hasMore) fail('page 1 empty although hasMore was true');
    else if (overlap > 2) fail(`page 1 overlaps page 0 by ${overlap} mods`);
    else ok(`listMods page 1: ${p2.mods.length} mods, overlap with page 0: ${overlap}`);
  } catch (e) { fail(`listMods page 1: ${e.message}`); }

  // other sorts
  for (const sort of ['updated', 'downloads', 'newest', 'name']) {
    try {
      const r = await a.listMods(ctx, plan.game, { sort, page: 0, pageSize: 10 });
      checkAll('mod', r.mods, `listMods(${sort})`);
      ok(`listMods(${sort}): ${r.mods.length} -> ${r.mods.slice(0, 3).map(m => sort === 'updated' ? `${m.name} @${m.updatedAt}` : sort === 'downloads' ? `${m.name} ↓${m.downloads}` : m.name).join(' | ')}`);
    } catch (e) { fail(`listMods(${sort}): ${e.message}`); }
  }

  // search
  const { r: sr } = await timed('search', () => a.listMods(ctx, plan.game, { query: plan.query, sort: 'popular', page: 0, pageSize: 10, gameVersion: plan.gameVersion }));
  check('list', sr, 'listMods(query)');
  if (!sr.mods.length) fail(`search "${plan.query}" returned nothing`);
  else ok(`search "${plan.query}"${plan.gameVersion ? ` (gameVersion ${plan.gameVersion})` : ''}: total=${sr.total}, first: ${sr.mods.slice(0, 4).map(m => m.name).join(' | ')}`);
  checkAll('mod', sr.mods, 'listMods(query).mods');

  // details on first popular result (and first search result)
  const target = sr.mods[0] || pop.mods[0];
  const { r: mod, ms: ms3 } = await timed('getMod', () => a.getMod(ctx, plan.game, target.id));
  check('mod', mod, 'getMod'); check('detail', mod, 'getMod');
  ok(`getMod(${target.id}) ${ms3} ms: ${short(mod, ['name', 'version', 'updatedAt', 'author', 'downloads', 'descriptionFormat'])}, description ${String(mod.description).length} chars, ${mod.screenshots.length} screenshots`);
  if (!mod.description) warn('getMod: empty description');
  log('       description starts: ' + JSON.stringify(String(mod.description).slice(0, 140)));
  for (const d of plan.details || []) await detailCheck(a, d);

  const { r: vers, ms: ms4 } = await timed('getVersions', () => a.getVersions(ctx, plan.game, target.id));
  if (!Array.isArray(vers) || !vers.length) fail('getVersions returned nothing');
  else {
    ok(`getVersions: ${vers.length} versions (${ms4} ms); newest: ${short(vers[0], ['id', 'version', 'date', 'fileName', 'size', 'channel', 'category'])}`);
    log(`       gameVersions=${JSON.stringify(vers[0].gameVersions.slice(0, 6))} loaders=${JSON.stringify(vers[0].loaders)} deps=${JSON.stringify(vers[0].dependencies.slice(0, 3))}`);
    checkAll('version', vers, 'getVersions', 1000);
    vers.forEach((v, i) => v.dependencies.forEach((d, j) => check('dep', d, `getVersions[${i}].dependencies[${j}]`)));
    if (a.id !== 'nexus' && a.id !== 'gamebanana') {
      const unsorted = vers.findIndex((v, i) => i && v.date && vers[i - 1].date && v.date > vers[i - 1].date);
      if (unsorted > 0) fail(`getVersions not newest-first at index ${unsorted}`);
    }
  }

  // download
  if (keyless) {
    const v0 = vers && vers[0];
    const { r: dl } = await timed('resolveDownload', () => a.resolveDownload(ctx, plan.game, target.id, v0 && v0.id));
    if (dl.manual) { check('manual', dl, 'resolveDownload'); warn(`resolveDownload manual: ${dl.pageUrl} (${dl.reason})`); }
    else {
      check('download', dl, 'resolveDownload');
      const p = await probeDownload(dl.url).catch(e => ({ status: 'ERR ' + e.message }));
      if (typeof p.status === 'number' && p.status < 400) ok(`resolveDownload: ${dl.fileName} <- ${dl.url} (HTTP ${p.status}, ${p.type}, final ${String(p.final).slice(0, 80)})`);
      else fail(`resolveDownload URL not reachable: ${dl.url} -> ${p.status}`);
    }
  }
  return { target, vers };
}

// ---------------------------------------------------------------- per-adapter
async function testAdapter(a) {
  log(`\n=== ${a.name} (${a.id})  needsKey=${a.needsKey}${a.keylessBrowse ? ' keylessBrowse' : ''}`);
  for (const k of ['id', 'name', 'color', 'site', 'keyHelp']) if (typeof a[k] !== 'string' || !a[k]) fail(`adapter.${k} missing`);
  for (const f of ['listGames', 'listMods', 'getMod', 'getVersions', 'resolveDownload']) if (typeof a[f] !== 'function') fail(`adapter.${f} missing`);
  const plan = PLAN[a.id];
  if (!plan) return warn('no test plan');
  const hasKey = !!ctx.keys[a.id];
  try {
    if (!a.needsKey) { await runFull(a, plan, { keyless: true }); return; }
    if (hasKey) { await runFull(a, plan, { keyless: true }); return; }
    // No key.
    if (a.keylessBrowse) {
      log('  (no key: testing keyless browse + NO_KEY on download)');
      const res = await runFull(a, plan, { keyless: false });
      if (res) await expectNoKey('resolveDownload without key', () => a.resolveDownload(ctx, plan.game, res.target.id, res.vers && res.vers[0] && res.vers[0].id));
    } else {
      log('  (no key set: expecting clean NO_KEY failures)');
      await expectNoKey('listGames', () => a.listGames(ctx));
      await expectNoKey('listMods', () => a.listMods(ctx, plan.game, { sort: 'popular' }));
      await expectNoKey('getMod', () => a.getMod(ctx, plan.game, '238222'));
      await expectNoKey('getVersions', () => a.getVersions(ctx, plan.game, '238222'));
      await expectNoKey('resolveDownload', () => a.resolveDownload(ctx, plan.game, '238222', '1'));
      if (a.categories) await expectNoKey('categories', () => a.categories(ctx, plan.game));
      // A key the site refuses must surface as BAD_KEY, not a raw HTTP error.
      const saved = ctx.keys[a.id];
      ctx.keys[a.id] = 'not-a-real-key-modhaven-test';
      try { await a.getMod(ctx, plan.game, '238222'); fail('getMod with a bogus key succeeded'); }
      catch (e) { if (e.code === 'BAD_KEY') ok('getMod with a bogus key -> BAD_KEY'); else fail(`getMod with a bogus key: expected BAD_KEY, got ${e.code || ''} ${e.status || ''} ${e.message}`); }
      finally { ctx.keys[a.id] = saved; }
    }
  } catch (e) {
    fail(`${e.label || 'run'} threw: ${e.code ? `[${e.code}] ` : ''}${e.message}`);
    if (process.env.DEBUG) console.error(e);
  }
}

function unitTests() {
  log('\n=== helpers');
  const nexus = adapters.find(a => a.id === 'nexus');
  const n = nexus.parseNxm('nxm://skyrimspecialedition/mods/266/files/1000?key=K&expires=E&user_id=U');
  const want = { domain: 'skyrimspecialedition', modId: '266', fileId: '1000', key: 'K', expires: 'E' };
  if (n && Object.entries(want).every(([k, v]) => n[k] === v)) ok('parseNxm: ' + JSON.stringify(n)); else fail('parseNxm: ' + JSON.stringify(n));
  if (nexus.parseNxm('https://example.com') !== null) fail('parseNxm accepted a non-nxm url');
  const ts = adapters.find(a => a.id === 'thunderstore');
  const d = ts.parseDep('BepInEx-BepInExPack-5.4.2100');
  if (d.modId === 'BepInEx-BepInExPack' && d.versionRange === '5.4.2100' && d.source === 'thunderstore') ok('thunderstore dep: ' + JSON.stringify(d)); else fail('thunderstore dep: ' + JSON.stringify(d));
  const html = util.bbcodeToHtml('[b]Bold[/b] <script>x</script>\n[url=https://a.b/c?d=1&e=2]l[/url][url=javascript:alert(1)]x[/url][list][*]a[*]b[/list][size=5][color=red]c[/color][/size][spoiler]s[/spoiler][youtube]dQw4w9WgXcQ[/youtube]');
  const bad = /<script|javascript:/i.test(html);
  if (!bad && html.includes('<b>Bold</b>') && html.includes('<li>a</li>') && html.includes('&lt;script&gt;')) ok('bbcodeToHtml: ' + html.slice(0, 120) + '…'); else fail('bbcodeToHtml: ' + html);
  const bb = (src, ...want) => {
    const h = util.bbcodeToHtml(src);
    const miss = want.filter(w => (w instanceof RegExp ? !w.test(h) : !h.includes(w)));
    if (miss.length || /\[\/?(?:b|list|\*|url|img|color|center)\b[^\]]*\]/i.test(h.replace(/<pre>[\s\S]*?<\/pre>/g, ''))) fail(`bbcode ${JSON.stringify(src).slice(0, 60)} -> ${h}`);
    else ok(`bbcode ${JSON.stringify(src).slice(0, 50)} -> ${h.slice(0, 90)}`);
  };
  bb('[list]\n<br />[*]one[/*]\n<br />[*]two[list=1][*]n1[*]n2[/list][/list]', '<ul><li>one</li><li>two<ol><li>n1</li><li>n2</li></ol></li></ul>');
  bb('[color=#fff]a[color=red]b[/color]c[/color]', '<span class="bb-color" style="color:#fff">a<span class="bb-color" style="color:red">b</span>c</span>');
  bb('[b]open [center]never closed [/b]x [*]stray', '<b>open never closed </b>', '• stray');
  bb('[youtube]https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1[/youtube]', 'watch?v=dQw4w9WgXcQ"', 'img.youtube.com/vi/dQw4w9WgXcQ');
  bb('[url=https://x.y/][img]https://x.y/a.png[/img][/url]', '<a href="https://x.y/"><img src="https://x.y/a.png"');
  bb('[code][b]keep[/b] <x>[/code]', '<pre><code>[b]keep[/b] &lt;x&gt;</code></pre>');
  bb('[size=5]big[/size][size=2]small[/size][spoiler=Title]hidden[/spoiler]', 'bb-size-5', 'bb-size-2', '<details class="bb-spoiler"><summary>Title</summary>hidden</details>');
  bb('[img]javascript:alert(1)[/img][url=javascript:alert(1)]x[/url]', /^x$/);
  const imgs = util.extractImages('![a](https://x/1.png "t") ![b][r] <img src=\'https://x/2.jpg\'> <img alt="" src="https://x/3.jpg?a=1&amp;b=2"> ![](https://img.shields.io/x) ![](https://x/1.png)\n[r]: https://x/4.gif');
  if (JSON.stringify(imgs) === JSON.stringify(['https://x/1.png', 'https://x/4.gif', 'https://x/2.jpg', 'https://x/3.jpg?a=1&b=2'])) ok('extractImages: ' + imgs.length + ' images, badges/dupes skipped'); else fail('extractImages: ' + JSON.stringify(imgs));
  if (util.gameSlug("Baldur's Gate 3™") === 'baldurs-gate-3' && util.gameSlug('Pokémon Scarlet & Violet') === 'pokemon-scarlet-and-violet') ok('gameSlug'); else fail('gameSlug');
}

(async () => {
  log(`ModHaven source test  ${new Date().toISOString()}  mode=${CONTRACT ? 'contract' : 'smoke'}  CF_KEY=${ctx.keys.curseforge ? 'set' : 'unset'} NEXUS_KEY=${ctx.keys.nexus ? 'set' : 'unset'}`);
  unitTests();
  for (const a of adapters) {
    if (only.length && !only.includes(a.id)) continue;
    await testAdapter(a);
  }
  log(`\n${failures ? '\x1b[31m' : '\x1b[32m'}${failures} failure(s)\x1b[0m, ${warnings} warning(s)`);
  process.exit(failures ? 1 : 0);
})();
