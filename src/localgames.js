// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Finds games installed through Steam, Epic and GOG, and reads their version.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const run = (cmd, args) => new Promise(res => execFile(cmd, args, { windowsHide: true, maxBuffer: 8 << 20 }, (err, out) => res(err ? '' : String(out))));

async function regValues(key) {
  const out = await run('reg', ['query', key]);
  const vals = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s+(\S[^\t]*?)\s+REG_\w+\s+(.*)$/);
    if (m) vals[m[1].trim()] = m[2].trim();
  }
  return vals;
}
async function regSubkeys(key) {
  const out = await run('reg', ['query', key]);
  return out.split(/\r?\n/).filter(l => l.startsWith('HKEY_') && l.toUpperCase() !== key.toUpperCase());
}

// Minimal Valve KeyValues parser (libraryfolders.vdf / appmanifest .acf).
function parseVdf(text) {
  const tokens = [...text.matchAll(/"((?:[^"\\]|\\.)*)"|([{}])/g)].map(m => m[2] || m[1].replace(/\\\\/g, '\\'));
  let i = 0;
  const obj = () => {
    const o = {};
    while (i < tokens.length) {
      const t = tokens[i++];
      if (t === '}') return o;
      const v = tokens[i++];
      if (v === '{') o[t] = obj(); else o[t] = v;
    }
    return o;
  };
  return obj();
}

// Steam keeps every owned game's artwork in appcache/librarycache/<appid>/ (newer clients
// put each file in a hashed subfolder). Box art = library_capsule / library_600x900.
const STEAM_ART = [
  [/^library_(capsule|600x900)(_2x)?.(jpg|png)$/i, 'portrait'],
  [/^(library_header|header)(_2x)?.(jpg|png)$/i, 'wide'],
  [/^library_hero.(jpg|png)$/i, 'wide'],
];
function steamLocalArt(steamPath, appid) {
  const dir = path.join(steamPath, 'appcache', 'librarycache', String(appid));
  const found = [];
  const look = (d, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory() && depth < 1) look(path.join(d, e.name), depth + 1);
      else if (e.isFile()) {
        const rule = STEAM_ART.findIndex(([re]) => re.test(e.name));
        if (rule >= 0) found.push({ rule, file: path.join(d, e.name), kind: STEAM_ART[rule][1] });
      }
    }
  };
  // Flat files too (older clients): <appid>_library_600x900.jpg in librarycache itself.
  for (const [suffix, kind, rule] of [['_library_600x900.jpg', 'portrait', 0], ['_header.jpg', 'wide', 1], ['_library_hero.jpg', 'wide', 2]]) {
    const f = path.join(steamPath, 'appcache', 'librarycache', appid + suffix);
    if (fs.existsSync(f)) found.push({ rule, file: f, kind });
  }
  look(dir, 0);
  // Within a kind, the sharper copy first (600x900 / _2x over the 300x450 capsule).
  const sharp = f => (/_2x.|600x900/i.test(path.basename(f.file)) ? 0 : 1);
  const seen = new Set();
  return found.sort((a, b) => a.rule - b.rule || sharp(a) - sharp(b))
    .filter(f => !seen.has(f.file.toLowerCase()) && seen.add(f.file.toLowerCase())).map(f => ({ url: pathToFileURL(f.file).href, kind: f.kind }));
}

async function steamGames() {
  const vals = await regValues('HKCU\\Software\\Valve\\Steam');
  let steamPath = vals.SteamPath;
  if (!steamPath) {
    const lm = await regValues('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam');
    steamPath = lm.InstallPath;
  }
  if (!steamPath) return [];
  steamPath = path.normalize(steamPath);
  const libs = new Set([steamPath]);
  try {
    const vdf = parseVdf(fs.readFileSync(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
    const lf = vdf.libraryfolders || vdf.LibraryFolders || {};
    for (const v of Object.values(lf)) {
      if (typeof v === 'string' && /[\\/]/.test(v)) libs.add(path.normalize(v));
      else if (v && v.path) libs.add(path.normalize(v.path));
    }
  } catch { }
  const games = [];
  for (const lib of libs) {
    const apps = path.join(lib, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(apps).filter(f => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const st = parseVdf(fs.readFileSync(path.join(apps, f), 'utf8')).AppState;
        if (!st || !st.installdir) continue;
        const dir = path.join(apps, 'common', st.installdir);
        if (!fs.existsSync(dir)) continue;
        if (/^(Steamworks Common Redistributables|Proton|Steam Linux Runtime)/i.test(st.name || '')) continue;
        games.push({
          store: 'steam', storeId: st.appid, name: st.name, installPath: dir,
          version: st.buildid ? `build ${st.buildid}` : null,
          versionUpdatedAt: st.LastUpdated ? new Date(Number(st.LastUpdated) * 1000).toISOString() : null,
          steamAppId: st.appid,
          buildId: st.buildid || null,
          updatePending: !!(st.TargetBuildID && st.buildid && Number(st.TargetBuildID) > Number(st.buildid)),
          art: steamLocalArt(steamPath, st.appid),
        });
      } catch { }
    }
  }
  return games;
}

async function epicGames() {
  const dir = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.item')); } catch { return []; }
  const games = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!j.InstallLocation || !fs.existsSync(j.InstallLocation)) continue;
      if ((j.AppCategories || []).includes('addons')) continue;
      games.push({
        store: 'epic', storeId: j.AppName, name: j.DisplayName, installPath: j.InstallLocation,
        exe: j.LaunchExecutable ? path.join(j.InstallLocation, j.LaunchExecutable) : null,
        version: j.AppVersionString || null, versionUpdatedAt: null,
        launchUri: `com.epicgames.launcher://apps/${j.CatalogNamespace}%3A${j.CatalogItemId}%3A${j.AppName}?action=launch&silent=true`,
      });
    } catch { }
  }
  return games;
}

async function gogGames() {
  const base = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games';
  const games = [];
  for (const key of await regSubkeys(base)) {
    const v = await regValues(key);
    if (!v.path || !fs.existsSync(v.path)) continue;
    games.push({ store: 'gog', storeId: v.gameID, name: v.gameName || v.GAMENAME, installPath: v.path,
      exe: v.exe || null, version: v.ver || null, versionUpdatedAt: null });
  }
  return games;
}

let cache = null;
async function scan(force) {
  if (cache && !force) return cache;
  const lists = await Promise.all([steamGames(), epicGames(), gogGames()].map(p => p.catch(() => [])));
  cache = lists.flat().filter(g => g && g.name).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return cache;
}

const EXE_SKIP = /^(unins|UnityCrashHandler|CrashReport|crashpad|vc_?redist|dxsetup|dotnet|setup|launcher_?helper|EasyAntiCheat|BEService|createdump|REDprelauncher|QuickSFV)/i;

// Best guess at the main exe: biggest non-helper .exe up to two levels deep.
function guessExe(dir, name) {
  const found = [];
  const walk = (d, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 2 && !/^(redist|_commonredist|directx|support|tools|BepInEx|MelonLoader|engine)$/i.test(e.name)) walk(p, depth + 1);
      else if (e.isFile() && /\.exe$/i.test(e.name) && !EXE_SKIP.test(e.name)) {
        try { found.push({ p, size: fs.statSync(p).size, depth }); } catch { }
      }
    }
  };
  walk(dir, 0);
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(name);
  found.sort((a, b) => {
    const am = n && norm(path.basename(a.p, '.exe')) === n ? 1 : 0, bm = n && norm(path.basename(b.p, '.exe')) === n ? 1 : 0;
    return bm - am || a.depth - b.depth || b.size - a.size;
  });
  return found[0] ? found[0].p : null;
}

// File version of an exe (falls back to its modified time).
async function exeVersion(exe) {
  if (!exe || !fs.existsSync(exe)) return null;
  const ps = `$v=(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo; if($v.ProductVersion){$v.ProductVersion}elseif($v.FileVersion){$v.FileVersion}`;
  const out = (await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps])).trim();
  if (out) return out.split(/\r?\n/)[0].trim();
  try { return 'exe ' + fs.statSync(exe).mtime.toISOString().slice(0, 10); } catch { return null; }
}

// Unity game? -> has <Name>_Data/ next to exe. Used to pick BepInEx layout + Player.log path.
function engineInfo(installPath, exe) {
  const info = { engine: 'unknown', unityData: null, company: null, product: null };
  try {
    const ents = fs.readdirSync(installPath);
    const data = ents.find(e => /_Data$/i.test(e) && fs.existsSync(path.join(installPath, e, 'globalgamemanagers')));
    if (data) {
      info.engine = 'unity';
      info.unityData = path.join(installPath, data);
      // app.info = "Company\nProduct"
      try {
        const [company, product] = fs.readFileSync(path.join(info.unityData, 'app.info'), 'utf8').split(/\r?\n/);
        info.company = company; info.product = product;
      } catch { }
    } else if (ents.some(e => /^Engine$/i.test(e)) && ents.some(e => fs.existsSync(path.join(installPath, e, 'Binaries')))) {
      info.engine = 'unreal';
    } else if (ents.some(e => /^Data$/i.test(e)) && ents.some(e => /\.(esm|esl)$/i.test(e) || /skse|f4se/i.test(e)) || fs.existsSync(path.join(installPath, 'Data', 'Skyrim.esm')) || fs.existsSync(path.join(installPath, 'Data', 'Fallout4.esm'))) {
      info.engine = 'creation';
    }
  } catch { }
  return info;
}

module.exports = { scan, guessExe, exeVersion, engineInfo, parseVdf, steamGames };
