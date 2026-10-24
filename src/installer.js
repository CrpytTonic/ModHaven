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

async function download(url, dest, { name, headers } = {}) {
  const id = crypto.randomUUID();
  const st = { id, name: name || path.basename(dest), received: 0, total: 0, state: 'downloading', started: Date.now(), error: null };
  downloads.set(id, st);
  emit('downloads', dlState());
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const res = await net.request(url, { headers: { Accept: '*/*', ...(headers || {}) }, timeout: 120000 });
    st.total = Number(res.headers.get('content-length')) || 0;
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    let lastEmit = 0;
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
      st.received += chunk.length;
      if (Date.now() - lastEmit > 150) { lastEmit = Date.now(); emit('downloads', dlState()); }
    }
    await new Promise((r, j) => out.end(err => (err ? j(err) : r())));
    fs.renameSync(tmp, dest);
    st.state = 'done';
    return dest;
  } catch (e) {
    st.state = 'error'; st.error = e.message;
    throw e;
  } finally {
    emit('downloads', dlState());
  }
}
function markDownload(name, state, error) {
  const id = crypto.randomUUID();
  downloads.set(id, { id, name, received: 0, total: 0, state, started: Date.now(), error: error || null });
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
  return 'root';
}

// Where a game's mod files go. Returns absolute target root (game folder, or custom).
function targetRoot(game, layout) {
  if (layout === 'minecraft') return game.customDir || path.join(process.env.APPDATA || '', '.minecraft');
  if (layout === 'custom') return game.customDir || game.installPath;
  return game.installPath;
}

const TOP_JUNK = /^(readme|changelog|license|credits)[^/]*$|^(icon\.png|manifest\.json)$/i;

// Maps every staged file to its path relative to the target root.
function mapFiles(stageDir, mod, layout) {
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
    if (!/^(BepInEx|plugins|patchers|config|core|Data|Mods|Plugins|UserLibs|UserData|mods|Engine|Content)$/i.test(only)) strip = only + '/';
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
  if (layout === 'minecraft') {
    for (const [f, r] of fl) if (/\.jar$/i.test(r)) add(f, 'mods/' + path.basename(r));
    return map;
  }
  for (const [f, r] of fl) if (!TOP_JUNK.test(r) || r.includes('/')) add(f, (layout === 'custom' ? '' : '') + r);
  return map;
}

// ---------- staging ----------
const stageDir = (game, mod) => games.gdir(game.key, 'mods', store.safeName(`${mod.source}-${mod.id}`), store.safeName(String(mod.versionId)));

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
  if (fs.existsSync(path.join(dir, '.staged'))) return dir;
  const file = store.root('downloads', store.safeName(mod.source), store.safeName(`${mod.id}-${mod.versionId}-${dl.fileName || 'mod.zip'}`));
  if (!fs.existsSync(file)) await once('dl:' + file.toLowerCase(), () => (fs.existsSync(file) ? Promise.resolve(file) : download(dl.url, file, { name: `${mod.name} ${mod.version || ''}`.trim(), headers: dl.headers })));
  await extract(file, dir);
  fs.writeFileSync(path.join(dir, '.staged'), new Date().toISOString());
  return dir;
}

// Local file the user dropped in.
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
  const current = store.safeName(String(mod.versionId));
  for (const x of vers.slice(Math.max(1, keep))) if (x.v !== current) fs.rmSync(path.join(parent, x.v), { recursive: true, force: true });
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
    const dir = stageDir(game, m);
    if (!fs.existsSync(dir)) continue;
    for (const { rel } of mapFiles(dir, m, layout)) {
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
  const rels = Object.keys(dep.files).sort((a, b) => b.length - a.length);
  for (const rel of rels) {
    const p = path.join(root, rel);
    try { fs.rmSync(p, { force: true }); removed++; } catch { }
    const bk = path.join(backupDir(game), rel);
    if (dep.files[rel].backup && fs.existsSync(bk)) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.renameSync(bk, p);
    }
    // Tidy empty folders we created.
    let d = path.dirname(p);
    while (d.length > root.length + 1) {
      try { if (fs.readdirSync(d).length) break; fs.rmdirSync(d); } catch { break; }
      d = path.dirname(d);
    }
  }
  if (dep.layout === 'bepinex' && dep.profile) {
    const cfg = path.join(root, 'BepInEx', 'config');
    fs.rmSync(cfg, { recursive: true, force: true });
  }
  fs.rmSync(deployFile(game), { force: true });
  return { removed };
}

function linkOrCopy(src, dst, mode) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.rmSync(dst, { force: true });
  if (mode === 'hardlink' && !CONFIG_RE.test(dst)) {
    try { fs.linkSync(src, dst); return; } catch { /* other drive: copy */ }
  }
  fs.copyFileSync(src, dst);
}

function deploy(game, profile, { save = true } = {}) {
  if (!game.installPath && resolveLayout(game) !== 'minecraft') throw new Error('Set the game folder first (Game settings)');
  undeploy(game);
  const layout = resolveLayout(game);
  const root = targetRoot(game, layout);
  if (!root || !fs.existsSync(root)) throw new Error('Mod folder not found: ' + root);
  const mode = store.settings().deployMode;
  const files = {};
  const enabled = profile.mods.filter(m => m.enabled).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
  for (const m of enabled) {
    const dir = stageDir(game, m);
    if (!fs.existsSync(dir)) { missing.push(m.name); continue; }
    const owned = [];
    for (const { src, rel } of mapFiles(dir, m, layout)) {
      if (cfgRels.has(rel.toLowerCase())) continue;
      const dst = path.join(root, rel);
      if (!files[rel] && fs.existsSync(dst)) {
        const bk = path.join(backupDir(game), rel);
        if (!fs.existsSync(bk)) { fs.mkdirSync(path.dirname(bk), { recursive: true }); fs.renameSync(dst, bk); }
        files[rel] = { uid: m.uid, backup: true };
      } else files[rel] = { uid: m.uid, backup: files[rel] ? files[rel].backup : false };
      linkOrCopy(src, dst, mode);
      owned.push(rel);
    }
    m.deployedFiles = owned.slice(0, 400);
  }
  if (layout === 'bepinex' && fs.existsSync(savedCfg)) {
    for (const rel of walkFiles(savedCfg)) {
      const r = 'BepInEx/config/' + rel;
      linkOrCopy(path.join(savedCfg, rel), path.join(root, r), 'copy');
      files[r] = { uid: 'profile-config', backup: false };
    }
  }
  store.writeJson(deployFile(game), { profile: profile.name, layout, root, files, at: new Date().toISOString() });
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

module.exports = { setEmitter, download, markDownload, clearDownloads, dlState, extract, stageMod, stageLocal, stageDir,
  pruneOldVersions, deploy, undeploy, deployedInfo, fileConflicts, resolveLayout, targetRoot, mapFiles, ownerOf, walkFiles, find7z };
