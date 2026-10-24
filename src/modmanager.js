// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Install / uninstall / update mods in a profile, including dependencies.
const fs = require('fs');
const store = require('./store');
const games = require('./games');
const installer = require('./installer');
const net = require('./net');
const launcher = require('./launcher');
const gv = require('./gameversion');

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
  if (s.noStore) stripStored(entry);
  const gameList = game.steamAppId ? await gv.steamVersions(game.steamAppId).catch(() => []) : [];
  await installer.stageMod(game, entry, dl);
  profile = games.profile(key, profileName); // re-read: dependencies may have changed it
  const old = profile.mods.find(m => m.uid === uid);
  const keep = old ? { enabled: old.enabled, order: old.order, notes: old.notes, pinned: (!!versionId && !nxm) || old.pinned, autoUpdate: old.autoUpdate, dependencyOf: old.dependencyOf, installedAt: old.installedAt, modFolder: old.modFolder || installer.modFolderOf((old.adopted && old.adopted.files) || old.deployedFiles), adopted: old.adopted ? { ...old.adopted, replacedAt: new Date().toISOString() } : undefined } : {};
  const merged = {
    ...entry, enabled: true, order: profile.mods.length, installedAt: new Date().toISOString(),
    dependencyOf: dependencyOf ? [dependencyOf] : [], pinned: !!versionId, autoUpdate: null, notes: '',
    ...keep, updatedLocallyAt: new Date().toISOString(), previousVersionId: old ? old.versionId : null, latest: null,
  };
  if (dependencyOf && !(merged.dependencyOf || []).includes(dependencyOf)) merged.dependencyOf = [...(merged.dependencyOf || []), dependencyOf];
  // Fill in which game version this release is for straight away (site list, page text, or release date).
  try {
    const listed = v.gameVersions && v.gameVersions.length ? v.gameVersions : null;
    const stated = listed ? null : gv.statedGameVersion([v.title, v.description, v.changelog, info.summary, info.description], gameList, versions.map(x => x.version));
    const est = gv.versionAt(gameList, v.date);
    merged.madeFor = listed ? { version: listed.slice(0, 6).join(', '), how: 'listed' } : stated ? { version: stated.version, how: 'stated', quote: stated.quote } : est ? { version: est.version, how: 'estimated' } : null;
    merged.latest = merged.latest || { versionId: String(v.id), version: v.version, date: v.date };
  } catch { }
  delete merged.versionGuess; delete merged.mismatchBy; delete merged.fileDate; delete merged.variant;
  profile.mods = old ? profile.mods.map(m => (m.uid === uid ? merged : m)) : [...profile.mods, merged];
  games.saveProfile(key, profile);
  installer.pruneOldVersions(game, merged, store.settings().keepOldVersions);
  result.installed.push(`${info.name} ${v.version || ''}`.trim());
  refreshDeployed(key, profileName);
  emit('profile', { key, profile: profileName });
  return result;
}

// Sites whose terms forbid storing their data: a profile keeps only the ids, version and
// file name needed to know what is installed; description and pictures are fetched when shown.
function stripStored(entry) {
  entry.summary = '';
  entry.icon = null;
  entry.categories = [];
  entry.gameVersions = [];
  entry.loaders = [];
  return entry;
}

// Exact match: the release whose download contains the user's files byte for byte (Nexus publishes
// a SHA1 for every file in every download). Returns { version } | { mismatch: true } | null (can't tell).
const MATCH_FILE = /\.(pak|ucas|utoc|dll|asi|lua|jar|esp|esm|esl|bsa|ba2)$/i;
async function identifyExact(game, s, entry, versions) {
  const dir = installer.findStage(game, entry);
  if (!dir) return null;
  return matchFiles(s, installer.walkFiles(dir).map(f => require('path').join(dir, f)), versions);
}

// Fingerprints of the files that identify a mod (skips stubs, text and tiny files).
function fingerprints(absFiles) {
  const crypto = require('crypto');
  const set = new Set(absFiles.map(f => f.toLowerCase()));
  return absFiles.filter(f => MATCH_FILE.test(f))
    .filter(f => !(/\.pak$/i.test(f) && set.has(f.toLowerCase().replace(/\.pak$/, '.ucas'))))
    .filter(f => { try { return fs.statSync(f).size >= 1024; } catch { return false; } })
    .map(f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'));
}

async function matchFiles(s, absFiles, versions) {
  if (!s.manifestFor || !versions || !versions.length) return null;
  const mine = fingerprints(absFiles);
  if (!mine.length) return null;
  const ctx = ctxFor(s);
  let checked = 0, best = null;
  for (const v of versions.slice(0, 40)) {
    const man = await s.manifestFor(ctx, v);
    if (!man) continue;
    checked++;
    const hashes = new Set(man.map(f => f.sha1).filter(Boolean));
    if (!hashes.size) continue;
    const hit = mine.filter(h => hashes.has(h)).length;
    if (hit && (!best || hit > best.hit || (hit === best.hit && String(v.date) > String(best.v.date)))) best = { v, hit };
    if (hit === mine.length) break; // every file matched: that's the one
  }
  if (best && best.hit === mine.length) return { version: best.v };
  if (best) return { version: best.v, partial: true };
  // Read every release and none contains any of the user's files: not this mod.
  if (checked && checked === Math.min(versions.length, 40)) return { mismatch: true };
  return null;
}

// Newest release of the same variant (e.g. "NoCarryCapacity" vs "NoCarryCapacityUnlimited" on one page).
function newestOfVariant(versions, installed) {
  if (!installed) return null;
  const fam = v => String(v.title || v.fileName || '').toLowerCase().replace(/[\s_-]*v?\d+([._]\d+)*.*$/, '').replace(/[^a-z0-9]/g, '');
  const same = versions.filter(v => !v.archived && ((installed.group && v.group === installed.group) || (!installed.group && fam(v) && fam(v) === fam(installed))));
  return same.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
}

// The installed release of a mod the user installed by hand: the newest release published on or
// before the date of their files (nobody can have a release from after they got the files).
function guessByFileDate(game, entry, versions) {
  if (!versions || !versions.length) return null;
  let newest = 0;
  try {
    const dir = installer.stageDir(game, entry);
    for (const f of installer.walkFiles(dir)) {
      if (f === '.staged' || /\.(txt|md|ini|json|cfg|log)$/i.test(f)) continue;
      newest = Math.max(newest, fs.statSync(require('path').join(dir, f)).mtimeMs);
    }
  } catch { return null; }
  if (!newest) return null;
  const limit = newest + 36e5; // allow an hour for clock / time-zone rounding
  const before = versions.filter(v => v.date && Date.parse(v.date) <= limit && !v.archived)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  // Every release is newer than the user's files: their files can't be this mod (a wrong link).
  if (!before.length && versions.some(v => v.date)) return { mismatch: true, fileDate: new Date(newest).toISOString() };
  return before[0] || null;
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

async function installFileFor(key, profileName, uid, filePath) {
  const game = games.get(key);
  const p = games.profile(key, profileName);
  const e = p.mods.find(m => m.uid === uid);
  if (!e) throw new Error('Mod not found in this profile');
  const staged = await installer.stageFileFor(game, e, filePath);
  Object.assign(e, { versionId: staged.versionId, fileName: staged.fileName, rawLayout: false, version: e.latest && e.latest.version ? e.latest.version + ' (file)' : 'downloaded file',
    updatedLocallyAt: new Date().toISOString(), previousVersionId: e.versionId, modUpdatedAt: e.latest && e.latest.date ? e.latest.date : new Date().toISOString() });
  if (e.latest) e.versionId = staged.versionId; // keep "up to date" honest: compare by date below
  games.saveProfile(key, p);
  refreshDeployed(key, profileName);
  emit('profile', { key, profile: profileName });
  return e;
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
      let v = pickVersion(versions, game, null);
      // Network lookups first; then read, change and save the profile with no waiting in between,
      // so the checks running side by side don't overwrite each other's changes.
      const exPre = m.rawLayout && m.versionGuess !== 'exact file' ? await identifyExact(game, s, m, versions) : null;
      const gameList = game.steamAppId ? await gv.steamVersions(game.steamAppId) : [];
      const p = games.profile(key, profileName);
      const cur = p.mods.find(x => x.uid === m.uid);
      if (!cur) return;
      cur.latest = v ? { versionId: String(v.id), version: v.version, date: v.date } : null;
      cur.lastChecked = new Date().toISOString();
      if (info) { cur.deprecated = !!info.deprecated; if (info.icon && !s.noStore) cur.icon = info.icon; }
      // Mods taken over from the game folder: find which release the user has. Exact file match first
      // (also redone for earlier estimates), the files' date as a fallback.
      let guess = null;
      if (cur.rawLayout && cur.versionGuess !== 'exact file') {
        const ex = exPre;
        if (ex && ex.mismatch) guess = { mismatch: true, how: 'files' };
        else if (ex && ex.version) guess = { ...ex.version, exact: !ex.partial };
      }
      if (!guess && String(cur.versionId).startsWith('adopted-')) guess = guessByFileDate(game, cur, versions);
      if (guess && !guess.mismatch && guess.exact) {
        const nv = newestOfVariant(versions, guess);
        if (nv) cur.latest = { versionId: String(nv.id), version: nv.version, date: nv.date };
      } else if (cur.versionGuess === 'exact file' && cur.variant) {
        const nv = newestOfVariant(versions, cur.variant);
        if (nv) cur.latest = { versionId: String(nv.id), version: nv.version, date: nv.date };
      }
      if (guess && guess.mismatch) {
        // Not this page's files: don't show a version or date taken from it (the stored copy keeps its folder).
        Object.assign(cur, { versionGuess: 'mismatch', fileDate: guess.fileDate || cur.fileDate || null, mismatchBy: guess.how || 'date', version: 'unknown', modUpdatedAt: null, variant: null });
      }
      else if (guess) {
        // The stored copy is filed by version id: move it along, or deploy can't find it.
        const oldDir = installer.findStage(game, cur);
        Object.assign(cur, { versionId: String(guess.id), version: guess.version, modUpdatedAt: guess.date, versionGuess: guess.exact ? 'exact file' : 'file date',
          variant: guess.exact ? { group: guess.group || null, title: guess.title || null, fileName: guess.fileName || null } : cur.variant || null });
        const newDir = installer.stageDir(game, cur);
        if (oldDir && oldDir !== newDir && !fs.existsSync(newDir)) fs.renameSync(oldDir, newDir);
        m = { ...m, versionId: cur.versionId, version: cur.version, modUpdatedAt: cur.modUpdatedAt };
      }
      // Game version the installed release was made for: what the site lists, what the page says, or the
      // game's public version on the day the release came out.
      {
        const inst = versions.find(x => String(x.id) === String(cur.versionId)) || null;
        const listed = inst && inst.gameVersions && inst.gameVersions.length ? inst.gameVersions : null;
        const stated = listed ? null : gv.statedGameVersion([inst && inst.title, inst && inst.description, inst && inst.changelog, info && info.summary, info && info.description], gameList, versions.map(x => x.version));
        const est = gv.versionAt(gameList, cur.modUpdatedAt || (inst && inst.date));
        cur.madeFor = listed ? { version: listed.slice(0, 6).join(', '), how: 'listed' }
          : stated ? { version: stated.version, how: 'stated', quote: stated.quote }
            : est && cur.versionGuess !== 'mismatch' ? { version: est.version, how: 'estimated' } : null;
      }
      games.saveProfile(key, p);
      if (cur.latest && cur.versionGuess === 'exact file') { const lv = versions.find(x => String(x.id) === String(cur.latest.versionId)); if (lv) v = lv; }
      const fromFile = String(m.versionId).startsWith('file-') && m.modUpdatedAt && v && v.date && v.date <= m.modUpdatedAt;
      // Never "update" a mod whose link looks wrong: it would replace the user's mod with a different one.
      const wrongLink = cur.versionGuess === 'mismatch';
      if (v && !fromFile && !wrongLink && String(v.id) !== String(m.versionId) && (!m.modUpdatedAt || !v.date || v.date >= m.modUpdatedAt)) {
        const allow = m.autoUpdate === true || (m.autoUpdate !== false && auto && !m.pinned);
        if (allow) {
          const res = await install(key, profileName, { source: m.source, gameId: m.gameId, modId: m.id, versionId: v.id });
          if (!res.installed.length && res.manual.length) { available.push({ uid: m.uid, name: m.name, from: m.version, to: v.version, pageUrl: res.manual[0].pageUrl, manual: true }); return; }
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

module.exports = { matchFiles, installFileFor, stripStored, init, ctxFor, source, install, installLocal, uninstall, checkUpdates, checkAll, uidOf, pickVersion };
