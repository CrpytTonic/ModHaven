// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Portable data folder + small JSON store helpers.
const fs = require('fs');
const path = require('path');

let ROOT = null;

const DEFAULT_SETTINGS = {
  theme: 'dark',              // 'dark' | 'light' | 'system'
  accent: '#7c5cff',
  density: 'comfortable',     // 'comfortable' | 'compact'
  keys: { curseforge: '', nexus: '' },
  sources: { thunderstore: true, modrinth: true, gamebanana: true, curseforge: true, nexus: true },
  autoUpdate: true,           // download mod updates automatically
  checkUpdatesOnStart: true,
  updateIntervalMin: 60,
  showNsfw: false,
  hideDeprecated: true,
  deployMode: 'hardlink',     // 'hardlink' | 'copy'
  pageSize: 40,
  autoTestSeconds: 90,        // "survived this long" = passing run during culprit search
  closeGameAfterAutoTest: true,
  minimizeOnLaunch: true,     // minimise ModHaven while a game it started is running
  hardwareAcceleration: true, // GPU-drawn window; off = less memory, a little more CPU (needs a restart)
  keepOldVersions: 3,
  nxmHandler: false,
  lastGame: null,
  settingsRev: 2,
};

function init(appDir, fallbackDir) {
  const candidates = [process.env.MH_DATA ? appDir : path.join(appDir, 'ModHaven Data'), path.join(fallbackDir, 'ModHaven')];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      ROOT = dir;
      break;
    } catch { /* read-only, try next */ }
  }
  if (!ROOT) throw new Error('No writable data folder');
  for (const d of ['cache', 'downloads', 'games', 'logs']) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
  return ROOT;
}

const root = (...p) => path.join(ROOT, ...p);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

let settingsCache = null;
function settings() {
  if (!settingsCache) {
    const saved = readJson(root('settings.json'), {});
    // Rev 2: "minimise while a game runs" became the default; older files saved the old default
    // (there was no switch for it before), so it is turned on once.
    if (!(saved.settingsRev >= 2)) { delete saved.minimizeOnLaunch; saved.settingsRev = 2; }
    settingsCache = { ...DEFAULT_SETTINGS, ...saved,
      keys: { ...DEFAULT_SETTINGS.keys, ...(saved.keys || {}) },
      sources: { ...DEFAULT_SETTINGS.sources, ...(saved.sources || {}) } };
  }
  return settingsCache;
}
// Pasted keys often come with spaces, line breaks, quotes or an "x-api-key:" label in front.
const cleanKey = k => String(k || '').trim().replace(/^(x-api-key|apikey|api[-_ ]?key)\s*[:=]\s*/i, '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
function saveSettings(patch) {
  const s = settings();
  if (patch.keys) patch = { ...patch, keys: Object.fromEntries(Object.entries(patch.keys).map(([k, v]) => [k, cleanKey(v)])) };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && s[k] && typeof s[k] === 'object') s[k] = { ...s[k], ...v };
    else s[k] = v;
  }
  writeJson(root('settings.json'), s);
  return s;
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try { fs.appendFileSync(root('logs', 'modhaven.log'), line); } catch { }
}

const safeName = s => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+$/,'').slice(0, 120) || '_';

module.exports = { init, root, readJson, writeJson, settings, saveSettings, log, safeName, DEFAULT_SETTINGS, get ROOT() { return ROOT; } };
