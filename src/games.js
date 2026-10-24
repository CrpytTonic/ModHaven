// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Managed games (the ones you've opened in ModHaven) and their profiles.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const local = require('./localgames');

const gdir = (key, ...p) => store.root('games', store.safeName(key), ...p);

function list() {
  let dirs = [];
  try { dirs = fs.readdirSync(store.root('games')); } catch { }
  return dirs.map(d => store.readJson(store.root('games', d, 'game.json'), null)).filter(Boolean)
    .sort((a, b) => (b.lastOpened || '').localeCompare(a.lastOpened || ''));
}

const get = key => store.readJson(gdir(key, 'game.json'), null);

function save(game) {
  store.writeJson(gdir(game.key, 'game.json'), game);
  return game;
}

// Create or refresh a managed game from a catalog entry.
async function open(entry) {
  let g = get(entry.key);
  const inst = entry.installed;
  if (!g) {
    g = {
      key: entry.key, name: entry.name, image: entry.image, images: entry.images || [], sources: entry.sources, urls: entry.urls,
      steamAppId: entry.steamAppId || null,
      installPath: inst ? inst.installPath : null,
      exe: inst ? (inst.exe || local.guessExe(inst.installPath, entry.name)) : null,
      args: '', launchVia: inst && inst.store === 'steam' ? 'steam' : inst && inst.store === 'epic' ? 'epic' : 'exe',
      launchUri: inst && inst.launchUri || null,
      layout: 'auto', customDir: '', store: inst ? inst.store : null,
      gameVersion: null, gameVersionUpdatedAt: null, versionHistory: [],
      activeProfile: null, mcVersion: '', mcLoader: '',
      created: new Date().toISOString(),
    };
  } else {
    g.sources = { ...g.sources, ...entry.sources };
    g.urls = { ...(g.urls || {}), ...(entry.urls || {}) };
    if (entry.images && entry.images.length) { g.images = entry.images; g.image = entry.image; }
    else if (!g.image) g.image = entry.image;
    if (inst && !g.installPath) {
      g.installPath = inst.installPath;
      g.exe = g.exe || inst.exe || local.guessExe(inst.installPath, entry.name);
      g.store = inst.store;
    }
  }
  g.lastOpened = new Date().toISOString();
  await refreshVersion(g);
  save(g);
  ensureDefaultProfile(g.key);
  return g;
}

// Reads the current game version; returns {changed, from, to}.
async function refreshVersion(g) {
  let version = null, updatedAt = null;
  if (g.layout === 'minecraft' || g.key === 'minecraft') {
    version = g.mcVersion || null;
  } else {
    if (g.store === 'steam' || g.steamAppId) {
      const st = (await local.scan()).find(x => x.store === 'steam' && String(x.steamAppId) === String(g.steamAppId));
      if (st) { version = st.version; updatedAt = st.versionUpdatedAt; }
    }
    if (!version && g.store && g.store !== 'steam') {
      const st = (await local.scan()).find(x => x.store === g.store && x.installPath === g.installPath);
      if (st && st.version) version = st.version;
    }
    if (!version && g.exe) version = await local.exeVersion(g.exe);
  }
  const from = g.gameVersion;
  const changed = !!(version && from && version !== from);
  if (version && version !== from) {
    g.versionHistory = [...(g.versionHistory || []), { version, seenAt: new Date().toISOString(), from }].slice(-30);
    g.gameVersion = version;
    g.gameVersionUpdatedAt = updatedAt || new Date().toISOString();
  }
  if (changed) g.versionChangedNotice = { from, to: version, at: new Date().toISOString() };
  return { changed, from, to: version };
}

// ---------- profiles ----------
const pdir = (key, name, ...p) => gdir(key, 'profiles', store.safeName(name), ...p);

function profiles(key) {
  let dirs = [];
  try { dirs = fs.readdirSync(gdir(key, 'profiles')); } catch { }
  return dirs.map(d => store.readJson(gdir(key, 'profiles', d, 'profile.json'), null)).filter(Boolean)
    .sort((a, b) => (a.name === 'Default' ? -1 : b.name === 'Default' ? 1 : a.name.localeCompare(b.name)));
}
const profile = (key, name) => store.readJson(pdir(key, name, 'profile.json'), null);
function saveProfile(key, p) {
  p.modified = new Date().toISOString();
  store.writeJson(pdir(key, p.name, 'profile.json'), p);
  return p;
}
function ensureDefaultProfile(key) {
  if (!profile(key, 'Default')) saveProfile(key, { name: 'Default', created: new Date().toISOString(), mods: [] });
}
function createProfile(key, name, fromName) {
  name = String(name || '').trim();
  if (!name) throw new Error('Profile needs a name');
  if (profile(key, name)) throw new Error(`A profile called "${name}" already exists`);
  const src = fromName ? profile(key, fromName) : null;
  const p = { name, created: new Date().toISOString(), mods: src ? JSON.parse(JSON.stringify(src.mods)) : [] };
  saveProfile(key, p);
  if (src) copyDir(pdir(key, fromName, 'config'), pdir(key, name, 'config'));
  return p;
}
function renameProfile(key, from, to) {
  to = String(to || '').trim();
  if (!to) throw new Error('Profile needs a name');
  if (from === to) return profile(key, from);
  if (profile(key, to)) throw new Error(`A profile called "${to}" already exists`);
  fs.renameSync(pdir(key, from), pdir(key, to));
  const p = profile(key, to); p.name = to; saveProfile(key, p);
  const g = get(key);
  if (g.activeProfile === from) { g.activeProfile = to; save(g); }
  return p;
}
function deleteProfile(key, name) {
  if (name === 'Default') throw new Error('The Default profile can\'t be deleted (you can clear it instead)');
  fs.rmSync(pdir(key, name), { recursive: true, force: true });
  const g = get(key);
  if (g.activeProfile === name) { g.activeProfile = 'Default'; save(g); }
}

// Share code = base64 JSON of the mod list (like Thunderstore profile codes, but offline).
function exportProfile(key, name) {
  const p = profile(key, name);
  const data = { v: 1, game: key, name: p.name, mods: p.mods.map(m => ({ s: m.source, i: m.id, g: m.gameId, n: m.name, v: m.versionId, ver: m.version, e: m.enabled ? 1 : 0 })) };
  return 'MODHAVEN1:' + Buffer.from(JSON.stringify(data)).toString('base64');
}
function parseShareCode(code) {
  const m = String(code || '').trim().match(/^MODHAVEN1:([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('That is not a ModHaven profile code');
  return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

module.exports = { list, get, save, open, refreshVersion, profiles, profile, saveProfile, ensureDefaultProfile,
  createProfile, renameProfile, deleteProfile, exportProfile, parseShareCode, gdir, pdir, copyDir };
