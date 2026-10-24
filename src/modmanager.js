// Install / uninstall / update mods in a profile, including dependencies.
const fs = require('fs');
const store = require('./store');
const games = require('./games');
const installer = require('./installer');
const net = require('./net');
const launcher = require('./launcher');

let SOURCES = [];
let emit = () => { };
function init(sources, emitter) { SOURCES = sources; emit = emitter; }

const source = id => SOURCES.find(s => s.id === id);
function ctxFor(s, extra = {}) {
  const st = store.settings();
  return { fetchJson: net.fetchJson, request: net.request, keys: st.keys, settings: st, ...extra };
}

const uidOf = (sourceId, modId) => `${sourceId}:${modId}`;

// Picks the version to install: requested one, else newest that fits the game version.
function pickVersion(versions, game, versionId) {
  if (versionId) return versions.find(v => String(v.id) === String(versionId)) || null;
  if (game.key === 'minecraft' && game.mcVersion) {
    const fits = versions.filter(v => (!v.gameVersions.length || v.gameVersions.includes(game.mcVersion)) && (!game.mcLoader || !v.loaders || !v.loaders.length || v.loaders.includes(game.mcLoader)));
    if (fits.length) return fits[0];
  }
  return versions[0] || null;
}

// Installs (or switches version of) a mod into a profile. Returns {installed:[names], manual:[{name,pageUrl,reason}]}
async function install(key, profileName, { source: sid, gameId, modId, versionId, dependencyOf = null, nxm = null }, seen = new Set()) {
  const game = games.get(key);
  const s = source(sid);
  if (!s) throw new Error('Unknown source ' + sid);
  const uid = uidOf(sid, modId);
  const result = { installed: [], manual: [], skipped: [] };
  if (seen.has(uid)) return result;
  seen.add(uid);
  const ctx = ctxFor(s, nxm ? { nxm } : {});
  const [info, versions] = await Promise.all([s.getMod(ctx, gameId, modId), s.getVersions(ctx, gameId, modId)]);
  const v = pickVersion(versions, game, versionId);
  if (!v) throw new Error(`${info.name}: no downloadable file found`);
  let profile = games.profile(key, profileName);
  const existing = profile.mods.find(m => m.uid === uid);
  if (existing && String(existing.versionId) === String(v.id) && !versionId) {
    if (dependencyOf && !(existing.dependencyOf || []).includes(dependencyOf)) { existing.dependencyOf = [...(existing.dependencyOf || []), dependencyOf]; games.saveProfile(key, profile); }
    result.skipped.push(info.name);
    return result;
  }
  // Dependencies first (Thunderstore/Modrinth/CurseForge list them).
  for (const d of v.dependencies || []) {
    if (d.required === false) continue;
    if (/BepInEx-BepInExPack/i.test(d.modId) && game.installPath && fs.existsSync(require('path').join(game.installPath, 'BepInEx', 'core')) && !profile.mods.some(m => /BepInExPack/i.test(m.id))) {
      // Already installed by hand in the game folder.
      continue;
    }
    const dsrc = d.source || sid;
    try {
      const sub = await install(key, profileName, { source: dsrc, gameId: d.gameId || gameId, modId: d.modId, dependencyOf: uid }, seen);
      result.installed.push(...sub.installed); result.manual.push(...sub.manual); result.skipped.push(...sub.skipped);
    } catch (e) {
      result.manual.push({ name: d.name || d.modId, reason: 'Dependency could not be installed: ' + e.message, pageUrl: null });
    }
  }
  const dl = await s.resolveDownload(ctx, gameId, modId, v.id);
  const entry = {
    uid, source: sid, id: String(modId), gameId: String(gameId), name: info.name, author: info.author, icon: info.icon, url: info.url,
    version: v.version, versionId: String(v.id), fileName: v.fileName, modUpdatedAt: v.date || info.updatedAt,
    gameVersions: v.gameVersions || [], loaders: v.loaders || [], deprecated: !!info.deprecated, summary: info.summary,
    categories: info.categories || [],
  };
  if (dl.manual) {
    installer.markDownload(info.name, 'manual', dl.reason || 'Download this one from the website');
    result.manual.push({ name: info.name, pageUrl: dl.pageUrl, reason: dl.reason || 'This mod has to be downloaded from the website', uid, entry });
    return result;
  }
  await installer.stageMod(game, entry, dl);
  profile = games.profile(key, profileName); // re-read: dependencies may have changed it
  const old = profile.mods.find(m => m.uid === uid);
  const keep = old ? { enabled: old.enabled, order: old.order, notes: old.notes, pinned: !!versionId || old.pinned, autoUpdate: old.autoUpdate, dependencyOf: old.dependencyOf, installedAt: old.installedAt } : {};
  const merged = {
    ...entry, enabled: true, order: profile.mods.length, installedAt: new Date().toISOString(),
    dependencyOf: dependencyOf ? [dependencyOf] : [], pinned: !!versionId, autoUpdate: null, notes: '',
    ...keep, updatedLocallyAt: new Date().toISOString(), previousVersionId: old ? old.versionId : null, latest: null,
  };
  if (dependencyOf && !(merged.dependencyOf || []).includes(dependencyOf)) merged.dependencyOf = [...(merged.dependencyOf || []), dependencyOf];
  profile.mods = old ? profile.mods.map(m => (m.uid === uid ? merged : m)) : [...profile.mods, merged];
  games.saveProfile(key, profile);
  installer.pruneOldVersions(game, merged, store.settings().keepOldVersions);
  result.installed.push(`${info.name} ${v.version || ''}`.trim());
  refreshDeployed(key, profileName);
  emit('profile', { key, profile: profileName });
  return result;
}

// If this profile is the one currently in the game folder, put the change there now,
// so starting the game outside ModHaven (e.g. from Steam) also gets the updated files.
function refreshDeployed(key, profileName) {
  try {
    const game = games.get(key);
    const dep = installer.deployedInfo(game);
    if (!dep || dep.profile !== profileName || launcher.status(key).running) return;
    installer.deploy(game, games.profile(key, profileName));
  } catch (e) { store.log('redeploy after change failed', key, e.message); }
}

async function installLocal(key, profileName, filePath) {
  const game = games.get(key);
  const mod = await installer.stageLocal(game, filePath);
  const profile = games.profile(key, profileName);
  const uid = uidOf('local', mod.id);
  const entry = { uid, source: 'local', id: mod.id, gameId: '', name: mod.name, author: 'You', icon: null, url: null, version: 'local file', versionId: mod.versionId,
    fileName: mod.fileName, modUpdatedAt: new Date().toISOString(), gameVersions: [], enabled: true, order: profile.mods.length, installedAt: new Date().toISOString(), dependencyOf: [], pinned: true, notes: '' };
  profile.mods = [...profile.mods.filter(m => m.uid !== uid), entry];
  games.saveProfile(key, profile);
  emit('profile', { key, profile: profileName });
  return entry;
}

function uninstall(key, profileName, uid, { withDeps = true } = {}) {
  const profile = games.profile(key, profileName);
  const removed = [uid];
  profile.mods = profile.mods.filter(m => m.uid !== uid);
  if (withDeps) {
    // Remove libraries nothing else needs any more (only ones that came in as dependencies).
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of profile.mods) {
        if (!m.dependencyOf || !m.dependencyOf.length) continue;
        const still = m.dependencyOf.filter(u => profile.mods.some(x => x.uid === u));
        if (!still.length) { removed.push(m.uid); profile.mods = profile.mods.filter(x => x !== m); changed = true; }
        else m.dependencyOf = still;
      }
    }
  }
  games.saveProfile(key, profile);
  emit('profile', { key, profile: profileName });
  refreshDeployed(key, profileName);
  return removed;
}

// Update check for one profile; auto-installs when allowed.
async function checkUpdates(key, profileName, { autoInstall } = {}) {
  const game = games.get(key);
  const profile = games.profile(key, profileName);
  const auto = autoInstall ?? store.settings().autoUpdate;
  const updated = [], available = [], errors = [];
  const queue = profile.mods.filter(m => m.source !== 'local');
  const work = async m => {
    const s = source(m.source);
    if (!s || (s.needsKey && !store.settings().keys[s.id])) return;
    try {
      const ctx = ctxFor(s);
      const [versions, info] = await Promise.all([s.getVersions(ctx, m.gameId, m.id), s.getMod(ctx, m.gameId, m.id).catch(() => null)]);
      const v = pickVersion(versions, game, null);
      const p = games.profile(key, profileName);
      const cur = p.mods.find(x => x.uid === m.uid);
      if (!cur) return;
      cur.latest = v ? { versionId: String(v.id), version: v.version, date: v.date } : null;
      cur.lastChecked = new Date().toISOString();
      if (info) { cur.deprecated = !!info.deprecated; if (info.icon) cur.icon = info.icon; }
      games.saveProfile(key, p);
      if (v && String(v.id) !== String(m.versionId) && (!m.modUpdatedAt || !v.date || v.date >= m.modUpdatedAt)) {
        const allow = m.autoUpdate === true || (m.autoUpdate !== false && auto && !m.pinned);
        if (allow) {
          await install(key, profileName, { source: m.source, gameId: m.gameId, modId: m.id, versionId: v.id });
          const p2 = games.profile(key, profileName); const c2 = p2.mods.find(x => x.uid === m.uid);
          if (c2) { c2.pinned = m.pinned; c2.latest = cur.latest; c2.autoUpdatedFrom = m.version; games.saveProfile(key, p2); }
          updated.push(`${m.name} ${m.version} → ${v.version}`);
        } else available.push({ uid: m.uid, name: m.name, from: m.version, to: v.version });
      }
    } catch (e) { errors.push(`${m.name}: ${e.message}`); }
  };
  // A few at a time to stay polite to the APIs.
  for (let i = 0; i < queue.length; i += 4) await Promise.all(queue.slice(i, i + 4).map(work));
  emit('profile', { key, profile: profileName });
  return { updated, available, errors, checkedAt: new Date().toISOString() };
}

async function checkAll() {
  const out = [];
  for (const g of games.list()) {
    for (const p of games.profiles(g.key)) {
      if (!p.mods.length) continue;
      try { out.push({ game: g.name, profile: p.name, ...(await checkUpdates(g.key, p.name)) }); } catch (e) { store.log('update check failed', g.key, e); }
    }
  }
  return out;
}

module.exports = { init, ctxFor, source, install, installLocal, uninstall, checkUpdates, checkAll, uidOf, pickVersion };
