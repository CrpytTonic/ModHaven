// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Finds mods the user installed by hand (not through ModHaven), matches them to the mod sites,
// and "adopts" the chosen ones into a profile so they can be updated like any other mod.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');
const store = require('./store');
const games = require('./games');
const installer = require('./installer');
const { normName } = require('./catalog');

const run = (cmd, args) => new Promise(res => execFile(cmd, args, { windowsHide: true, maxBuffer: 32 << 20 }, (err, out) => res(err ? '' : String(out))));
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const ls = d => { try { return fs.readdirSync(d); } catch { return []; } };
const rel = (root, p) => path.relative(root, p).replace(/\\/g, '/');

function walk(dir, out = []) {
  for (const e of ls(dir)) {
    const p = path.join(dir, e);
    if (isDir(p)) walk(p, out); else out.push(p);
  }
  return out;
}

// ---------- detection ----------
// Candidate = { key, name, version, author, kind, root, files: [rel paths], primary: rel path, manifest?, thunderstoreId? }

const VANILLA_PLUGINS = /^(skyrim|update|dawnguard|hearthfires|dragonborn|fallout4|dlc\w*|fallout3|falloutnv|oblivion|morrowind|tribunal|bloodmoon|starfield|blueprintships-starfield|constellation|oldmars|sfbgs\w*|cc\w+|_resourcepack|anchorage|thepitt|brokensteel|pointlookout|zeta|deadmoney|honesthearts|oldworldblues|lonesomeroad|gunrunnersarsenal|caravanpack|classicpack|mercenarypack|tribalpack)\.(esm|esp|esl)$/i;
const PROXY_DLLS = /^(dinput8|dxgi|d3d9|d3d11|d3d12|version|winmm|winhttp|xinput1_3|xinput1_4|xinput9_1_0|dsound|opengl32|wininet|bink2w64|binkw32|dwmapi|vorbisfile)\.dll$/i;

function detect(game, layout) {
  const root = installer.targetRoot(game, layout);
  if (!root || !isDir(root)) return { root, candidates: [] };
  const dep = installer.deployedInfo(game);
  const ours = new Set(dep ? Object.keys(dep.files).map(f => f.toLowerCase()) : []);
  const mine = r => ours.has(r.toLowerCase());
  const out = [];
  const add = (c) => {
    c.files = c.files.filter(f => !mine(f));
    if (!c.files.length) return;
    c.primary = c.primary && c.files.includes(c.primary) ? c.primary : pickPrimary(root, c.files);
    c.key = (c.kind + ':' + (c.files.length === 1 ? c.files[0] : path.posix.dirname(c.primary) + '/' + c.name)).toLowerCase();
    out.push(c);
  };

  if (layout === 'bepinex') {
    const bep = path.join(root, 'BepInEx');
    if (isDir(path.join(bep, 'core')) && !mine('BepInEx/core/BepInEx.dll') && !mine('BepInEx/core/BepInEx.Core.dll')) {
      const files = [...walk(path.join(bep, 'core')).map(p => rel(root, p)),
        ...['winhttp.dll', 'doorstop_config.ini', '.doorstop_version', 'changelog.txt'].filter(f => exists(path.join(root, f)))];
      add({ name: 'BepInExPack', kind: 'loader', files, version: null, searchNames: ['BepInExPack', 'BepInEx'], primary: files.find(f => /BepInEx(.Core)?.dll$/i.test(f)) });
    }
    for (const sub of ['plugins', 'patchers']) {
      const d = path.join(bep, sub);
      for (const e of ls(d)) {
        const p = path.join(d, e);
        if (isDir(p)) {
          const files = walk(p).map(f => rel(root, f));
          const man = readJson(path.join(p, 'manifest.json'));
          const m = e.match(/^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)$/);
          add({ name: (man && man.name) || (m ? m[2] : e), version: man && man.version_number || null, author: m ? m[1] : null,
            thunderstoreId: m ? e : null, manifest: man, kind: 'plugin', files });
        } else if (/\.dll$/i.test(e)) {
          add({ name: e.replace(/\.dll$/i, ''), version: null, kind: 'plugin', files: [rel(root, p)] });
        }
      }
    }
  } else if (layout === 'melonloader') {
    if (isDir(path.join(root, 'MelonLoader')) && !mine('version.dll')) {
      add({ name: 'MelonLoader', kind: 'loader', files: [...walk(path.join(root, 'MelonLoader')).filter(f => !/\.log$|[\\/]Logs[\\/]/i.test(f)).map(p => rel(root, p)), ...['version.dll'].filter(f => exists(path.join(root, f)))], searchNames: ['MelonLoader'] });
    }
    for (const sub of ['Mods', 'Plugins']) for (const e of ls(path.join(root, sub))) {
      if (/\.dll$/i.test(e)) add({ name: e.replace(/\.dll$/i, ''), kind: 'plugin', files: [`${sub}/${e}`] });
    }
  } else if (layout === 'minecraft') {
    for (const e of ls(path.join(root, 'mods'))) if (/\.jar$/i.test(e)) add({ name: e.replace(/\.jar$/i, ''), kind: 'jar', files: [`mods/${e}`] });
  } else if (layout === 'data') {
    const data = path.join(root, 'Data');
    const all = ls(data);
    for (const e of all) {
      if (!/\.(esp|esm|esl)$/i.test(e) || VANILLA_PLUGINS.test(e)) continue;
      const base = e.replace(/\.(esp|esm|esl)$/i, '');
      const archives = all.filter(f => f !== e && f.toLowerCase().startsWith(base.toLowerCase()) && /\.(bsa|ba2)$/i.test(f) && !VANILLA_PLUGINS.test(f));
      add({ name: base, kind: 'plugin', files: [`Data/${e}`, ...archives.map(a => `Data/${a}`)], primary: `Data/${e}` });
    }
    for (const se of ['SKSE', 'F4SE', 'SFSE', 'OBSE', 'NVSE']) {
      for (const e of ls(path.join(data, se, 'Plugins'))) {
        if (!/\.dll$/i.test(e)) continue;
        const base = e.replace(/\.dll$/i, '');
        const side = ls(path.join(data, se, 'Plugins')).filter(f => f !== e && f.toLowerCase().startsWith(base.toLowerCase() + '.') && !/\.log$/i.test(f));
        add({ name: base, kind: 'plugin', files: [`Data/${se}/Plugins/${e}`, ...side.map(s => `Data/${se}/Plugins/${s}`)], primary: `Data/${se}/Plugins/${e}` });
      }
    }
    const loader = ls(root).filter(f => /^(skse64|skse|f4se|sfse|obse64|nvse)_.*\.(exe|dll)$/i.test(f));
    if (loader.length) add({ name: loader[0].split('_')[0].toUpperCase().replace(/64$/, '') + ' script extender', kind: 'loader', files: loader, searchNames: [{ skse64: 'SKSE64', skse: 'SKSE', f4se: 'F4SE', sfse: 'SFSE', obse64: 'OBSE64', nvse: 'xNVSE' }[loader[0].split('_')[0].toLowerCase()] || 'Script Extender'] });
  }

  // Engine-generic spots, for every layout.
  for (const d of ls(root)) {
    const paks = path.join(root, d, 'Content', 'Paks');
    for (const sub of ['~mods', 'LogicMods', 'Mods', '~Mods']) {
      const md = path.join(paks, sub);
      const groups = new Map();
      for (const f of walk(md)) {
        if (!/\.(pak|utoc|ucas|sig)$/i.test(f)) continue;
        const b = f.replace(/\.(pak|utoc|ucas|sig)$/i, '');
        if (!groups.has(b)) groups.set(b, []);
        groups.get(b).push(rel(root, f));
      }
      for (const [b, files] of groups) add({ name: path.basename(b).replace(/_P$/i, ''), altName: path.basename(path.dirname(b)) !== sub ? path.basename(path.dirname(b)) : null, kind: 'pak', files, primary: files.find(f => /\.ucas$/i.test(f)) || files.find(f => /\.pak$/i.test(f)) });
    }
    const ue4ss = path.join(root, d, 'Binaries', 'Win64');
    for (const e of ls(path.join(ue4ss, 'Mods'))) {
      const p = path.join(ue4ss, 'Mods', e);
      if (isDir(p) && !/^(shared|BPModLoaderMod|BPML_GenericFunctions|ConsoleCommandsMod|ConsoleEnablerMod|CheatManagerEnablerMod|Keybinds|LineTraceMod|SplitScreenMod|ActorDumperMod|jsbLuaProfilerMod)$/i.test(e)) {
        add({ name: e, kind: 'ue4ss', files: walk(p).map(f => rel(root, f)) });
      }
    }
    if (exists(path.join(ue4ss, 'UE4SS.dll')) || exists(path.join(ue4ss, 'ue4ss', 'UE4SS.dll'))) {
      const files = ['UE4SS.dll', 'UE4SS-settings.ini', 'dwmapi.dll', 'xinput1_3.dll'].filter(f => exists(path.join(ue4ss, f))).map(f => rel(root, path.join(ue4ss, f)));
      if (isDir(path.join(ue4ss, 'ue4ss'))) files.push(...walk(path.join(ue4ss, 'ue4ss')).filter(f => !/\.log$/i.test(f)).map(f => rel(root, f)));
      add({ name: 'UE4SS', kind: 'loader', files, searchNames: ['UE4SS', 'RE-UE4SS'] });
    }
  }
  // Proxy DLL loaders next to the exe (ReShade, ASI loader, frame-rate fixes...) + .asi plugins.
  const exeDir = game.exe ? path.dirname(game.exe) : root;
  for (const dir of [...new Set([root, exeDir])]) {
    for (const e of ls(dir)) {
      const p = path.join(dir, e);
      if (PROXY_DLLS.test(e) && !(layout === 'bepinex' && /^winhttp\.dll$/i.test(e)) && !(layout === 'melonloader' && /^version\.dll$/i.test(e)) && !out.some(c => c.files.includes(rel(root, p)))) {
        add({ name: e, kind: 'proxy', files: [rel(root, p)], proxy: true });
      }
      if (/\.asi$/i.test(e)) add({ name: e.replace(/\.asi$/i, ''), kind: 'asi', files: [rel(root, p), ...ls(dir).filter(f => f !== e && f.toLowerCase().startsWith(e.replace(/\.asi$/i, '').toLowerCase() + '.') && /\.(ini|toml|json)$/i.test(f)).map(f => rel(root, path.join(dir, f)))] });
    }
    for (const sub of ['scripts', 'plugins']) for (const e of ls(path.join(dir, sub))) if (/\.asi$/i.test(e)) add({ name: e.replace(/\.asi$/i, ''), kind: 'asi', files: [rel(root, path.join(dir, sub, e))] });
  }
  return { root, candidates: out };
}

function pickPrimary(root, files) {
  const score = f => (/\.(jar|esp|esm|esl|pak|asi)$/i.test(f) ? 3 : /\.dll$/i.test(f) ? 2 : 0);
  let best = files[0], bs = -1;
  for (const f of files) {
    let size = 0; try { size = fs.statSync(path.join(root, f)).size; } catch { }
    const s = score(f) * 1e12 + size;
    if (s > bs) { bs = s; best = f; }
  }
  return best;
}
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

// ---------- reading names/versions out of files ----------
// .NET attributes like [BepInPlugin("guid", "Name", "1.2.3")] / [MelonInfo(typeof(X), "Name", "1.0", "Author")]
// are stored as length-prefixed strings after a 0x0001 prolog.
function attrStrings(buf) {
  const s = buf.toString('latin1');
  const found = [];
  const re = /\x01\x00/g;
  let m;
  while ((m = re.exec(s)) && found.length < 400) {
    let i = m.index + 2;
    const strs = [];
    while (strs.length < 6 && i < s.length) {
      const len = s.charCodeAt(i);
      if (len < 1 || len > 0x7f) break;
      const str = s.substr(i + 1, len);
      if (str.length !== len || !/^[\x20-\x7e]+$/.test(str)) break;
      strs.push(str);
      i += 1 + len;
    }
    if (strs.length >= 3) found.push(strs);
  }
  return found;
}
const VER_RE = /^v?\d+(\.\d+){1,3}([-+.][\w.]+)?$/;
function dllInfo(file) {
  let buf;
  try { const st = fs.statSync(file); if (st.size > 60 << 20) return null; buf = fs.readFileSync(file); } catch { return null; }
  for (const strs of attrStrings(buf)) {
    // BepInPlugin: guid, name, version
    if (strs.length >= 3 && VER_RE.test(strs[2]) && /[.\w]/.test(strs[0]) && !VER_RE.test(strs[1])) return { name: strs[1], version: strs[2].replace(/^v/, ''), guid: strs[0], how: 'plugin attribute' };
    // MelonInfo: type, name, version, author, link
    if (strs.length >= 4 && VER_RE.test(strs[2]) && /\./.test(strs[0])) return { name: strs[1], version: strs[2].replace(/^v/, ''), author: strs[3], how: 'plugin attribute' };
  }
  return null;
}
function jarInfo(file) {
  try {
    const zip = new AdmZip(file);
    const txt = n => { const e = zip.getEntry(n); return e ? e.getData().toString('utf8') : null; };
    const fab = txt('fabric.mod.json') || txt('quilt.mod.json');
    if (fab) { const j = JSON.parse(fab); const q = j.quilt_loader || j; return { name: (q.metadata && q.metadata.name) || q.name || q.id, version: q.version, modid: q.id, how: 'mod metadata' }; }
    const toml = txt('META-INF/mods.toml') || txt('META-INF/neoforge.mods.toml');
    if (toml) {
      const g = k => (toml.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`, 'm')) || [])[1];
      let version = g('version');
      if (!version || /\$\{/.test(version)) { const mf = txt('META-INF/MANIFEST.MF') || ''; version = (mf.match(/Implementation-Version:\s*(\S+)/) || [])[1] || null; }
      return { name: g('displayName') || g('modId'), version, modid: g('modId'), how: 'mod metadata' };
    }
    const mc = txt('mcmod.info');
    if (mc) { const j = JSON.parse(mc); const x = Array.isArray(j) ? j[0] : (j.modList || [])[0]; if (x) return { name: x.name, version: x.version, modid: x.modid, how: 'mod metadata' }; }
  } catch { }
  return null;
}

// Windows file version info for many DLLs at once.
async function versionInfo(files) {
  if (!files.length) return {};
  const list = store.root('cache', 'vi-list.txt');
  fs.writeFileSync(list, files.join('\n'));
  const ps = `Get-Content -LiteralPath '${list.replace(/'/g, "''")}' | ForEach-Object { $v=(Get-Item -LiteralPath $_ -ErrorAction SilentlyContinue).VersionInfo; if($v){ "$_|$($v.ProductName)|$($v.ProductVersion)|$($v.FileDescription)|$($v.CompanyName)" } }`;
  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  const res = {};
  for (const l of out.split(/\r?\n/)) {
    const [f, product, ver, desc, company] = l.split('|');
    if (f) res[f.toLowerCase()] = { product: (product || '').trim(), version: (ver || '').trim(), desc: (desc || '').trim(), company: (company || '').trim() };
  }
  return res;
}

// CurseForge fingerprint: MurmurHash2 (seed 1) over the file with whitespace bytes removed.
function cfFingerprint(buf) {
  const b = Buffer.alloc(buf.length);
  let n = 0;
  for (const c of buf) if (c !== 9 && c !== 10 && c !== 13 && c !== 32) b[n++] = c;
  const m = 0x5bd1e995;
  let h = (1 ^ n) >>> 0, i = 0, len = n;
  while (len >= 4) {
    let k = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
    k = Math.imul(k, m); k ^= k >>> 24; k = Math.imul(k, m);
    h = Math.imul(h, m) ^ k;
    i += 4; len -= 4;
  }
  switch (len) {
    case 3: h ^= b[i + 2] << 16; // fallthrough
    case 2: h ^= b[i + 1] << 8; // fallthrough
    case 1: h ^= b[i]; h = Math.imul(h, m);
  }
  h ^= h >>> 13; h = Math.imul(h, m); h ^= h >>> 15;
  return h >>> 0;
}

// Fills in name/version/hashes for each candidate (local only, no network).
async function describe(root, cands) {
  const base = c => c.root || root;
  const dlls = cands.filter(c => /\.dll$/i.test(c.primary)).map(c => path.join(base(c), c.primary));
  const vi = await versionInfo(dlls);
  for (const c of cands) {
    const p = path.join(base(c), c.primary);
    let info = null;
    if (/\.jar$/i.test(p)) info = jarInfo(p);
    else if (/\.dll$/i.test(p) && c.kind !== 'loader') info = dllInfo(p);
    if (info) {
      if (info.name && !c.manifest) c.name = info.name;
      if (info.version && !c.version) c.version = info.version;
      if (info.author && !c.author) c.author = info.author;
      if (info.guid) c.guid = info.guid;
      if (info.modid) c.modid = info.modid;
      c.how = info.how;
    }
    const v = vi[p.toLowerCase()];
    if (v) {
      if (!c.version && v.version && v.version !== '0.0.0.0') c.version = v.version.replace(/(.0)+$/, '');
      if (c.proxy && (v.product || v.desc)) { c.name = v.product || v.desc; c.fileLabel = path.basename(p); }
      if (v.product && !info && c.kind !== 'loader' && !c.manifest && !/microsoft|windows|nvidia|amd/i.test(v.company + v.product)) c.altName = v.product;
    }
    if (c.proxy && v && /microsoft|windows|nvidia|amd|valve|steam|epic games|bink|rad game/i.test(`${v.company} ${v.product}`)) c.system = true;
    try {
      const buf = fs.readFileSync(p);
      c.sha1 = crypto.createHash('sha1').update(buf).digest('hex');
      c.md5 = crypto.createHash('md5').update(buf).digest('hex');
      c.fingerprint = cfFingerprint(buf);
      c.size = buf.length;
    } catch { }
  }
  return cands.filter(c => !c.system);
}

// ---------- name similarity ----------
// Mod files are often named "zNoCraftedPopup_P" while the site says "No Crafted Popup", or use short
// forms ("NoCD" = "No Cooldowns"). Compare word sets instead of exact strings.
const STOP = new Set(['mod', 'mods', 'the', 'a', 'an', 'for', 'of', 'and', 'to', 'by', 'with', 'v', 'ver', 'version', 'pak', 'p', 'ue4ss', 'edition', 'mp', 'sp']);
const ABBR = { cd: 'cooldown', cds: 'cooldown', qol: 'quality life', hp: 'health', xp: 'experience', exp: 'experience', inv: 'inventory', dmg: 'damage', stam: 'stamina', dur: 'durability', lvl: 'level', lvls: 'level', npc: 'npc', npcs: 'npc' };
function prettyName(n) {
  return String(n || '').replace(/\.(dll|jar|pak|ucas|utoc|esp|esm|esl|asi|zip|7z|rar)$/i, '')
    .replace(/^[z~_!0-9]+(?=[A-Z])/, '').replace(/_P$/i, '')
    .replace(/[-_ ]v?\d+(\.\d+)+.*$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.+]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(s, drop) {
  const out = [];
  for (let w of prettyName(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)) {
    if (!w) continue;
    w = ABBR[w] || w;
    for (let x of w.split(' ')) {
      if (x.length > 3 && x.endsWith('s') && !x.endsWith('ss')) x = x.slice(0, -1);
      // "crafted" / "crafting" / "craft" count as the same word
      if (x.length > 5 && /(ing|ed)$/.test(x)) x = x.replace(/(ing|ed)$/, '');
      if (!STOP.has(x) && !(drop && drop.has(x))) out.push(x);
    }
  }
  return out;
}
// Words too common to make two mod names "similar" on their own ("No Scorch" vs "No Crafted Popup").
const WEAK = new Set(['no', 'more', 'less', 'better', 'faster', 'slower', 'all', 'big', 'bigger', 'small', 'new', 'max', 'infinite', 'unlimited', 'easy', 'simple', 'custom', 'extra', 'super', 'fast', 'quick', 'improved', 'greater', 'remove', 'disable', 'enable', 'x2', 'x10', 'x100']);
// 0..1: 1 = same name; Dice overlap of the word sets otherwise (needs at least one real shared word).
function similarity(a, b, drop) {
  if (normName(prettyName(a)) && normName(prettyName(a)) === normName(prettyName(b))) return 1;
  const A = new Set(tokens(a, drop)), B = new Set(tokens(b, drop));
  if (!A.size || !B.size) return 0;
  let both = 0, strongShared = 0;
  for (const x of A) if (B.has(x)) { both++; if (!WEAK.has(x)) strongShared++; }
  if (!strongShared && [...A].join('') !== [...B].join('')) return 0;
  let s = (2 * both) / (A.size + B.size);
  // Joined-up spellings ("Spellwheel" vs "Spell Wheel")
  if (s < 1 && [...A].join('') === [...B].join('')) s = 0.97;
  return Math.round(s * 100) / 100;
}

// ---------- matching against the sites ----------
const PREFERRED = { bepinex: ['thunderstore', 'nexus', 'curseforge', 'gamebanana'], melonloader: ['thunderstore', 'nexus', 'curseforge', 'gamebanana'],
  minecraft: ['modrinth', 'curseforge'], data: ['nexus', 'curseforge', 'gamebanana'] };

const cleanFileName = n => String(n || '').replace(/\.(dll|jar|pak|esp|esm|esl|asi)$/i, '')
  .replace(/[-_ ]v?\d+(\.\d+)+.*$/i, '').replace(/[-_ ](fabric|forge|neoforge|quilt|mc\d.*)$/i, '');
const nameKeys = c => [...new Set([c.name, c.altName, cleanFileName(path.basename(c.primary)), c.modid, ...(c.searchNames || [])].filter(Boolean).map(normName).filter(k => k.length >= 3))];

async function match(game, cands, mm, onProgress) {
  const settings = store.settings();
  const srcIds = Object.keys(game.sources || {}).filter(id => settings.sources[id] !== false);
  const ctxFor = s => mm.ctxFor(s);
  const results = new Map(cands.map(c => [c.key, []]));
  const put = (c, m) => results.get(c.key).push(m);
  let done = 0;
  const tick = (label) => onProgress && onProgress({ done, total: cands.length, label });

  // 1) exact file matches — Modrinth (sha1, batched)
  if (srcIds.includes('modrinth')) {
    const hs = cands.filter(c => c.sha1 && /\.jar$/i.test(c.primary));
    for (let i = 0; i < hs.length; i += 100) {
      try {
        const body = JSON.stringify({ hashes: hs.slice(i, i + 100).map(c => c.sha1), algorithm: 'sha1' });
        const r = await mm.ctxFor(mm.source('modrinth')).fetchJson('https://api.modrinth.com/v2/version_files', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
        for (const c of hs.slice(i, i + 100)) {
          const v = r[c.sha1];
          if (v) put(c, { source: 'modrinth', gameId: game.sources.modrinth, modId: v.project_id, versionId: v.id, version: v.version_number, versionDate: v.date_published, how: 'exact file' });
        }
      } catch (e) { store.log('modrinth hash lookup', e.message); }
    }
  }
  // CurseForge fingerprints (batched, needs key)
  if (srcIds.includes('curseforge') && settings.keys.curseforge) {
    const fps = cands.filter(c => c.fingerprint);
    for (let i = 0; i < fps.length; i += 200) {
      try {
        const body = JSON.stringify({ fingerprints: fps.slice(i, i + 200).map(c => c.fingerprint) });
        const r = await mm.ctxFor(mm.source('curseforge')).fetchJson(`https://api.curseforge.com/v1/fingerprints/${game.sources.curseforge}`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'x-api-key': settings.keys.curseforge } });
        for (const em of (r.data && r.data.exactMatches) || []) {
          for (const c of fps.slice(i, i + 200)) if (em.file && Number(em.file.fileFingerprint) === c.fingerprint) {
            put(c, { source: 'curseforge', gameId: game.sources.curseforge, modId: String(em.id), versionId: String(em.file.id), version: em.file.displayName || em.file.fileName, versionDate: em.file.fileDate, how: 'exact file' });
          }
        }
      } catch (e) { store.log('curseforge fingerprint lookup', e.message); }
    }
  }
  // Nexus MD5 search (one call per file, needs key)
  if (srcIds.includes('nexus') && settings.keys.nexus) {
    const list = cands.filter(c => c.md5 && !results.get(c.key).length).slice(0, 150);
    await limit(list, 3, async c => {
      try {
        const r = await mm.ctxFor(mm.source('nexus')).fetchJson(`https://api.nexusmods.com/v1/games/${game.sources.nexus}/mods/md5_search/${c.md5}.json`, { headers: { apikey: settings.keys.nexus }, retries: 0 });
        const hit = Array.isArray(r) ? r.find(x => x.mod && x.mod.status !== 'removed') : null;
        if (hit) put(c, { source: 'nexus', gameId: game.sources.nexus, modId: String(hit.mod.mod_id), versionId: String(hit.file_details.file_id), version: hit.file_details.version || hit.mod.version, versionDate: hit.file_details.uploaded_time ? new Date(hit.file_details.uploaded_time * 1000).toISOString() : null, how: 'exact file' });
      } catch (e) { if (e.status !== 404) store.log('nexus md5', e.message); }
    });
  }
  // 2) Thunderstore package folder (Author-Name) / manifest
  if (srcIds.includes('thunderstore')) {
    const ts = mm.source('thunderstore');
    await limit(cands.filter(c => c.thunderstoreId && !results.get(c.key).length), 4, async c => {
      try {
        const info = await ts.getMod(ctxFor(ts), game.sources.thunderstore, c.thunderstoreId);
        if (info) put(c, { source: 'thunderstore', gameId: game.sources.thunderstore, modId: info.id, versionId: c.version || null, version: c.version || null, how: c.manifest ? 'package manifest' : 'package folder', info });
      } catch { }
    });
  }
  // 3) Search by name on every site that lists this game. Small catalogues (up to ~1500 mods) are
  //    read whole once and compared locally, which also finds "zNoCraftedPopup" = "No Crafted Popup".
  const order = [...(PREFERRED[installer.resolveLayout(game)] || []), ...srcIds].filter((x, i, a) => srcIds.includes(x) && a.indexOf(x) === i);
  const toSearch = cands.filter(c => !results.get(c.key).some(m => m.how !== 'name' && m.how !== 'similar'));
  const capped = toSearch.slice(0, 200);
  const finder = siteFinder(game, mm, order);
  await limit(capped, 3, async c => {
    for (const m of await finder.find(candidateNames(c), c.name)) put(c, m);
    done++; tick(c.name);
  });
  done = cands.length; tick('');

  // Fill in display info + newest version for every match.
  const all = [];
  for (const c of cands) for (const m of results.get(c.key)) all.push([c, m]);
  await fillMatches(game, all, mm);
  const rank = rankMatch(order);
  const searched = new Set(capped.map(c => c.key));
  if (toSearch.length > capped.length) store.log(`external scan: name search capped at ${capped.length} of ${toSearch.length}`);
  return cands.map(c => {
    const ms = results.get(c.key).filter(m => m.name).sort((a, b) => rank(a) - rank(b));
    return { ...c, matches: ms, best: ms[0] || null, notSearched: toSearch.includes(c) && !searched.has(c.key) };
  });
}

const modFolderOf = installer.modFolderOf;

const candidateNames = c => [...new Set([c.name, c.altName, prettyName(path.basename(c.primary || '')), c.modid, ...(c.searchNames || [])].filter(x => x && String(x).length >= 3))];

// Finds likely site mods for a list of names. Returns scored matches (best first, max 3 per site).
function siteFinder(game, mm, order) {
  const settings = store.settings();
  const drop = new Set(tokens(game.name));
  const pools = new Map();
  const pool = id => {
    if (!pools.has(id)) pools.set(id, (async () => {
      const s = mm.source(id);
      try {
        const first = await s.listMods(mm.ctxFor(s), game.sources[id], { query: '', sort: 'popular', page: 0, pageSize: 50 });
        if (first.total != null && first.total > 1500) return null;
        const all = [...(first.mods || [])];
        let more = first.hasMore, page = 1;
        while (more && page < 40) {
          const r = await s.listMods(mm.ctxFor(s), game.sources[id], { query: '', sort: 'popular', page, pageSize: 50 });
          all.push(...(r.mods || [])); more = r.hasMore; page++;
        }
        return more ? null : all; // only use a complete list
      } catch { return null; }
    })());
    return pools.get(id);
  };
  return {
    async find(names, label) {
      const out = [];
      const queries = [...new Set(names.map(prettyName).filter(q => q.length >= 3))].slice(0, 2);
      for (const id of order) {
        const s = mm.source(id);
        if (!s || !game.sources[id] || (s.needsKey && !s.keylessBrowse && !settings.keys[id])) continue;
        const seen = new Map();
        const consider = list => { for (const m of list || []) if (!seen.has(String(m.id))) seen.set(String(m.id), m); };
        consider(await pool(id));
        for (const q of queries) {
          try { consider((await s.listMods(mm.ctxFor(s), game.sources[id], { query: q, sort: 'popular', page: 0, pageSize: 20 })).mods); } catch { }
        }
        const scored = [...seen.values()].map(m => {
          const tail = id === 'thunderstore' ? String(m.id).split('-').slice(1).join('-') : '';
          const score = Math.max(...names.map(n => Math.max(similarity(n, m.name, drop), tail ? similarity(n, tail, drop) : 0)));
          return { m, score };
        }).filter(x => x.score >= 0.5).sort((x, y) => y.score - x.score).slice(0, 3);
        for (const { m, score } of scored) {
          out.push({ source: id, gameId: game.sources[id], modId: String(m.id), versionId: null, version: null, how: score >= 0.97 ? 'name' : 'similar', score, info: m });
        }
      }
      return out;
    },
  };
}

// Display info + newest version + (if possible) the installed version for each match.
async function fillMatches(game, pairs, mm) {
  await limit(pairs, 4, async ([c, m]) => {
    const s = mm.source(m.source);
    try {
      const info = m.info && m.info.url ? m.info : await s.getMod(mm.ctxFor(s), m.gameId, m.modId);
      m.name = info.name; m.author = info.author; m.icon = info.icon; m.url = info.url; m.summary = info.summary; m.updatedAt = info.updatedAt;
      const vs = await s.getVersions(mm.ctxFor(s), m.gameId, m.modId).catch(() => []);
      const latest = mm.pickVersion(vs, game, null);
      m.latest = latest ? { versionId: String(latest.id), version: latest.version, date: latest.date } : null;
      // Check the candidate against the user's actual files (sites that publish per-file hashes).
      if (c && c.files && c.files.length && s.manifestFor && m.how !== 'exact file') {
        const base = c.root || installer.targetRoot(game, installer.resolveLayout(game));
        const ex = await mm.matchFiles(s, c.files.map(f => path.join(base, f)), vs);
        if (ex && ex.version && !ex.partial) {
          Object.assign(m, { how: 'exact file', score: 1, versionId: String(ex.version.id), version: ex.version.version, versionDate: ex.version.date });
        } else if (ex && ex.mismatch) {
          m.filesDiffer = true; // same name maybe, but not these files
          if (m.how === 'name') m.how = 'similar';
          m.score = Math.min(m.score || 1, 0.6);
        }
      }
      if (!m.versionId && c && c.version) {
        // Same version written differently: "v1.2.0" = "1.2", "1.2+build.5", Thunderstore's BepInEx "5.4.21" = "5.4.2100".
        const norm = x => String(x || '').trim().replace(/^v/i, '').replace(/(\.0)+$/, '');
        const want = norm(c.version);
        const v = want && vs.find(x => { const have = norm(x.version); return have === want || have.startsWith(want + '+') || have.startsWith(want + '-') || have === want + '00'; });
        if (v) { m.versionId = String(v.id); m.version = v.version; m.versionDate = v.date; }
      } else if (m.versionId && !m.versionDate) {
        const v = vs.find(x => String(x.id) === String(m.versionId));
        if (v) m.versionDate = v.date;
      }
      delete m.info;
    } catch (e) { m.error = e.message; delete m.info; }
  });
}

const HOW_RANK = { 'exact file': 0, 'package manifest': 1, 'package folder': 2, name: 3, similar: 4 };
const rankMatch = order => m => (HOW_RANK[m.how] ?? 5) * 1000 - Math.round((m.score || 1) * 100) * 10 + Math.max(0, order.indexOf(m.source));

// "Search" button in the review window: look up any name on every site for this game.
async function searchSites(game, query, mm) {
  const settings = store.settings();
  const srcIds = Object.keys(game.sources || {}).filter(id => settings.sources[id] !== false);
  const order = [...(PREFERRED[installer.resolveLayout(game)] || []), ...srcIds].filter((x, i, a) => srcIds.includes(x) && a.indexOf(x) === i);
  const found = await siteFinder(game, mm, order).find([query], query);
  // A typed search should show near misses too.
  await fillMatches(game, found.map(m => [null, m]), mm);
  return found.filter(m => m.name).sort((a, b) => rankMatch(order)(a) - rankMatch(order)(b));
}

async function limit(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ---------- adopting ----------
// Moves the mod's files into ModHaven's store (keeping their paths) and adds them to the profile,
// then deploys so the game folder looks exactly as before. A backup copy is kept.
function adopt(game, profileName, picks) {
  const layout = installer.resolveLayout(game);
  const root = installer.targetRoot(game, layout);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = games.gdir(game.key, 'adopt-backup', stamp);
  const r = adoptRaw(game, profileName, picks.map(p => ({ ...p, from: root })), backup);
  let deployed = null;
  try { deployed = installer.deploy(game, games.profile(game.key, profileName)); } catch (e) { store.log('deploy after adopt', e); }
  return { ...r, backup, deployed };
}

function adoptRaw(game, profileName, picks, backup) {
  let profile = games.profile(game.key, profileName);
  const added = [];
  for (const { cand, match: m, from } of picks) {
    const source = m ? m.source : 'local';
    const id = m ? String(m.modId) : store.safeName(cand.name).slice(0, 60);
    const versionId = m && m.versionId ? String(m.versionId) : 'adopted-' + (cand.sha1 || crypto.randomBytes(4).toString('hex')).slice(0, 10);
    const uid = `${source}:${id}`;
    if (profile.mods.some(x => x.uid === uid)) continue;
    const entry = {
      uid, source, id, gameId: m ? String(m.gameId) : '', name: m ? m.name : cand.name, author: m ? m.author : cand.author || '', icon: m ? m.icon : null, url: m ? m.url : null,
      summary: m ? m.summary : `Found in the game folder (${cand.primary})`, version: (m && m.version) || cand.version || 'unknown', versionId,
      fileName: path.basename(cand.primary), modUpdatedAt: (m && m.versionDate) || null, gameVersions: [], categories: [],
      enabled: true, order: profile.mods.length, installedAt: new Date().toISOString(), dependencyOf: [], pinned: !m, autoUpdate: null, notes: '',
      adopted: { at: new Date().toISOString(), how: m ? m.how : 'not matched', files: cand.files.slice(0, 500), backup }, rawLayout: true,
      modFolder: modFolderOf(cand.files),
      latest: m && m.latest ? m.latest : null,
    };
    if (source === 'curseforge') require('./modmanager').stripStored(entry);
    const stage = installer.stageDir(game, entry);
    const fromBackup = from && from.startsWith(backup);
    for (const f of cand.files) {
      const src = path.join(from, f);
      if (!exists(src)) continue;
      const b = path.join(backup, f), s = path.join(stage, f);
      fs.mkdirSync(path.dirname(s), { recursive: true });
      if (fromBackup) { fs.copyFileSync(src, s); continue; }
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.copyFileSync(src, b);
      try { fs.renameSync(src, s); } catch { fs.copyFileSync(src, s); fs.rmSync(src, { force: true }); }
    }
    fs.writeFileSync(path.join(stage, '.staged'), entry.installedAt);
    profile.mods.push(entry);
    added.push(entry.name);
  }
  games.saveProfile(game.key, profile);
  return { added };
}

// picks: [{ cand, match }]. With replace on, matched mods are downloaded fresh from the site and the old
// files are removed (backed up first). When a site needs a manual click (Nexus free accounts), the old
// files stay in place, linked to the site mod, until that download arrives.
async function apply(game, profileName, picks, { replace = true, mm }) {
  const layout = installer.resolveLayout(game);
  const root = installer.targetRoot(game, layout);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = games.gdir(game.key, 'adopt-backup', stamp);
  const out = { replaced: [], linked: [], tracked: [], manual: [], failed: [], backup };
  const keepRaw = [];
  for (const { cand, match: m } of picks) {
    try {
      if (cand.profileUid) {
        if (!m) continue;
        if (replace) {
          const r = await tryInstall(game, profileName, m, mm);
          if (r.ok) { mm.uninstall(game.key, profileName, cand.profileUid, { withDeps: false }); out.replaced.push(m.name); continue; }
          if (r.manual) out.manual.push({ name: m.name, pageUrl: r.manual.pageUrl || m.url, reason: r.manual.reason });
          else if (r.error) out.failed.push(`${m.name}: ${r.error}`);
        }
        linkEntry(game, profileName, cand.profileUid, m);
        out.linked.push(m.name);
        continue;
      }
      // Files sitting in the game folder.
      if (m && replace) {
        moveOut(root, cand.files, path.join(backup, 'replaced'));
        const r = await tryInstall(game, profileName, m, mm);
        if (r.ok) { out.replaced.push(m.name); continue; }
        // Couldn't download: put the user's files back as before, linked to the site mod.
        if (r.manual) out.manual.push({ name: m.name, pageUrl: r.manual.pageUrl || m.url, reason: r.manual.reason });
        else if (r.error) out.failed.push(`${m.name}: ${r.error}`);
        keepRaw.push({ cand, match: m, from: path.join(backup, 'replaced') });
        continue;
      }
      keepRaw.push({ cand, match: m, from: root });
    } catch (e) { out.failed.push(`${(m && m.name) || cand.name}: ${e.message}`); }
  }
  if (keepRaw.length) {
    const r = adoptRaw(game, profileName, keepRaw, backup);
    for (const k of keepRaw) (k.match ? out.linked : out.tracked).push(k.match ? k.match.name : k.cand.name);
    void r;
  }
  try { out.deployed = installer.deploy(game, games.profile(game.key, profileName)); } catch (e) { store.log('deploy after apply', e); }
  return out;
}

async function tryInstall(game, profileName, m, mm) {
  try {
    const r = await mm.install(game.key, profileName, { source: m.source, gameId: m.gameId, modId: m.modId });
    const mine = r.manual.find(x => x.uid === `${m.source}:${m.modId}`);
    if (r.installed.length && !mine) return { ok: true };
    if (r.skipped.length && !mine) return { ok: true };
    return { manual: mine || r.manual[0] || { pageUrl: m.url } };
  } catch (e) {
    if (e.code === 'NO_KEY' || e.code === 'BAD_KEY') return { manual: { pageUrl: m.url, reason: e.message } };
    return { error: e.message };
  }
}

// Moves files out of the game folder (to a backup) so a fresh copy can take their place.
function moveOut(root, files, to) {
  for (const f of files) {
    const s = path.join(root, f);
    if (!exists(s)) continue;
    const d = path.join(to, f);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    try { fs.renameSync(s, d); } catch { fs.copyFileSync(s, d); fs.rmSync(s, { force: true }); }
  }
}

// Turns an unlinked "local" entry into one linked to a site mod (files unchanged, so updates are found).
function linkEntry(game, profileName, uid, m) {
  const p = games.profile(game.key, profileName);
  const e = p.mods.find(x => x.uid === uid);
  if (!e) return;
  const newUid = `${m.source}:${m.modId}`;
  if (p.mods.some(x => x.uid === newUid)) return;
  const oldDir = installer.stageDir(game, e);
  if (!e.modFolder) e.modFolder = modFolderOf((e.adopted && e.adopted.files) || installer.walkFiles(oldDir));
  Object.assign(e, { uid: newUid, source: m.source, id: String(m.modId), gameId: String(m.gameId), name: m.name, author: m.author || e.author, icon: m.icon || null, url: m.url || null,
    summary: m.summary || e.summary, version: m.version || e.version, versionId: m.versionId ? String(m.versionId) : e.versionId, modUpdatedAt: m.versionDate || null,
    pinned: false, latest: m.latest || null, adopted: { ...(e.adopted || {}), how: m.how, linkedAt: new Date().toISOString() } });
  if (m.source === 'curseforge') require('./modmanager').stripStored(e);
  const newDir = installer.stageDir(game, e);
  if (oldDir !== newDir && exists(oldDir)) { fs.mkdirSync(path.dirname(newDir), { recursive: true }); try { fs.renameSync(oldDir, newDir); } catch { games.copyDir(oldDir, newDir); } }
  try { if (path.dirname(oldDir) !== path.dirname(newDir)) fs.rmdirSync(path.dirname(oldDir)); } catch { } // only if empty
  for (const x of p.mods) if (x.dependencyOf) x.dependencyOf = x.dependencyOf.map(u => (u === uid ? newUid : u));
  games.saveProfile(game.key, p);
}

// Undo a wrong link: the mod goes back to being a local, unlinked mod (files unchanged).
function unlink(game, profileName, uid) {
  const p = games.profile(game.key, profileName);
  const e = p.mods.find(x => x.uid === uid);
  if (!e) throw new Error('Mod not found');
  if (!e.rawLayout) throw new Error('Only mods taken over from the game folder can be unlinked; uninstall this one instead.');
  const oldDir = installer.stageDir(game, e);
  const files = installer.walkFiles(oldDir).filter(f => f !== '.staged');
  const base = (e.adopted && e.adopted.files && e.adopted.files[0]) || files[0] || e.name;
  const name = prettyName(path.basename(String(base))).replace(/\s+/g, '') || e.name;
  const newUid = `local:${store.safeName(name).slice(0, 60)}`;
  if (p.mods.some(x => x.uid === newUid)) throw new Error('A local mod with that name already exists');
  Object.assign(e, { uid: newUid, source: 'local', id: newUid.slice(6), gameId: '', name, author: 'You', icon: null, url: null, latest: null, pinned: true,
    summary: `Found in the game folder (${base})`, adopted: { ...(e.adopted || {}), how: 'not matched', unlinkedAt: new Date().toISOString() } });
  const newDir = installer.stageDir(game, e);
  if (oldDir !== newDir && exists(oldDir)) { fs.mkdirSync(path.dirname(newDir), { recursive: true }); fs.renameSync(oldDir, newDir); }
  try { fs.rmdirSync(path.dirname(oldDir)); } catch { } // remove the now-empty "<name> [source-id]" folder
  games.saveProfile(game.key, p);
  try { installer.deploy(game, games.profile(game.key, profileName)); } catch (err) { store.log('deploy after unlink', err); }
  return e;
}

// Remembers "not a mod / leave it alone" choices.
function ignore(game, keys) {
  const g = games.get(game.key);
  g.externalIgnored = [...new Set([...(g.externalIgnored || []), ...keys])];
  games.save(g);
  return g.externalIgnored;
}

// Profile entries that came from a file / the game folder and aren't linked to any site yet.
function unlinked(game, profileName) {
  const p = profileName && games.profile(game.key, profileName);
  if (!p) return [];
  return p.mods.filter(m => m.source === 'local').map(m => {
    const dir = installer.stageDir(game, m);
    let files = [];
    try { files = installer.walkFiles(dir).filter(f => f !== '.staged'); } catch { }
    if (!files.length) return null;
    return { key: 'profile:' + m.uid, profileUid: m.uid, name: m.name, version: null, kind: 'managed', root: dir, files, primary: pickPrimary(dir, files) };
  }).filter(Boolean);
}

async function scan(game, { mm, deep = false, onProgress, profile } = {}) {
  const layout = installer.resolveLayout(game);
  const { root, candidates } = detect(game, layout);
  const ignored = new Set(game.externalIgnored || []);
  const fresh = candidates.filter(c => !ignored.has(c.key));
  const mine = unlinked(game, profile).filter(c => !ignored.has(c.key));
  const all = [...fresh, ...mine];
  if (!deep) return { root, layout, count: all.length, found: fresh.length, unlinked: mine.length, names: all.slice(0, 8).map(c => c.name), ignored: candidates.length - fresh.length };
  const described = await describe(root, all);
  const matched = await match(game, described, mm, onProgress);
  return { root, layout, count: matched.length, items: matched, ignored: candidates.length - fresh.length };
}

module.exports = { modFolderOf, unlink, scan, adopt, apply, searchSites, similarity, prettyName, ignore, detect, describe, match, cfFingerprint, dllInfo, jarInfo };
