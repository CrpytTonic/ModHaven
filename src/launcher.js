// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Launches the game, watches it, and collects crash evidence when it goes down.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { shell } = require('electron');
const store = require('./store');
const games = require('./games');
const installer = require('./installer');
const local = require('./localgames');

let emit = () => { };
function setEmitter(fn) { emit = fn; }

const run = (cmd, args, opts = {}) => new Promise(res => execFile(cmd, args, { windowsHide: true, maxBuffer: 16 << 20, ...opts }, (err, out) => res(err ? '' : String(out))));

const runsFile = key => games.gdir(key, 'runs.json');
const runs = key => store.readJson(runsFile(key), []);
function saveRun(key, r) {
  const all = runs(key).filter(x => x.id !== r.id);
  all.unshift(r);
  store.writeJson(runsFile(key), all.slice(0, 300));
}

// ---------- finding the game's processes (cheap: this runs while the user plays) ----------
// The exe names that can be the game: the configured exe first, then the other .exe files in the
// game folder (launcher -> game hand-offs). Read once per launch.
const HELPER_EXE = /^(unins|UnityCrashHandler|CrashReport|crashpad|CrashSender|vc_?redist|dxsetup|dotnet|setup|createdump|EasyAntiCheat|BEService|QuickSFV|UE4PrereqSetup|UEPrereqSetup)/i;
function gameExeNames(dir, exeName) {
  const names = [];
  const add = n => { if (n && !names.some(x => x.toLowerCase() === n.toLowerCase())) names.push(n); };
  add(exeName);
  if (!dir) return names;
  let visited = 0;
  const found = [];
  const walk = (d, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (++visited > 4000) return;
      if (e.isDirectory()) { if (depth < 4 && !/^(redist|_commonredist|directx|support|BepInEx|MelonLoader|Content|Paks|Saved|Data|mods)$/i.test(e.name)) walk(path.join(d, e.name), depth + 1); }
      else if (/\.exe$/i.test(e.name) && !HELPER_EXE.test(e.name)) found.push({ n: e.name, depth, ship: /shipping|win64|game/i.test(e.name) });
    }
  };
  walk(dir, 0);
  found.sort((a, b) => b.ship - a.ship || a.depth - b.depth);
  for (const f of found) add(f.n);
  return names.slice(0, 8);
}

// Running pids by exe name. An image-name filter costs ~0.1 s of CPU, a full list ~0.6 s: filter for a
// few names, list everything once for more.
async function pidsByNames(names) {
  const want = new Map(names.map(n => [n.toLowerCase(), n]));
  const outs = names.length <= 4
    ? await Promise.all(names.map(n => run('tasklist', ['/FI', `IMAGENAME eq ${n}`, '/FO', 'CSV', '/NH'], { timeout: 15000 })))
    : [await run('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 20000 })];
  const res = [];
  for (const out of outs) {
    for (const l of out.split(/\r?\n/)) {
      const m = l.match(/^"([^"]+)","(\d+)"/);
      if (m && want.has(m[1].toLowerCase())) res.push({ name: want.get(m[1].toLowerCase()), pid: Number(m[2]) });
    }
  }
  return res;
}

// Exe paths for a few pids (only asked when a new, not-yet-known process shows up).
async function pathsOf(pids) {
  if (!pids.length) return {};
  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.Path)" }`], { timeout: 20000 });
  const res = {};
  for (const l of out.split(/\r?\n/)) { const [pid, p] = l.split('|'); if (pid && /^\d+$/.test(pid.trim())) res[Number(pid)] = (p || '').trim(); }
  return res;
}

// Still running? (signal 0 only checks; EPERM = exists but belongs to an elevated process)
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Finds the game's processes: one of the game's exe names, running from the game folder (or the
// configured exe's folder). Each new pid's path is looked up once; known pids are remembered.
async function scanGame(s) {
  const found = [];
  const fresh = [];
  const names = new Map();
  for (const { pid, name } of await pidsByNames(s.exeNames)) {
    if (s.known.has(pid)) { if (s.known.get(pid)) found.push(pid); } else { fresh.push(pid); names.set(pid, name); }
  }
  if (fresh.length) {
    const paths = await pathsOf(fresh);
    const dirs = [s.dir, s.game.exe && path.dirname(s.game.exe)].filter(Boolean).map(d => path.resolve(d).toLowerCase() + path.sep);
    const inDir = p => dirs.some(d => path.resolve(p).toLowerCase().startsWith(d));
    const psFailed = !Object.keys(paths).length;
    // Empty path = an elevated process we can't look into; it has one of the game's exe names, so it counts.
    for (const pid of fresh) {
      // PowerShell not answering at all: fall back to the configured exe name (the old behaviour).
      if (psFailed) { if (s.exeName && names.get(pid).toLowerCase() === s.exeName.toLowerCase()) found.push(pid); continue; }
      if (!(pid in paths)) continue; // already gone: nothing to remember
      const ok = !paths[pid] || inDir(paths[pid]);
      s.known.set(pid, ok);
      if (ok) found.push(pid);
    }
  }
  return found;
}

const active = new Map(); // game key -> session
const anyRunning = () => active.size > 0;

function status(key) {
  const s = active.get(key);
  return s ? { running: true, runId: s.run.id, startedAt: s.run.startedAt, autoTest: !!s.autoTest, profile: s.run.profile } : { running: false };
}

// opts: { profile (name) | vanilla:true, autoTestSeconds, mods override (array of uids for culprit search) }
const starting = new Set(); // keys between "launch" and the session existing (blocks double starts)
async function launch(key, opts = {}) {
  if (active.has(key) || starting.has(key)) throw new Error('The game is already running');
  starting.add(key);
  try { return await launchNow(key, opts); } finally { starting.delete(key); }
}
async function launchNow(key, opts) {
  let game = games.get(key);
  if (!game) throw new Error('Unknown game');
  const viaStore = !!((game.launchVia === 'steam' && game.steamAppId) || (game.launchVia === 'epic' && game.launchUri));
  // Check before touching the game folder or recording a run that would stay "running" for ever.
  if (!viaStore && (!game.exe || !fs.existsSync(game.exe))) throw new Error('Game exe not found — set it in Game settings');
  const versionInfo = await games.refreshVersion(game);
  // Save only the version fields on top of a fresh read (game settings may have been saved meanwhile).
  const cur = games.get(key) || game;
  for (const k of ['gameVersion', 'gameVersionUpdatedAt', 'versionHistory', 'versionChangedNotice', 'updatePending', 'publicVersion', 'publicVersionDate', 'pendingVersion']) if (k in game) cur[k] = game[k];
  game = games.save(cur);
  let profile = null;
  if (opts.vanilla) installer.undeploy(game);
  else {
    const pname = opts.profile || game.activeProfile || 'Default';
    profile = games.profile(key, pname);
    if (!profile) throw new Error(`Profile "${pname}" not found`);
    if (opts.onlyMods) {
      // Culprit search: run a temporary subset without touching what the user turned on.
      const keep = new Set(opts.onlyMods);
      const temp = { ...profile, mods: profile.mods.map(m => ({ ...m, enabled: keep.has(m.uid) })) };
      installer.deploy(game, temp, { save: false });
      // Keep the file lists (used to map crash DLLs back to mods) without changing on/off.
      const files = new Map(temp.mods.filter(m => m.deployedFiles).map(m => [m.uid, m.deployedFiles]));
      for (const m of profile.mods) if (files.has(m.uid)) m.deployedFiles = files.get(m.uid);
      games.saveProfile(key, profile);
    } else installer.deploy(game, profile);
  }
  const enabledMods = opts.vanilla ? [] : (opts.onlyMods ? profile.mods.filter(m => opts.onlyMods.includes(m.uid)) : profile.mods.filter(m => m.enabled));
  const r = {
    id: crypto.randomUUID(), startedAt: new Date().toISOString(), endedAt: null, durationSec: null,
    profile: profile ? profile.name : null, vanilla: !!opts.vanilla, gameVersion: game.gameVersion,
    mods: enabledMods.map(m => ({ uid: m.uid, name: m.name, version: m.version, versionId: m.versionId, source: m.source })),
    outcome: 'running', exitCode: null, evidence: [], culprits: [], logs: [], autoTest: opts.autoTestSeconds || null,
    search: opts.searchId || null, gameVersionChanged: versionInfo.changed ? versionInfo : null,
  };
  saveRun(key, r);
  const t0 = Date.now();
  const snap = snapshotLogs(game);
  let child = null;
  const exe = game.exe;
  const workDir = game.installPath || (exe ? path.dirname(exe) : undefined);
  const args = String(game.args || '').match(/(?:[^\s"]+|"[^"]*")+/g)?.map(a => a.replace(/^"|"$/g, '')) || [];
  if (game.launchVia === 'steam' && game.steamAppId) {
    shell.openExternal(`steam://run/${game.steamAppId}//${encodeURIComponent(args.join(' '))}`).catch(e => store.log('steam launch', e.message));
  } else if (game.launchVia === 'epic' && game.launchUri) {
    shell.openExternal(game.launchUri).catch(e => store.log('epic launch', e.message));
  }
  const session = { run: r, game, child: null, exitCode: null, autoTest: opts.autoTestSeconds || null, snap, t0, stopped: false, sawProcess: false };
  if (!viaStore) {
    try {
      child = spawn(exe, args, { cwd: workDir, detached: true, stdio: 'ignore', windowsHide: !!process.env.MH_HARNESS });
      // Without this listener a refused start (e.g. an exe that needs administrator rights) is an
      // uncaught error in the main process.
      child.on('error', e => { session.spawnError = e; store.log('game failed to start', exe, e.message); });
      child.on('exit', code => { session.exitCode = code; });
      child.unref();
    } catch (e) { session.spawnError = e; }
    session.child = child;
  }
  active.set(key, session);
  emit('run', { key, status: status(key), run: r });
  watch(key, session).catch(e => store.log('watch failed', e)).then(() => finish(key, session)).catch(e => store.log('finish failed', e));
  return r;
}

// Watches the game while it runs. Cheap on purpose: a liveness check on known pids every few seconds;
// the process list is only read while waiting for the game to appear, a few times early on (to catch
// a game started by a launcher that stays open), and when every known process is gone (hand-offs).
const POLL_MS = 4000;
async function watch(key, s) {
  s.dir = s.game.installPath || (s.game.exe ? path.dirname(s.game.exe) : '');
  s.exeName = s.game.exe ? path.basename(s.game.exe) : null;
  s.exeNames = gameExeNames(s.dir, s.exeName);
  s.known = new Map(); // pid -> is it the game
  const pids = new Set();
  if (s.child && s.child.pid) { pids.add(s.child.pid); s.known.set(s.child.pid, true); }
  const deadline = Date.now() + 3 * 60e3; // game must appear within 3 min (Steam can be slow)
  const extraScans = [6e3, 20e3, 60e3];
  let missed = 0;
  while (true) {
    await new Promise(r => setTimeout(r, missed ? 2000 : POLL_MS));
    for (const pid of [...pids]) if (!alive(pid)) pids.delete(pid);
    const since = Date.now() - s.t0;
    let scan = !pids.size;
    while (extraScans.length && since >= extraScans[0]) { extraScans.shift(); scan = true; }
    if (scan && s.exeNames.length) for (const pid of await scanGame(s)) if (alive(pid)) pids.add(pid);
    if (pids.size) {
      s.sawProcess = true; missed = 0; s.pids = [...pids];
      if (s.autoTest && since / 1000 >= s.autoTest + 15) {
        // Survived long enough: count as a pass and close it.
        s.autoPassed = true;
        if (store.settings().closeGameAfterAutoTest) for (const pid of pids) try { process.kill(pid); } catch { }
      }
    } else if (!s.sawProcess) {
      if (s.spawnError) break;
      if (s.child && s.exitCode != null && since > 8000) break; // exe started and quit without a lingering process
      if (Date.now() > deadline) break;
    } else if (++missed >= 2) break; // gone on two checks in a row (allows launcher -> game hand-offs)
  }
}

const CRASH_CODES = new Set([0xC0000005, 0xC0000409, 0xC00000FD, 0xC0000374, 0xE0434352, 0x80000003, 0xC000001D, 0xC0000096, 0xC0000094, 0x40000015]);

// The session stays in `active` until the verdict is saved, so waitFor() and a second launch
// never see a half-finished run.
async function finish(key, s) {
  const r = s.run;
  try {
    await finishNow(key, s);
  } catch (e) {
    store.log('collecting crash info failed', key, e);
    if (r.outcome === 'running') r.outcome = s.autoPassed ? 'passed' : (s.sawProcess ? 'ok' : 'failed-to-start');
    try { saveRun(key, r); } catch { }
  } finally {
    active.delete(key);
    emit('run', { key, status: status(key), run: r });
    if (s.resolve) s.resolve(r);
  }
}
async function finishNow(key, s) {
  const r = s.run;
  r.endedAt = new Date().toISOString();
  r.durationSec = Math.round((Date.now() - s.t0) / 1000);
  r.exitCode = s.exitCode;
  const game = games.get(key) || s.game;
  const ev = await collectEvidence(game, s);
  if (s.spawnError) ev.evidence.unshift({ kind: 'windows', text: `Windows refused to start ${path.basename(game.exe || 'the game')}: ${s.spawnError.message}${/EACCES|740|elevation/i.test(`${s.spawnError.message} ${s.spawnError.code}`) ? ' (it may need to run as administrator)' : ''}` });
  r.evidence = ev.evidence;
  r.logs = ev.logs;
  const code = s.exitCode == null ? null : (s.exitCode >>> 0);
  const crashed = ev.hardCrash || (code != null && CRASH_CODES.has(code)) || (code != null && code > 0x80000000 && !s.autoPassed);
  if (s.autoPassed) r.outcome = 'passed';
  else if (crashed) r.outcome = 'crashed';
  else if (!s.sawProcess && !(s.child && s.exitCode === 0)) r.outcome = 'failed-to-start';
  else if (ev.softErrors) r.outcome = 'closed-with-errors';
  else r.outcome = 'ok';
  if ((r.outcome === 'crashed' || r.outcome === 'failed-to-start') && !s.spawnError) r.culprits = blame(game, r, ev);
  saveRun(key, r);
}

// Lets the user override the verdict ("it crashed" / "it worked fine").
function setOutcome(key, runId, outcome) {
  const r = runs(key).find(x => x.id === runId);
  if (!r) throw new Error('Run not found');
  r.outcome = outcome;
  r.userSet = true;
  if (outcome === 'crashed' && !r.culprits.length) r.culprits = blame(games.get(key), r, { evidence: r.evidence || [] });
  saveRun(key, r);
  emit('run', { key, status: status(key), run: r });
  return r;
}

function stop(key) {
  const s = active.get(key);
  if (!s) return false;
  s.stopped = true;
  const pids = new Set(s.pids || []);
  if (s.child && s.child.pid && s.exitCode == null) pids.add(s.child.pid);
  for (const pid of pids) try { process.kill(pid); } catch { }
  return true;
}

// Wait for a run to end (used by the culprit search).
function waitFor(key) {
  const s = active.get(key);
  if (!s) return Promise.resolve(runs(key)[0]);
  return new Promise(res => { s.resolve = res; });
}

// ---------- evidence ----------
function logCandidates(game) {
  const out = [];
  const ip = game.installPath;
  if (ip) {
    out.push(path.join(ip, 'BepInEx', 'LogOutput.log'), path.join(ip, 'BepInEx', 'ErrorLog.log'), path.join(ip, 'MelonLoader', 'Latest.log'),
      path.join(ip, 'Data', 'SKSE', 'skse64.log'));
  }
  const eng = ip ? local.engineInfo(ip, game.exe) : {};
  if (eng.company && eng.product) {
    const ll = path.join(os.homedir(), 'AppData', 'LocalLow', eng.company, eng.product);
    out.push(path.join(ll, 'Player.log'));
    out.push({ dir: path.join(os.tmpdir(), eng.company, eng.product, 'Crashes') });
    out.push({ dir: path.join(ll, 'Crashes') });
  }
  if (ip) out.push({ dir: ip, only: /\.(dmp|mdmp)$|crash.*\.(log|txt)$/i, depth: 1 });
  out.push({ dir: path.join(os.homedir(), 'Documents', 'My Games'), only: /crash.*\.(log|txt)$/i, depth: 3 });
  if (ip && eng.engine === 'unreal') {
    // Unreal: <Project>/Saved/Logs + Saved/Crashes, in the game folder or %LOCALAPPDATA%
    for (const e of safeReaddir(ip)) {
      out.push({ dir: path.join(ip, e, 'Saved', 'Logs'), only: /\.log$/i });
      out.push({ dir: path.join(ip, e, 'Saved', 'Crashes') });
      out.push({ dir: path.join(process.env.LOCALAPPDATA || '', e, 'Saved', 'Crashes') });
      out.push({ dir: path.join(process.env.LOCALAPPDATA || '', e, 'Saved', 'Logs'), only: /\.log$/i });
    }
  }
  return out;
}
const safeReaddir = d => { try { return fs.readdirSync(d); } catch { return []; } };

function listFiles(c) {
  if (typeof c === 'string') return [c];
  const res = [];
  const walk = (d, depth) => {
    for (const e of safeReaddir(d)) {
      const p = path.join(d, e);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (depth < (c.depth ?? 3)) walk(p, depth + 1); }
      else if (!c.only || c.only.test(e)) res.push(p);
    }
  };
  walk(c.dir, 0);
  return res;
}

function snapshotLogs(game) {
  const snap = new Map();
  for (const c of logCandidates(game)) for (const f of listFiles(c)) { try { snap.set(f, fs.statSync(f).mtimeMs); } catch { } }
  return snap;
}

async function collectEvidence(game, s) {
  const evidence = [];
  const logs = [];
  let hardCrash = false, softErrors = 0;
  const dest = games.gdir(game.key, 'crashlogs', s.run.id);
  // 1) Logs / dumps written during this run
  for (const c of logCandidates(game)) {
    for (const f of listFiles(c)) {
      let st; try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < s.t0 - 2000) continue;
      if (s.snap.has(f) && s.snap.get(f) === st.mtimeMs) continue;
      if (st.size > 200 << 20) continue;
      fs.mkdirSync(dest, { recursive: true });
      const name = path.basename(path.dirname(f)) + '__' + path.basename(f);
      try { fs.copyFileSync(f, path.join(dest, name)); logs.push({ name, original: f, size: st.size }); } catch { }
      if (/\.(dmp|mdmp)$/i.test(f) || /[\\/]Crashes[\\/]/i.test(f)) { hardCrash = true; evidence.push({ kind: 'dump', text: `Crash dump written: ${f}` }); }
      if (/\.(log|txt)$/i.test(f) && st.size < 50 << 20) {
        const res = scanLog(game, fs.readFileSync(f, 'utf8'), path.basename(f));
        evidence.push(...res.evidence);
        softErrors += res.errors;
        if (res.fatal) hardCrash = true;
      }
    }
  }
  // 2) Windows "Application Error" / ".NET Runtime" / WER events for this exe since launch
  const exeName = game.exe ? path.basename(game.exe) : null;
  const since = new Date(s.t0 - 5000).toISOString();
  const ps = `$s=[datetime]'${since}'; Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=$s; Id=1000,1001,1026} -ErrorAction SilentlyContinue | ForEach-Object { "<<EV>>$($_.Id)|$($_.ProviderName)|$($_.Message)" }`;
  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  for (const chunk of out.split('<<EV>>').filter(Boolean)) {
    const [id, provider, ...rest] = chunk.split('|');
    const msg = rest.join('|');
    if (exeName && !msg.toLowerCase().includes(exeName.toLowerCase()) && !(game.installPath && msg.toLowerCase().includes(game.installPath.toLowerCase()))) continue;
    if (id === '1001' && !/APPCRASH|BEX|CLR20r3|AppHang/i.test(msg)) continue;
    hardCrash = hardCrash || id !== '1001' || /APPCRASH|BEX|CLR20r3/i.test(msg);
    const mod = (msg.match(/Faulting module (?:name|path):\s*([^,\r\n]+)/i) || [])[1];
    const exc = (msg.match(/Exception code:\s*(0x[0-9a-f]+)/i) || [])[1];
    const net = provider === '.NET Runtime' ? (msg.match(/Exception Info:\s*([^\r\n]+)/i) || [])[1] : null;
    evidence.push({ kind: 'windows', text: `Windows logged a ${provider} event${mod ? ` — faulting module ${mod.trim()}` : ''}${exc ? ` (code ${exc})` : ''}${net ? ` — ${net}` : ''}`, module: mod ? path.basename(mod.trim()) : null });
  }
  return { evidence: dedupe(evidence).slice(0, 60), logs, hardCrash, softErrors };
}

const dedupe = arr => { const seen = new Set(); return arr.filter(e => { const k = e.kind + e.text; if (seen.has(k)) return false; seen.add(k); return true; }); };

// Pulls mod names / DLLs out of error lines and stack traces.
function scanLog(game, text, file) {
  const evidence = [];
  let errors = 0, fatal = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/\b(Crash!!!|Fatal error|Unhandled Exception|EXCEPTION_ACCESS_VIOLATION|Segmentation fault|FATAL ERROR|Assertion failed|Native Crash Reporting|Got a UNKNOWN while executing native code)\b/i.test(l)) {
      fatal = true;
      evidence.push({ kind: 'log', file, text: l.trim().slice(0, 300), context: lines.slice(Math.max(0, i - 3), i + 12).join('\n').slice(0, 2000) });
    }
    const bep = l.match(/^\[(Error|Fatal)\s*:\s*([^\]]+?)\s*\]\s*(.*)$/);
    if (bep) {
      errors++;
      if (bep[2] !== 'Unity Log' || /Exception/i.test(bep[3])) {
        evidence.push({ kind: 'log', file, text: `${bep[1]} from ${bep[2]}: ${bep[3]}`.slice(0, 300), plugin: bep[2].trim(), context: lines.slice(i, i + 15).join('\n').slice(0, 2000) });
      }
    }
    const dll = l.match(/([\w.\-]+\.dll)/i);
    if (dll && /exception|error|failed|could not load|missing|crash/i.test(l.replace(dll[1], '')) && !/^(mscorlib|System|Unity|UnityEngine|Assembly-CSharp|kernel32|ntdll|KERNELBASE|mono|mono-2\.0-bdwgc|UnityPlayer|d3d11|dxgi|nvwgf2umx|amdxx64)[\w.\-]*\.dll$/i.test(dll[1])) {
      evidence.push({ kind: 'log', file, text: l.trim().slice(0, 300), module: dll[1] });
    }
    const missingDep = l.match(/Could not load \[([^\]]+)\] because it has missing dependencies:\s*(.*)$/i);
    if (missingDep) evidence.push({ kind: 'log', file, text: `${missingDep[1]} is missing dependencies: ${missingDep[2]}`, plugin: missingDep[1] });
    const incompatible = l.match(/Could not load \[([^\]]+)\] because it is incompatible with:?\s*(.*)$/i);
    if (incompatible) evidence.push({ kind: 'log', file, text: `${incompatible[1]} says it is incompatible with ${incompatible[2]}`, plugin: incompatible[1], incompatibleWith: incompatible[2] });
    // Stack frames: "at Namespace.Class.Method" -> namespace roots
    const frame = l.match(/^\s+at\s+([A-Za-z_][\w]*)\.([\w.]+)/);
    if (frame && !/^(System|UnityEngine|Unity|Mono|BepInEx|HarmonyLib|MonoMod|Microsoft|TMPro|Steamworks|\(wrapper)$/.test(frame[1]) && /exception|error/i.test(lines.slice(Math.max(0, i - 8), i).join(' '))) {
      evidence.push({ kind: 'stack', file, text: l.trim().slice(0, 200), ns: frame[1] });
    }
  }
  return { evidence: dedupe(evidence).slice(0, 40), errors, fatal };
}

// Matches evidence to the mods that were on for this run.
function blame(game, r, ev) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const scores = new Map();
  const hit = (uid, pts, why) => {
    if (!uid) return;
    const e = scores.get(uid) || { uid, score: 0, reasons: [] };
    e.score += pts;
    if (!e.reasons.includes(why)) e.reasons.push(why);
    scores.set(uid, e);
  };
  const mods = r.mods || [];
  const profile = r.profile ? games.profile(game.key, r.profile) : null;
  const filesOf = uid => ((profile && profile.mods.find(m => m.uid === uid)) || {}).deployedFiles || [];
  for (const e of ev.evidence || []) {
    if (e.module) {
      const owner = installer.ownerOf(game, e.module) || mods.find(m => filesOf(m.uid).some(f => f.toLowerCase().endsWith('/' + e.module.toLowerCase())))?.uid;
      if (owner) hit(owner, e.kind === 'windows' ? 10 : 4, e.kind === 'windows' ? `The crash happened inside ${e.module}, which this mod installed` : `${e.module} (from this mod) shows up in an error`);
    }
    const tag = e.plugin || e.ns;
    if (tag) {
      const t = norm(tag);
      for (const m of mods) {
        const n = norm(m.name), idn = norm(String(m.uid).split(':').pop().split('-').pop());
        const fileMatch = filesOf(m.uid).some(f => norm(path.basename(f, '.dll')) === t);
        if (t && (n === t || idn === t || fileMatch || (t.length > 4 && (n.includes(t) || t.includes(n) && n.length > 4)))) {
          hit(m.uid, e.ns ? 2 : (/Fatal/i.test(e.text) ? 5 : 3), e.ns ? `Its code (${tag}) is in the crash stack trace` : `It logged: ${e.text.slice(0, 140)}`);
        }
      }
    }
    if (e.incompatibleWith) {
      for (const m of mods) if (norm(e.incompatibleWith).includes(norm(m.name)) && norm(m.name).length > 3) hit(m.uid, 4, `Another mod says it's incompatible with this one`);
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}

module.exports = { setEmitter, launch, stop, status, anyRunning, runs, setOutcome, waitFor, scanLog, blame, saveRun };
