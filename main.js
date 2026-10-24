// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// ModHaven — Electron main process.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./src/store');

const AUTHOR = 'CrpytTonic';
const HOMEPAGE = 'https://github.com/CrpytTonic/ModHaven';
const IS_PACKAGED = app.isPackaged;
const APP_DIR = IS_PACKAGED ? path.dirname(process.execPath) : __dirname;
store.init(process.env.MH_DATA || APP_DIR, app.getPath('appData'));
app.setPath('userData', store.root('Program data'));

const games = require('./src/games');
const catalog = require('./src/catalog');
const installer = require('./src/installer');
const launcher = require('./src/launcher');
const analysis = require('./src/analysis');
const mm = require('./src/modmanager');
const local = require('./src/localgames');
const steamart = require('./src/steamart');
const scanner = require('./src/scanner');
let SOURCES = [];
try { SOURCES = require('./src/sources'); } catch (e) { store.log('sources failed to load', e); }

let win = null;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send('evt', ch, data); };
installer.setEmitter(send);
launcher.setEmitter((ch, d) => { send(ch, d); });
analysis.setEmitter(send);
mm.init(SOURCES, send);

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', (_e, argv) => {
  const link = argv.find(a => /^nxm:\/\//i.test(a));
  if (link) handleNxm(link);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

const THEME_BAR = { dark: { color: '#0f1117', symbolColor: '#c9cfe0' }, light: { color: '#f3f4f8', symbolColor: '#30364a' } };
const themeNow = () => { const t = store.settings().theme; return t === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : t; };

function createWindow() {
  const st = store.readJson(store.root('Program data', 'window.json'), { width: 1440, height: 900 });
  win = new BrowserWindow({
    width: st.width, height: st.height, x: st.x, y: st.y, minWidth: 980, minHeight: 620,
    backgroundColor: themeNow() === 'dark' ? '#0f1117' : '#f3f4f8',
    titleBarStyle: 'hidden', titleBarOverlay: { ...THEME_BAR[themeNow()], height: 38 },
    title: 'ModHaven by ' + AUTHOR, icon: path.join(__dirname, 'app', 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  if (st.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => { if (!process.env.MH_HARNESS) win.show(); });
  // Dev test hook: MH_HARNESS=<script.js> drives the window and takes screenshots.
  if (process.env.MH_HARNESS) win.webContents.once('did-finish-load', () => { try { require(process.env.MH_HARNESS)(win, { app, store }); } catch (e) { store.log('harness', e); console.error(e); app.exit(3); } });
  const saveBounds = () => { if (!win.isMinimized()) store.writeJson(store.root('Program data', 'window.json'), { ...win.getNormalBounds(), maximized: win.isMaximized() }); };
  win.on('close', saveBounds);
  // Links in mod descriptions open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { openUrl(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); openUrl(url); } });
  win.webContents.on('render-process-gone', (_e, d) => store.log('renderer gone', d));
}

function openUrl(url) { if (/^https?:\/\//i.test(url)) shell.openExternal(url); }

// ---------- IPC ----------
const handlers = {
  'app:info': () => ({ version: app.getVersion(), author: AUTHOR, homepage: HOMEPAGE, dataRoot: store.ROOT, packaged: IS_PACKAGED, sevenZip: !!installer.find7z(),
    sources: SOURCES.map(s => ({ id: s.id, name: s.name, color: s.color, site: s.site, needsKey: !!s.needsKey, keylessBrowse: !!s.keylessBrowse, keyHelp: s.keyHelp || '' })) }),
  'settings:get': () => store.settings(),
  'settings:set': patch => {
    const s = store.saveSettings(patch);
    if ('theme' in patch && win) { try { win.setTitleBarOverlay({ ...THEME_BAR[themeNow()], height: 38 }); } catch { } }
    if ('updateIntervalMin' in patch || 'autoUpdate' in patch) scheduleUpdates();
    if ('nxmHandler' in patch) setNxm(patch.nxmHandler);
    return s;
  },
  'theme:resolved': () => themeNow(),
  'titlebar:set': colors => { try { win.setTitleBarOverlay({ ...colors, height: 38 }); } catch { } },

  'catalog:get': async ({ force } = {}) => catalog.build(SOURCES, s => mm.ctxFor(s), { force }),
  'local:scan': () => local.scan(true),
  'art:lookup': name => steamart.lookup(name),
  'external:quick': ({ key, profile }) => scanner.scan(games.get(key), { mm, profile }),
  'external:scan': ({ key, profile }) => scanner.scan(games.get(key), { mm, profile, deep: true, onProgress: p => send('external', { key, ...p }) }),
  'external:search': ({ key, query }) => scanner.searchSites(games.get(key), query, mm),
  'external:adopt': async ({ key, profile, picks, replace }) => {
    const r = await scanner.apply(games.get(key), profile, picks, { replace: replace !== false, mm });
    // Nexus free accounts download through the website button: make sure those links reach ModHaven.
    if (r.manual.some(m => /nexusmods\.com/.test(m.pageUrl || '')) && !store.settings().nxmHandler) { store.saveSettings({ nxmHandler: true }); setNxm(true); r.nxmEnabled = true; }
    send('profile', { key, profile });
    return r;
  },
  'external:unlink': ({ key, profile, uid }) => { const e = scanner.unlink(games.get(key), profile, uid); send('profile', { key, profile }); return e; },
  'external:ignore': ({ key, keys }) => scanner.ignore(games.get(key), keys),
  'external:unignore': key => { const g = games.get(key); g.externalIgnored = []; games.save(g); return true; },
  'games:managed': () => games.list(),
  'games:open': async entry => {
    const g = await games.open(entry);
    store.saveSettings({ lastGame: g.key });
    return g;
  },
  'games:get': key => games.get(key),
  'games:save': patch => { const g = { ...games.get(patch.key), ...patch }; games.save(g); return g; },
  'games:refreshVersion': async key => { const g = games.get(key); const r = await games.refreshVersion(g); games.save(g); return { game: g, ...r }; },
  'games:dismissVersionNotice': key => { const g = games.get(key); delete g.versionChangedNotice; games.save(g); return g; },
  'games:forget': key => { installer.undeploy(games.get(key)); fs.rmSync(games.gdir(key), { recursive: true, force: true }); return true; },
  'games:guessExe': key => { const g = games.get(key); return g.installPath ? local.guessExe(g.installPath, g.name) : null; },
  'games:layout': key => installer.resolveLayout(games.get(key)),

  'dialog:pick': async ({ kind, title, filters, multi }) => {
    const r = await dialog.showOpenDialog(win, { title, filters, properties: [kind === 'folder' ? 'openDirectory' : 'openFile', ...(multi ? ['multiSelections'] : [])] });
    return r.canceled ? null : (multi ? r.filePaths : r.filePaths[0]);
  },

  'profiles:list': key => games.profiles(key),
  'profiles:get': ({ key, name }) => games.profile(key, name),
  'profiles:create': ({ key, name, from }) => games.createProfile(key, name, from),
  'profiles:rename': ({ key, from, to }) => games.renameProfile(key, from, to),
  'profiles:delete': ({ key, name }) => { games.deleteProfile(key, name); return true; },
  'profiles:select': ({ key, name }) => { const g = games.get(key); g.activeProfile = name; games.save(g); return g; },
  'profiles:export': ({ key, name }) => games.exportProfile(key, name),
  'profiles:import': async ({ key, code, name }) => {
    const data = games.parseShareCode(code);
    const p = games.createProfile(key, name || data.name + ' (imported)');
    const res = { installed: [], manual: [], errors: [] };
    for (const m of data.mods) {
      try {
        const r = await mm.install(key, p.name, { source: m.s, gameId: m.g, modId: m.i, versionId: m.v });
        res.installed.push(...r.installed); res.manual.push(...r.manual);
      } catch (e) { res.errors.push(`${m.n}: ${e.message}`); }
    }
    const prof = games.profile(key, p.name);
    for (const m of data.mods) { const x = prof.mods.find(y => y.uid === `${m.s}:${m.i}`); if (x) x.enabled = !!m.e; }
    games.saveProfile(key, prof);
    return { profile: p.name, ...res };
  },

  'mods:browse': async ({ key, query, sort, page, sources, gameVersion, category }) => browse(key, { query, sort, page, sources, gameVersion, category }),
  'mods:details': async ({ source, gameId, modId }) => {
    const s = mm.source(source);
    const ctx = mm.ctxFor(s);
    const [info, versions] = await Promise.all([s.getMod(ctx, gameId, modId), s.getVersions(ctx, gameId, modId).catch(e => { store.log('versions', e); return []; })]);
    return { ...info, versions: versions.slice(0, 60) };
  },
  'mods:install': async ({ key, profile, source, gameId, modId, versionId }) => mm.install(key, profile, { source, gameId, modId, versionId }),
  'mods:installFileFor': ({ key, profile, uid, path: p }) => mm.installFileFor(key, profile, uid, p),
  'mods:installLocal': async ({ key, profile, paths }) => { const out = []; for (const p of paths) out.push(await mm.installLocal(key, profile, p)); return out; },
  'mods:uninstall': ({ key, profile, uid }) => mm.uninstall(key, profile, uid),
  'mods:update': ({ key, profile, uid }) => {
    const m = games.profile(key, profile).mods.find(x => x.uid === uid);
    return mm.install(key, profile, { source: m.source, gameId: m.gameId, modId: m.id, versionId: m.latest ? m.latest.versionId : null });
  },
  'mods:patch': ({ key, profile, uid, patch }) => {
    const p = games.profile(key, profile);
    const allowed = ['enabled', 'notes', 'pinned', 'autoUpdate'];
    for (const m of p.mods) if (m.uid === uid) for (const k of allowed) if (k in patch) m[k] = patch[k];
    // Turning a mod on turns its dependencies on too.
    if (patch.enabled) {
      const need = uid2 => { for (const d of p.mods) if ((d.dependencyOf || []).includes(uid2) && !d.enabled) { d.enabled = true; need(d.uid); } };
      need(uid);
    }
    games.saveProfile(key, p);
    return p;
  },
  'mods:setAll': ({ key, profile, enabled }) => { const p = games.profile(key, profile); for (const m of p.mods) m.enabled = enabled; games.saveProfile(key, p); return p; },
  'mods:reorder': ({ key, profile, uids }) => {
    const p = games.profile(key, profile);
    const pos = new Map(uids.map((u, i) => [u, i]));
    p.mods.sort((a, b) => (pos.get(a.uid) ?? 1e9) - (pos.get(b.uid) ?? 1e9));
    p.mods.forEach((m, i) => { m.order = i; });
    games.saveProfile(key, p);
    return p;
  },
  'mods:openFolder': ({ key, uid, profile }) => {
    const m = games.profile(key, profile).mods.find(x => x.uid === uid);
    shell.openPath(installer.stageDir(games.get(key), m));
    return true;
  },
  'mods:checkUpdates': ({ key, profile }) => mm.checkUpdates(key, profile),
  'mods:checkAll': () => mm.checkAll(),
  'mods:deploy': ({ key, profile }) => installer.deploy(games.get(key), games.profile(key, profile)),
  'mods:undeploy': key => installer.undeploy(games.get(key)),

  'run:launch': ({ key, profile, vanilla }) => launcher.launch(key, { profile, vanilla }),
  'run:stop': key => launcher.stop(key),
  'run:status': key => launcher.status(key),
  'run:list': key => launcher.runs(key),
  'run:setOutcome': ({ key, runId, outcome }) => launcher.setOutcome(key, runId, outcome),
  'run:readLog': ({ key, runId, name }) => {
    const f = path.join(games.gdir(key, 'crashlogs', runId), path.basename(name));
    if (/\.(dmp|mdmp)$/i.test(f)) return '(binary crash dump — open the folder to send it to the mod author)';
    try { const t = fs.readFileSync(f, 'utf8'); return t.length > 400000 ? t.slice(-400000) : t; } catch (e) { return 'Could not read: ' + e.message; }
  },
  'run:openFolder': ({ key, runId }) => { const d = games.gdir(key, 'crashlogs', runId); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); return true; },
  'run:clear': key => { launcher.runs(key); store.writeJson(games.gdir(key, 'runs.json'), []); analysis.clearVerdicts(key); return true; },

  'analysis:get': ({ key, profile }) => analysis.analyse(key, profile),
  'analysis:matrix': ({ key, profile }) => analysis.matrix(key, profile),
  'search:start': ({ key, profile, mode, seconds }) => analysis.startSearch(key, profile, { mode, seconds }),
  'search:cancel': key => analysis.cancelSearch(key),
  'search:state': key => analysis.searchState(key),

  'config:list': ({ key, profile }) => configFiles(key, profile),
  'config:read': ({ file }) => { assertConfigPath(file); return fs.readFileSync(file, 'utf8'); },
  'config:write': ({ file, text }) => { assertConfigPath(file); fs.copyFileSync(file, file + '.bak'); fs.writeFileSync(file, text); return true; },

  'downloads:list': () => installer.dlState(),
  'downloads:clear': () => installer.clearDownloads(),
  'shell:url': url => openUrl(url),
  'shell:path': p => shell.openPath(p),
  'shell:dataFolder': () => shell.openPath(store.ROOT),
  'shell:gameFolder': key => { const g = games.get(key); if (g.installPath) shell.openPath(g.installPath); return !!g.installPath; },
  'cache:clear': () => { fs.rmSync(store.root('cache'), { recursive: true, force: true }); fs.mkdirSync(store.root('cache')); return true; },
  'downloads:clearFiles': () => { fs.rmSync(store.root('downloads'), { recursive: true, force: true }); fs.mkdirSync(store.root('downloads')); return true; },
  'keys:test': async id => {
    const s = mm.source(id);
    const games0 = await s.listGames(mm.ctxFor(s));
    if (!games0.length) throw new Error(`${s.name} accepted the key but returned no games`);
    return { ok: true, games: games0.length };
  },
};

for (const [ch, fn] of Object.entries(handlers)) {
  ipcMain.handle(ch, async (_e, arg) => {
    try { return { ok: true, data: await fn(arg) }; }
    catch (e) { store.log('ipc', ch, e); return { ok: false, error: e.message || String(e), code: e.code || null }; }
  });
}

// ---------- browse: every source for one game, merged ----------
async function browse(key, { query = '', sort = 'popular', page = 0, sources: want, gameVersion, category }) {
  const g = games.get(key);
  const st = store.settings();
  const ids = Object.keys(g.sources || {}).filter(id => st.sources[id] !== false && (!want || !want.length || want.includes(id)));
  const per = Math.max(10, Math.ceil(st.pageSize / Math.max(1, ids.length)) + 4);
  const results = await Promise.all(ids.map(async id => {
    const s = mm.source(id);
    if (!s) return { id, mods: [], hasMore: false };
    if (s.needsKey && !s.keylessBrowse && !st.keys[id]) return { id, mods: [], hasMore: false, error: 'NO_KEY' };
    try {
      const r = await s.listMods(mm.ctxFor(s), g.sources[id], { query, sort, page, pageSize: per, gameVersion: gameVersion || (g.key === 'minecraft' ? g.mcVersion : undefined), category });
      return { id, ...r };
    } catch (e) {
      store.log('listMods', id, e);
      return { id, mods: [], hasMore: false, error: e.code === 'NO_KEY' ? 'NO_KEY' : e.message };
    }
  }));
  let mods;
  const lists = results.map(r => (r.mods || []).filter(m => (st.showNsfw || !m.nsfw) && (!st.hideDeprecated || !m.deprecated)));
  if (sort === 'updated' || sort === 'newest') {
    const f = sort === 'updated' ? 'updatedAt' : 'createdAt';
    mods = lists.flat().sort((a, b) => String(b[f] || '').localeCompare(String(a[f] || '')));
  } else if (sort === 'name') mods = lists.flat().sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'downloads') mods = lists.flat().sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  else {
    // Popular: each site ranks differently, so interleave their own top lists.
    mods = [];
    const max = Math.max(0, ...lists.map(l => l.length));
    for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) mods.push(l[i]);
  }
  return {
    mods, hasMore: results.some(r => r.hasMore),
    perSource: Object.fromEntries(results.map(r => [r.id, { count: (r.mods || []).length, total: r.total ?? null, error: r.error || null, hasMore: !!r.hasMore }])),
  };
}

// ---------- config editor ----------
function configRoots(key, profile) {
  const g = games.get(key);
  const dep = installer.deployedInfo(g);
  const roots = [];
  if (dep && dep.profile === profile && g.installPath) {
    roots.push(path.join(g.installPath, 'BepInEx', 'config'), path.join(g.installPath, 'UserData'), path.join(g.installPath, 'MelonLoader'));
  }
  roots.push(games.pdir(key, profile, 'config'));
  return roots;
}
function configFiles(key, profile) {
  const out = [];
  for (const r of configRoots(key, profile)) {
    if (!fs.existsSync(r)) continue;
    for (const rel of installer.walkFiles(r)) if (/\.(cfg|ini|json|toml|yaml|yml|txt|xml)$/i.test(rel) && !/\.bak$/i.test(rel)) {
      const f = path.join(r, rel);
      out.push({ file: f, name: rel, size: fs.statSync(f).size, root: r });
    }
    if (out.length) break; // live game folder wins over the saved copy
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function assertConfigPath(file) {
  const ok = games.list().some(g => {
    const roots = [g.installPath && path.join(g.installPath, 'BepInEx', 'config'), g.installPath && path.join(g.installPath, 'UserData'), g.installPath && path.join(g.installPath, 'MelonLoader'), games.gdir(g.key, 'profiles')].filter(Boolean);
    return roots.some(r => path.resolve(file).startsWith(path.resolve(r) + path.sep));
  });
  if (!ok || !/\.(cfg|ini|json|toml|yaml|yml|txt|xml)$/i.test(file)) throw new Error('Not a mod config file');
}

// ---------- Nexus "Mod Manager Download" links ----------
function setNxm(on) {
  try {
    if (on) {
      if (IS_PACKAGED) app.setAsDefaultProtocolClient('nxm');
      else app.setAsDefaultProtocolClient('nxm', process.execPath, [path.resolve(process.argv[1] || '.')]);
    } else app.removeAsDefaultProtocolClient('nxm');
  } catch (e) { store.log('nxm', e); }
}
async function handleNxm(link) {
  const nexus = mm.source('nexus');
  if (!nexus || !nexus.parseNxm) return;
  try {
    const n = nexus.parseNxm(link);
    const g = games.list().find(x => x.sources && x.sources.nexus === n.domain);
    if (!g) { send('notice', { kind: 'error', text: `Open ${n.domain} in ModHaven once, then click the download button again.` }); return; }
    const profile = g.activeProfile || 'Default';
    send('notice', { kind: 'info', text: `Nexus download for ${g.name} (${profile})…` });
    const r = await mm.install(g.key, profile, { source: 'nexus', gameId: n.domain, modId: n.modId, versionId: n.fileId, nxm: { key: n.key, expires: n.expires } });
    send('notice', { kind: 'ok', text: `Installed ${r.installed.join(', ') || 'mod'} into ${g.name} / ${profile}` });
    send('profile', { key: g.key, profile });
  } catch (e) { send('notice', { kind: 'error', text: 'Nexus download failed: ' + e.message }); }
}

// ---------- background update checks ----------
let updTimer = null;
function scheduleUpdates() {
  clearInterval(updTimer);
  const st = store.settings();
  const mins = Math.max(10, Number(st.updateIntervalMin) || 60);
  updTimer = setInterval(runUpdateCheck, mins * 60e3);
}
async function runUpdateCheck() {
  try {
    send('updates', { state: 'checking' });
    const res = await mm.checkAll();
    const updated = res.flatMap(r => r.updated.map(u => `${r.game}: ${u}`));
    const available = res.reduce((n, r) => n + r.available.length, 0);
    send('updates', { state: 'done', updated, available, at: new Date().toISOString() });
  } catch (e) { send('updates', { state: 'error', error: e.message }); }
}

app.whenReady().then(() => {
  createWindow();
  const st = store.settings();
  if (st.nxmHandler) setNxm(true);
  scheduleUpdates();
  if (st.checkUpdatesOnStart) setTimeout(runUpdateCheck, 8000);
  const link = process.argv.find(a => /^nxm:\/\//i.test(a));
  if (link) win.webContents.once('did-finish-load', () => setTimeout(() => handleNxm(link), 1500));
  nativeTheme.on('updated', () => { if (store.settings().theme === 'system') send('theme', themeNow()); });
});
app.on('window-all-closed', () => app.quit());
