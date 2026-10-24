// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Downloads, unpacks and stages mods, then deploys a profile's enabled mods into the game folder.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');
const store = require('./store');
const games = require('./games');
const net = require('./net');

let emit = () => { };
function setEmitter(fn) { emit = fn; }

// ---------- downloads ----------
const downloads = new Map(); // id -> state shown in the Downloads panel
function dlState() { return [...downloads.values()].sort((a, b) => b.started - a.started).slice(0, 100); }
// Keeps the panel's list (and memory) bounded: the oldest finished entries go first.
function trimDownloads() {
  if (downloads.size <= 150) return;
  for (const [k, v] of [...downloads].sort((a, b) => a[1].started - b[1].started)) {
    if (downloads.size <= 100) break;
    if (v.state !== 'downloading') downloads.delete(k);
  }
}

async function download(url, dest, { name, headers } = {}) {
  const id = crypto.randomUUID();
  const st = { id, name: name || path.basename(dest), received: 0, total: 0, state: 'downloading', started: Date.now(), error: null };
  downloads.set(id, st);
  trimDownloads();
  emit('downloads', dlState());
  const tmp = dest + '.part';
  let out = null;
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const res = await net.request(url, { headers: { Accept: '*/*', ...(headers || {}) }, timeout: 120000 });
    st.total = Number(res.headers.get('content-length')) || 0;
    out = fs.createWriteStream(tmp);
    // A write error (disk full...) would otherwise be an unhandled 'error' event.
    let writeErr = null;
    out.on('error', e => { writeErr = e; });
    let lastEmit = 0;
    for await (const chunk of res.body) {
      if (writeErr) throw writeErr;
      if (!out.write(chunk)) {
        await new Promise((r, j) => {
          const ok = () => { out.off('error', bad); r(); };
          const bad = e => { out.off('drain', ok); j(e); };
          out.once('drain', ok); out.once('error', bad);
        });
      }
      st.received += chunk.length;
      if (Date.now() - lastEmit > 150) { lastEmit = Date.now(); emit('downloads', dlState()); }
    }
    if (writeErr) throw writeErr;
    await new Promise((r, j) => out.end(err => (err ? j(err) : r())));
    if (st.total && st.received < st.total) throw new Error(`Download ended early (${st.received} of ${st.total} bytes)`);
    fs.renameSync(tmp, dest);
    st.state = 'done';
    return dest;
  } catch (e) {
    st.state = 'error'; st.error = e.message;
    // Close the half-written file so it isn't held open (and can be retried / cleared).
    if (out && !out.closed) await new Promise(r => { out.once('close', r); out.destroy(); setTimeout(r, 2000); });
    try { fs.rmSync(tmp, { force: true }); } catch { }
    throw e;
  } finally {
    emit('downloads', dlState());
  }
}
function markDownload(name, state, error) {
  const id = crypto.randomUUID();
  downloads.set(id, { id, name, received: 0, total: 0, state, started: Date.now(), error: error || null });
  trimDownloads();
  emit('downloads', dlState());
}
function clearDownloads() {
  for (const [k, v] of downloads) if (v.state !== 'downloading') downloads.delete(k);
  emit('downloads', dlState());
}

// ---------- archives ----------
function find7z() {
  for (const p of ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe']) if (fs.existsSync(p)) return { exe: p, rar: true };
  try {
    let p = require('7zip-bin').path7za;
    p = p.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(p)) return { exe: p, rar: false };
  } catch { }
  return null;
}

async function extract(file, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(file).toLowerCase();
  const head = Buffer.alloc(8);
  const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const is7z = head.slice(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
  const isRar = head.slice(0, 4).toString('latin1') === 'Rar!';
  if (isZip && ext !== '.jar') {
    const zip = new AdmZip(file);
    for (const e of zip.getEntries()) {
      const rel = e.entryName.replace(/\\/g, '/');
      const target = path.resolve(dir, rel);
      if (!target.startsWith(path.resolve(dir) + path.sep)) continue; // zip-slip guard
      if (e.isDirectory) { fs.mkdirSync(target, { recursive: true }); continue; }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, e.getData());
    }
    return dir;
  }
  if (is7z || isRar) {
    const z = find7z();
    if (!z || (isRar && !z.rar)) throw new Error(isRar ? 'This mod is a .rar archive. Install 7-Zip (7-zip.org) so ModHaven can unpack it.' : 'No 7-Zip found to unpack this .7z file');
    await new Promise((res, rej) => execFile(z.exe, ['x', '-y', `-o${dir}`, file], { windowsHide: true, maxBuffer: 16 << 20 }, err => (err ? rej(new Error('Unpacking failed: ' + err.message)) : res())));
    // Same zip-slip check after the fact: 7z already refuses absolute paths; drop anything odd.
    return dir;
  }
  // Single file mod (.dll, .jar, .pak, .esp, ...)
  fs.copyFileSync(file, path.join(dir, path.basename(file)));
  return dir;
}

// ---------- layout ----------
function walkFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, base, out);
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

function resolveLayout(game) {
  if (game.layout && game.layout !== 'auto') return game.layout;
  if (game.key === 'minecraft') return 'minecraft';
  const ip = game.installPath || '';
  if (ip && fs.existsSync(path.join(ip, 'MelonLoader'))) return 'melonloader';
  if (game.sources && game.sources.thunderstore) return 'bepinex';
  if (ip && fs.existsSync(path.join(ip, 'BepInEx'))) return 'bepinex';
  if (ip && fs.existsSync(path.join(ip, 'Data')) && fs.readdirSync(path.join(ip, 'Data')).some(f => /\.(esm|esp|esl)$/i.test(f))) return 'data';
  if (ip && unrealProject(ip)) return 'unreal';
  return 'root';
}

// Unreal games keep their content in <installPath>/<Project>/Content/Paks.
function unrealProject(ip) {
  let ents = [];
  try { ents = fs.readdirSync(ip, { withFileTypes: true }); } catch { return null; }
  const d = ents.find(e => e.isDirectory() && !/^(Engine)$/i.test(e.name) && fs.existsSync(path.join(ip, e.name, 'Content', 'Paks')));
  return d ? d.name : null;
}

// Where a game's mod files go. Returns absolute target root (game folder, or custom).
function targetRoot(game, layout) {
  if (layout === 'minecraft') return game.customDir || path.join(process.env.APPDATA || '', '.minecraft');
  if (layout === 'custom') return game.customDir || game.installPath;
  return game.installPath;
}

const TOP_JUNK = /^(readme|changelog|license|credits)[^/]*$|^(icon\.png|manifest\.json)$/i;

// Maps every staged file to its path relative to the target root.
function mapFiles(stageDir, mod, layout, game) {
  const files = walkFiles(stageDir).filter(f => f !== '.staged');
  // Adopted mods were found in the game folder: their files go back to exactly where they were.
  if (mod.rawLayout) return files.map(f => ({ src: path.join(stageDir, f), rel: f }));
  const top = new Set(files.map(f => f.split('/')[0]));
  const map = [];
  const add = (src, rel) => map.push({ src: path.join(stageDir, src), rel: rel.replace(/\\/g, '/') });
  // Strip one wrapper folder (e.g. "MyMod-1.2/...") when everything is inside it.
  let strip = '';
  if (top.size === 1 && files.every(f => f.includes('/'))) {
    const only = [...top][0];
    if (!/^(BepInEx|plugins|patchers|config|core|Data|Mods|Plugins|UserLibs|UserData|mods|Engine|Content|Paks|~mods|LogicMods|Binaries|Win64|ue4ss)$/i.test(only)) strip = only + '/';
  }
  const rest = f => (strip && f.startsWith(strip) ? f.slice(strip.length) : f);
  const fl = files.map(f => [f, rest(f)]);
  const tops = new Set(fl.map(([, r]) => r.split('/')[0].toLowerCase()));

  if (layout === 'bepinex') {
    const isPack = /BepInExPack|^BepInEx[-_]?(5|6|BepInEx)/i.test(mod.name || mod.id) || /BepInEx-BepInExPack/i.test(mod.id);
    const packDir = fl.map(([, r]) => r.split('/')[0]).find(t => /^BepInExPack/i.test(t));
    const folder = store.safeName(mod.id || mod.name);
    for (const [f, r] of fl) {
      const parts = r.split('/');
      const t0 = parts[0].toLowerCase();
      if (isPack) {
        if (packDir) { if (parts[0] === packDir) add(f, parts.slice(1).join('/')); }
        else if (!TOP_JUNK.test(r)) add(f, r);
      } else if (tops.has('bepinex')) {
        if (t0 === 'bepinex') add(f, r);
        else if (!TOP_JUNK.test(r)) add(f, 'BepInEx/plugins/' + folder + '/' + r);
      } else if (['plugins', 'patchers', 'core', 'monomod'].includes(t0)) {
        add(f, `BepInEx/${t0}/${folder}/${parts.slice(1).join('/')}`);
      } else if (t0 === 'config') {
        add(f, 'BepInEx/config/' + parts.slice(1).join('/'));
      } else {
        add(f, `BepInEx/plugins/${folder}/${r}`);
      }
    }
    return map;
  }
  if (layout === 'melonloader') {
    const known = ['mods', 'plugins', 'userlibs', 'userdata', 'melonloader'];
    for (const [f, r] of fl) {
      const t0 = r.split('/')[0].toLowerCase();
      if (known.includes(t0)) add(f, r);
      else if (/\.dll$/i.test(r)) add(f, 'Mods/' + path.basename(r));
      else if (!TOP_JUNK.test(r)) add(f, 'UserData/' + r);
    }
    return map;
  }
  if (layout === 'data') {
    const dataish = /^(textures|meshes|scripts|interface|sound|music|skse|f4se|seq|strings|materials|shadersfx|lodsettings|grass|video|calientetools|nemesis_engine|actors|dialogueviews)$/i;
    for (const [f, r] of fl) {
      const t0 = r.split('/')[0];
      if (/^data$/i.test(t0)) add(f, 'Data/' + r.split('/').slice(1).join('/'));
      else if (dataish.test(t0) || /\.(esp|esm|esl|bsa|ba2|ini)$/i.test(r)) add(f, 'Data/' + r);
      else if (/\.(dll|exe|asi)$/i.test(r) && !r.includes('/')) add(f, r); // script extender loaders etc.
      else if (!TOP_JUNK.test(r) && !/^(fomod|docs?)\//i.test(r)) add(f, 'Data/' + r);
    }
    return map;
  }
  if (layout === 'unreal') {
    const proj = (game && game.installPath && unrealProject(game.installPath)) || 'Game';
    const bin = `${proj}/Binaries/Win64`;
    const hasUe4ssFolder = game && game._ue4ssFolder !== undefined ? game._ue4ssFolder : !!(game && game.installPath && fs.existsSync(path.join(game.installPath, proj, 'Binaries', 'Win64', 'ue4ss')));
    const ue4ssDir = hasUe4ssFolder ? `${bin}/ue4ss` : bin;
    // Keep the folder the mod already had in ~mods (e.g. "NoCraftedPopup"); otherwise name it after the mod.
    const folder = mod.modFolder || store.safeName(mod.name || mod.id).replace(/\s+/g, '');
    const projRe = new RegExp('^' + proj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/', 'i');
    // UE4SS script mods: a folder holding Scripts/main.lua, enabled.txt or dlls/main.dll
    const luaRoots = new Set(fl.map(([, r]) => r).map(r => (r.match(/^(.*?)(?:^|\/)(?:Scripts\/main\.lua|enabled\.txt|dlls\/main\.dll)$/i) || [])[1]).filter(x => x !== undefined));
    for (const [f, r] of fl) {
      if (projRe.test(r) || /^(Engine)\//i.test(r)) { add(f, r); continue; }                          // already laid out from the game folder
      if (/^(Content|Binaries)\//i.test(r)) { add(f, `${proj}/${r}`); continue; }
      const lua = [...luaRoots].find(root => root === '' ? true : r.startsWith(root + '/'));
      if (lua !== undefined) {
        const rest = lua === '' ? r : r.slice(lua.length + 1);
        const name = lua === '' ? (strip ? strip.slice(0, -1) : store.safeName(mod.name || mod.id).replace(/\s+/g, '')) : lua.split('/').pop();
        add(f, `${ue4ssDir}/Mods/${/^Mods\//i.test(rest) ? rest.slice(5) : name + '/' + rest}`);
        continue;
      }
      if (/(^|\/)(dwmapi\.dll|UE4SS\.dll|UE4SS-settings\.ini|xinput1_3\.dll)$/i.test(r) || /^ue4ss\//i.test(r)) { add(f, `${bin}/${r.replace(/^.*?(?=ue4ss\/|dwmapi|UE4SS|xinput)/i, '')}`); continue; }
      if (/\.(pak|ucas|utoc|sig)$/i.test(r)) {
        add(f, /LogicMods\//i.test(r) ? `${proj}/Content/Paks/LogicMods/${path.basename(r)}` : `${proj}/Content/Paks/~mods/${folder}/${path.basename(r)}`);
        continue;
      }
      if (/\.(dll|asi)$/i.test(r)) { add(f, `${bin}/${path.basename(r)}`); continue; }
      if (!TOP_JUNK.test(path.basename(r)) && !/\.(txt|md|png|jpe?g|url)$/i.test(r)) add(f, `${proj}/Content/Paks/~mods/${folder}/${r}`);
    }
    return map;
  }
  if (layout === 'minecraft') {
    for (const [f, r] of fl) if (/\.jar$/i.test(r)) add(f, 'mods/' + path.basename(r));
    return map;
  }
  for (const [f, r] of fl) if (!TOP_JUNK.test(r) || r.includes('/')) add(f, (layout === 'custom' ? '' : '') + r);
  return map;
}

// ---------- staging ----------
// The mod's own folder inside ~mods / LogicMods / ue4ss Mods, so a replacement lands in the same place.
function modFolderOf(files) {
  for (const f of files || []) {
    const m = String(f).match(/(?:^|\/)(?:~mods|LogicMods|Mods)\/([^/]+)\/[^/]+$/i) || String(f).match(/(?:^|\/)(?:~mods|Mods)\/([^/]+)\//i);
    if (m) return m[1];
  }
  return null;
}

// ModHaven's own copy of each mod lives in games/<game>/mods/<Mod name> [source-id]/<version>/.
// (Older versions used just "source-id"; those folders are renamed the first time they're used.)
const tidied = new Set();
function modStoreDir(game, mod) {
  const parent = games.gdir(game.key, 'mods');
  const tag = store.safeName(`${mod.source}-${mod.id}`);
  const want = store.safeName(`${String(mod.name || mod.id).trim().slice(0, 60)} [${tag}]`);
  let ents = [];
  try { ents = fs.readdirSync(parent); } catch { }
  // Tidy folders left empty by earlier versions of ModHaven (once per game per session: this runs for every mod lookup).
  if (!tidied.has(game.key)) {
    tidied.add(game.key);
    for (const e of ents) { try { const d = path.join(parent, e); if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch { } }
  }
  const have = ents.find(e => e === want && fs.existsSync(path.join(parent, e))) || ents.find(e => (e === tag || e.endsWith(` [${tag}]`)) && fs.existsSync(path.join(parent, e)));
  if (have && have !== want) {
    try { fs.renameSync(path.join(parent, have), path.join(parent, want)); } catch { return path.join(parent, have); }
  }
  return path.join(parent, want);
}
const stageDir = (game, mod) => path.join(modStoreDir(game, mod), store.safeName(String(mod.versionId) + (mod.rawLayout ? ' (your files)' : '')));

// version: {id, version, fileName, downloadUrl}; dl: {url, fileName, headers}
// Two installs can need the same file at once (an update and a dependency of another update):
// they share one download/unpack instead of racing on the same files.
const inFlight = new Map();
function once(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

function stageMod(game, mod, dl) {
  const dir = stageDir(game, mod);
  return once('stage:' + dir.toLowerCase(), () => stageModNow(game, mod, dl, dir));
}
async function stageModNow(game, mod, dl, dir) {
  if (fs.existsSync(path.join(dir, '.staged'))) {
    // Same release id as a copy of the user's own files (older naming)? Move that copy aside first.
    const raw = games.profiles(game.key).flatMap(p => p.mods).find(x => x.uid === `${mod.source}:${mod.id}` && x.rawLayout);
    if (raw && looksLikeOwnFiles(dir, raw)) {
      const own = path.join(path.dirname(dir), store.safeName(String(raw.versionId) + ' (your files)'));
      if (!fs.existsSync(own)) fs.renameSync(dir, own); else fs.rmSync(dir, { recursive: true, force: true });
    } else return dir;
  }
  const file = store.root('downloads', store.safeName(mod.source), store.safeName(`${mod.id}-${mod.versionId}-${dl.fileName || 'mod.zip'}`));
  if (!fs.existsSync(file)) await once('dl:' + file.toLowerCase(), () => (fs.existsSync(file) ? Promise.resolve(file) : download(dl.url, file, { name: `${mod.name} ${mod.version || ''}`.trim(), headers: dl.headers })));
  await extract(file, dir);
  fs.writeFileSync(path.join(dir, '.staged'), new Date().toISOString());
  return dir;
}

// Local file the user dropped in.
async function stageFileFor(game, entry, filePath) {
  const st = fs.statSync(filePath);
  const mod = { ...entry, rawLayout: false, versionId: 'file-' + Math.round(st.mtimeMs), fileName: path.basename(filePath) }; // a download, not the user's own copy
  const dir = stageDir(game, mod);
  await extract(filePath, dir);
  fs.writeFileSync(path.join(dir, '.staged'), new Date().toISOString());
  return mod;
}

async function stageLocal(game, filePath) {
  const base = path.basename(filePath).replace(/\.(zip|7z|rar|dll|jar|pak|esp|esm|esl)$/i, '');
  const st = fs.statSync(filePath);
  const mod = { source: 'local', id: store.safeName(base), versionId: String(Math.round(st.mtimeMs)), name: base, version: 'local', fileName: path.basename(filePath) };
  const dir = stageDir(game, mod);
  await extract(filePath, dir);
  fs.writeFileSync(path.join(dir, '.staged'), new Date().toISOString());
  return mod;
}

function pruneOldVersions(game, mod, keep) {
  const parent = path.dirname(stageDir(game, mod));
  let vers = [];
  try { vers = fs.readdirSync(parent).map(v => ({ v, t: fs.statSync(path.join(parent, v)).mtimeMs })); } catch { return; }
  vers.sort((a, b) => b.t - a.t);
  // Versions any profile still uses stay (another profile can be on an older release), and so does
  // the copy of the user's own files taken over from the game folder.
  const inUse = new Set([path.basename(stageDir(game, mod))]);
  try { for (const p of games.profiles(game.key)) for (const m of p.mods) if (m.uid === mod.uid) inUse.add(path.basename(stageDir(game, m))); } catch { }
  for (const x of vers.slice(Math.max(1, Number(keep) || 1))) {
    if (inUse.has(x.v) || / \(your files\)$/.test(x.v)) continue;
    try { fs.rmSync(path.join(parent, x.v), { recursive: true, force: true }); } catch (e) { store.log('prune old version', x.v, e.message); }
  }
}

// ---------- deploy ----------
const deployFile = game => games.gdir(game.key, 'deploy.json');
const backupDir = game => games.gdir(game.key, 'backup');
const CONFIG_RE = /\.(cfg|ini|json|toml|yaml|yml|xml|txt)$/i;

// File-level conflicts: same target path written by 2+ enabled mods.
function fileConflicts(game, profile) {
  const layout = resolveLayout(game);
  const owners = new Map();
  for (const m of profile.mods.filter(x => x.enabled)) {
    const dir = findStage(game, m);
    if (!dir) continue;
    for (const { rel } of mapFiles(dir, m, layout, game)) {
      if (/^BepInEx\/config\//i.test(rel)) continue;
      const k = rel.toLowerCase();
      if (!owners.has(k)) owners.set(k, []);
      owners.get(k).push(m.uid);
    }
  }
  const pairs = {};
  for (const [rel, us] of owners) {
    if (us.length < 2) continue;
    for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
      const k = [us[i], us[j]].sort().join('|');
      (pairs[k] = pairs[k] || []).push(rel);
    }
  }
  return pairs; // "uidA|uidB" -> [paths]
}

function undeploy(game) {
  const dep = store.readJson(deployFile(game), null);
  if (!dep) return { removed: 0 };
  const root = dep.root;
  // Keep the configs the game wrote into the profile that was deployed.
  if (dep.profile && dep.layout === 'bepinex') {
    const cfg = path.join(root, 'BepInEx', 'config');
    if (fs.existsSync(cfg)) {
      const to = games.pdir(game.key, dep.profile, 'config');
      fs.rmSync(to, { recursive: true, force: true });
      games.copyDir(cfg, to);
    }
  }
  let removed = 0;
  const failed = {};
  const rels = Object.keys(dep.files).sort((a, b) => b.length - a.length);
  for (const rel of rels) {
    const p = path.join(root, rel);
    try { fs.rmSync(p, { force: true }); removed++; } catch (e) { failed[rel] = { ...dep.files[rel], error: e.message }; continue; }
    const bk = path.join(backupDir(game), rel);
    if (dep.files[rel].backup && fs.existsSync(bk)) {
      try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.renameSync(bk, p); }
      catch (e) { failed[rel] = { ...dep.files[rel], error: e.message }; continue; }
    }
    // Older deploys didn't record their folders: tidy empty ones, but never the game's own structure.
    if (!dep.dirs) {
      let d = path.dirname(p);
      while (d.length > root.length + 1 && !KEEP_DIRS.test(path.basename(d))) {
        try { if (fs.readdirSync(d).length) break; fs.rmdirSync(d); } catch { break; }
        d = path.dirname(d);
      }
    }
  }
  // Folders ModHaven created itself go away again once empty (deepest first).
  for (const rel of (dep.dirs || []).slice().sort((a, b) => b.length - a.length)) {
    const d = path.join(root, rel);
    try { if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch { }
  }
  const nFailed = Object.keys(failed).length;
  if (nFailed) {
    // Keep a record of what is still out there (and whose original is still in the backup) so the
    // next try can finish the job, and say what's wrong instead of carrying on.
    store.writeJson(deployFile(game), { ...dep, files: failed, at: new Date().toISOString() });
    const first = Object.entries(failed)[0];
    throw new Error(`ModHaven couldn't take ${nFailed} mod file${nFailed > 1 ? 's' : ''} out of the game folder (${first[0]}: ${first[1].error}). Close the game or any program using ${nFailed > 1 ? 'them' : 'it'} and try again.`);
  }
  if (dep.layout === 'bepinex' && dep.profile) {
    const cfg = path.join(root, 'BepInEx', 'config');
    fs.rmSync(cfg, { recursive: true, force: true });
  }
  fs.rmSync(deployFile(game), { force: true });
  return { removed };
}

// Game folders that are never removed when tidying, even if a mod left them empty.
const KEEP_DIRS = /^(Content|Paks|Binaries|Win64|Data|BepInEx|plugins|patchers|config|core|Mods|Plugins|UserData|UserLibs|MelonLoader|mods|~mods|LogicMods|SKSE|F4SE|scripts)$/i;

function linkOrCopy(src, dst, mode, made) {
  if (made) {
    // Remember which folders we had to create, so undeploy only removes those.
    let d = path.dirname(dst);
    const missing = [];
    while (!fs.existsSync(d)) { missing.push(d); const up = path.dirname(d); if (up === d) break; d = up; }
    for (const m of missing) made.add(m);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.rmSync(dst, { force: true });
  if (mode === 'hardlink' && !CONFIG_RE.test(dst)) {
    try { fs.linkSync(src, dst); return; } catch { /* other drive: copy */ }
  }
  fs.copyFileSync(src, dst);
}

// The stored copy of a mod. If it is filed under another version id (older ModHaven versions could
// change the id without moving the folder), the only stored version is re-filed under the right id.
function findStage(game, m) {
  const dir = stageDir(game, m);
  if (fs.existsSync(path.join(dir, '.staged'))) return dir;
  const parent = path.dirname(dir);
  let vers = [];
  try { vers = fs.readdirSync(parent).filter(v => fs.existsSync(path.join(parent, v, '.staged'))); } catch { }
  // Older ModHaven filed the user's own files under the plain release id: move them to "<id> (your files)".
  const legacy = path.join(parent, store.safeName(String(m.versionId)));
  if (m.rawLayout && legacy !== dir && fs.existsSync(path.join(legacy, '.staged')) && looksLikeOwnFiles(legacy, m)) {
    try { fs.renameSync(legacy, dir); return dir; } catch { return legacy; }
  }
  if (m.rawLayout && vers.length === 1) {
    try { fs.renameSync(path.join(parent, vers[0]), dir); return dir; } catch { return path.join(parent, vers[0]); }
  }
  return fs.existsSync(dir) ? dir : null;
}

// The user's own files are kept with their full game paths (e.g. "RSDragonwilds/Content/..."), downloads aren't.
function looksLikeOwnFiles(dir, m) {
  const want = ((m.adopted && m.adopted.files) || m.deployedFiles || []).slice(0, 5);
  return want.length ? want.some(f => fs.existsSync(path.join(dir, f))) : true;
}

function deploy(game, profile, { save = true } = {}) {
  if (!game.installPath && resolveLayout(game) !== 'minecraft') throw new Error('Set the game folder first (Game settings)');
  const layout = resolveLayout(game); // before undeploy: removing mods must not change how the game looks
  if (layout === 'unreal' && game.installPath) {
    // UE4SS 3.x keeps its files (and script mods) in Binaries/Win64/ue4ss; decide while UE4SS is still in place.
    const proj = unrealProject(game.installPath);
    const w = proj && path.join(game.installPath, proj, 'Binaries', 'Win64');
    game = { ...game, _ue4ssFolder: !!(w && (fs.existsSync(path.join(w, 'ue4ss')) || profile.mods.some(m => m.enabled && /Binaries\/Win64\/ue4ss\//i.test((m.deployedFiles || []).join('\n'))))) };
  }
  const enabled = profile.mods.filter(m => m.enabled).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // Safety: never take mods out of the game unless every turned-on mod can be put back.
  const stages = new Map(enabled.map(m => [m.uid, findStage(game, m)]));
  const lost = enabled.filter(m => !stages.get(m.uid)).map(m => m.name);
  if (lost.length) throw new Error(`ModHaven can't find its copy of ${lost.join(', ')}, so it left the game folder as it is. Turn ${lost.length === 1 ? 'that mod' : 'those mods'} off or reinstall ${lost.length === 1 ? 'it' : 'them'}.`);
  undeploy(game);
  const root = targetRoot(game, layout);
  if (!root || !fs.existsSync(root)) throw new Error('Mod folder not found: ' + root);
  const mode = store.settings().deployMode;
  const files = {};
  const made = new Set();
  const missing = [];
  // Configs saved from earlier runs of this profile go back first; mods' default configs don't overwrite them.
  const savedCfg = games.pdir(game.key, profile.name, 'config');
  const cfgRels = new Set();
  if (layout === 'bepinex' && fs.existsSync(savedCfg)) {
    for (const rel of walkFiles(savedCfg)) {
      const r = 'BepInEx/config/' + rel;
      cfgRels.add(r.toLowerCase());
    }
  }
  const record = () => {
    const dirs = [...made].map(d => path.relative(root, d).replace(/\\/g, '/')).filter(d => d && !d.startsWith('..'));
    store.writeJson(deployFile(game), { profile: profile.name, layout, root, files, dirs, at: new Date().toISOString() });
  };
  try {
  for (const m of enabled) {
    const dir = stages.get(m.uid);
    if (!dir) { missing.push(m.name); continue; }
    const owned = [];
    for (const { src, rel } of mapFiles(dir, m, layout, game)) {
      if (cfgRels.has(rel.toLowerCase())) continue;
      const dst = path.join(root, rel);
      if (!files[rel] && fs.existsSync(dst)) {
        const bk = path.join(backupDir(game), rel);
        fs.mkdirSync(path.dirname(bk), { recursive: true });
        // An older backup of this path is still there (an earlier run was cut short): it stays the
        // original, and the file in the game folder is kept next to it instead of being deleted.
        if (fs.existsSync(bk)) fs.renameSync(dst, `${bk}.kept-${Date.now()}`);
        else fs.renameSync(dst, bk);
        files[rel] = { uid: m.uid, backup: true };
      } else files[rel] = { uid: m.uid, backup: files[rel] ? files[rel].backup : false };
      linkOrCopy(src, dst, mode, made);
      owned.push(rel);
    }
    m.deployedFiles = owned.slice(0, 400);
  }
  if (layout === 'bepinex' && fs.existsSync(savedCfg)) {
    for (const rel of walkFiles(savedCfg)) {
      const r = 'BepInEx/config/' + rel;
      linkOrCopy(path.join(savedCfg, rel), path.join(root, r), 'copy', made);
      files[r] = { uid: 'profile-config', backup: false };
    }
  }
  } finally {
    // Written even when a file fails half-way, so undeploy can take out what did go in and put the backups back.
    record();
  }
  if (save) games.saveProfile(game.key, profile);
  return { layout, root, count: Object.keys(files).length, missing };
}

const deployedInfo = game => store.readJson(deployFile(game), null);

// Which mod owns a file name (used to map a crashing DLL back to a mod).
function ownerOf(game, fileName) {
  const dep = deployedInfo(game);
  if (!dep) return null;
  const want = String(fileName).toLowerCase().replace(/\\/g, '/');
  for (const [rel, info] of Object.entries(dep.files)) {
    const r = rel.toLowerCase();
    if (r === want || r.endsWith('/' + want) || path.basename(r) === path.basename(want)) return info.uid;
  }
  return null;
}

module.exports = { findStage, modFolderOf, modStoreDir, stageFileFor, unrealProject, setEmitter, download, markDownload, clearDownloads, dlState, extract, stageMod, stageLocal, stageDir,
  pruneOldVersions, deploy, undeploy, deployedInfo, fileConflicts, resolveLayout, targetRoot, mapFiles, ownerOf, walkFiles, find7z };
