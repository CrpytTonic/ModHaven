// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Turns launch history into per-mod status triangles and mod-vs-mod conflict info,
// and runs the "find the culprit" search (split the mod list in half until the crash is pinned down).
const games = require('./games');
const installer = require('./installer');
const launcher = require('./launcher');
const store = require('./store');

const BAD = new Set(['crashed', 'failed-to-start']);
const GOOD = new Set(['ok', 'passed', 'closed-with-errors']);

// status: 'broken' (red) | 'conflict' (yellow) | 'works' (green) | 'untested' (half yellow/green)
function analyse(key, profileName) {
  const game = games.get(key);
  const profile = games.profile(key, profileName);
  if (!game || !profile) throw new Error('Unknown game or profile');
  const all = launcher.runs(key).filter(r => !r.vanilla && r.outcome !== 'running');
  const ver = game.gameVersion;
  const sameVer = all.filter(r => !ver || !r.gameVersion || r.gameVersion === ver);
  const vanillaCrash = launcher.runs(key).find(r => r.vanilla && BAD.has(r.outcome) && r.gameVersion === ver);
  const runKey = m => `${m.uid}@${m.versionId}`;
  const inRun = (r, m) => r.mods.some(x => x.uid === m.uid && String(x.versionId) === String(m.versionId));

  // Pairs: tested together and worked / crashed together
  const pairs = {}; // "a|b" -> {ok, bad, confirmed, files}
  const pk = (a, b) => [a, b].sort().join('|');
  // Confirmed conflicts from culprit searches
  const verdicts = store.readJson(games.gdir(key, 'verdicts.json'), []).filter(v => !ver || !v.gameVersion || v.gameVersion === ver);
  // A crash with a known culprit (or known clashing pair) on is already explained,
  // so it says nothing about the other mods that happened to be on.
  const explained = r => {
    const on = new Set(r.mods.map(m => m.uid));
    return verdicts.some(v => (v.kind === 'single' && on.has(v.uid)) || (v.kind === 'pair' && on.has(v.a) && on.has(v.b)));
  };
  for (const r of sameVer) {
    const uids = r.mods.map(m => m.uid);
    if (uids.length > 60) continue; // too many to say anything per pair
    const bad = BAD.has(r.outcome) && !explained(r);
    for (let i = 0; i < uids.length; i++) for (let j = i + 1; j < uids.length; j++) {
      const p = pairs[pk(uids[i], uids[j])] = pairs[pk(uids[i], uids[j])] || { ok: 0, bad: 0, confirmed: false };
      if (GOOD.has(r.outcome)) p.ok++; else if (bad) p.bad++;
    }
  }
  for (const v of verdicts) {
    if (v.kind === 'pair') { const p = pairs[pk(v.a, v.b)] = pairs[pk(v.a, v.b)] || { ok: 0, bad: 0 }; p.confirmed = true; p.ok = 0; }
  }
  const fileC = (() => { try { return installer.fileConflicts(game, profile); } catch { return {}; } })();
  for (const [k, files] of Object.entries(fileC)) { (pairs[k] = pairs[k] || { ok: 0, bad: 0, confirmed: false }).files = files.slice(0, 20); }

  const status = {};
  const lastRun = sameVer[0];
  for (const m of profile.mods) {
    const reasons = [];
    let st = 'untested';
    const mine = sameVer.filter(r => inRun(r, m));
    const goods = mine.filter(r => GOOD.has(r.outcome));
    const bads = mine.filter(r => BAD.has(r.outcome));
    const soloBad = bads.filter(r => r.mods.length <= 1 + depCount(profile, m)).length;
    // Blamed = top suspect in a crash's logs (not just "was switched on").
    const blamed = bads.filter(r => (r.culprits || []).some((c, i) => c.uid === m.uid && (c.score >= 8 || (i === 0 && c.score >= 4)))).length;
    const verdictSolo = verdicts.find(v => v.kind === 'single' && v.uid === m.uid && String(v.versionId) === String(m.versionId));
    const declaredBad = m.gameVersions && m.gameVersions.length && game.mcVersion && game.key === 'minecraft' && !m.gameVersions.includes(game.mcVersion);
    const myPairs = Object.entries(pairs).filter(([k]) => k.split('|').includes(m.uid));
    // Suspect pair: crashed every time both were on, yet each one has worked without the other.
    const conflictsWith = myPairs.filter(([k, p]) => {
      if (p.confirmed) return true;
      if (!(p.bad > 0 && p.ok === 0)) return false;
      const [a, b] = k.split('|');
      return workedWithout(sameVer, a, b) && workedWithout(sameVer, b, a);
    }).map(([k, p]) => ({ uid: k.split('|').find(u => u !== m.uid), confirmed: !!p.confirmed, crashes: p.bad, files: p.files || null }));
    const fileOnly = myPairs.filter(([, p]) => p.files && !p.confirmed && !(p.bad > 0 && p.ok === 0)).map(([k, p]) => ({ uid: k.split('|').find(u => u !== m.uid), files: p.files }));

    if (m.deprecated) { st = 'broken'; reasons.push('The author marked this mod as deprecated / no longer maintained'); }
    if (declaredBad) { st = 'broken'; reasons.push(`This version is made for ${m.gameVersions.slice(0, 4).join(', ')}, not ${game.mcVersion}`); }
    if (verdictSolo) { st = 'broken'; reasons.push(`Culprit search found this mod crashes the game on its own (${verdictSolo.at.slice(0, 10)})`); }
    else if (soloBad && !goods.length) { st = 'broken'; reasons.push('The game crashed with only this mod turned on'); }
    if (st !== 'broken') {
      const confirmed = conflictsWith.filter(c => c.confirmed);
      if (confirmed.length || conflictsWith.length || (blamed && bads[0] === mine[0])) {
        st = 'conflict';
        if (blamed) reasons.push(`Crash logs point at this mod (${blamed} crash${blamed > 1 ? 'es' : ''})`);
        for (const c of conflictsWith.slice(0, 6)) reasons.push(`${c.confirmed ? 'Confirmed conflict' : 'Crashed together'} with ${nameOf(profile, c.uid)}`);
      } else if (goods.length && (!m.latest || String(m.latest.versionId) === String(m.versionId) || m.pinned)) {
        st = 'works';
        reasons.push(`Worked in ${goods.length} launch${goods.length > 1 ? 'es' : ''} on game version ${ver || '?'}`);
      } else if (goods.length) {
        st = 'works';
        reasons.push(`Worked on this game version, but a newer mod version (${m.latest.version}) is available`);
      } else {
        reasons.push(mine.length ? 'Not confirmed working yet' : (all.some(r => inRun(r, m)) ? `Not tested since the game updated to ${ver}` : 'Not launched with this version yet'));
      }
    }
    if (m.madeFor && game.publicVersion && m.madeFor.how !== 'listed' && gvCmp(m.madeFor.version, game.publicVersion) < 0) {
      reasons.push(`Made for game ${m.madeFor.version}${m.madeFor.how === 'estimated' ? ' (going by its release date)' : ''}; your game is ${game.publicVersion}. Mods for older game versions can stop working after an update.`);
    }
    if (m.latest && String(m.latest.versionId) !== String(m.versionId) && st !== 'broken' && isOlderThanGame(m, game)) {
      reasons.push(`Mod release is older than the latest game update (${(game.gameVersionUpdatedAt || '').slice(0, 10)})`);
    }
    status[m.uid] = { status: st, reasons, conflictsWith, fileConflicts: fileOnly, launches: mine.length, crashes: bads.length, worked: goods.length };
  }
  return { status, pairs, vanillaCrash: vanillaCrash ? vanillaCrash.id : null, gameVersion: ver, lastRun: lastRun ? lastRun.id : null, verdicts };
}

// Compare the first three parts of a version (1.0.0.4 vs 1.0.1): patch-level builds rarely break mods.
const gvCmp = (a, b) => require('./gameversion').cmp(String(a).split('.').slice(0, 3).join('.'), String(b).split('.').slice(0, 3).join('.'));
const workedWithout = (runs, a, b) => runs.some(r => GOOD.has(r.outcome) && r.mods.some(x => x.uid === a) && !r.mods.some(x => x.uid === b));
const nameOf = (profile, uid) => (profile.mods.find(m => m.uid === uid) || { name: uid.split(':').pop() }).name;
const depCount = (profile, m) => profile.mods.filter(x => (x.dependencyOf || []).includes(m.uid)).length + profile.mods.filter(x => (m.dependencyOf || []).includes(x.uid)).length;
const isOlderThanGame = (m, g) => g.gameVersionUpdatedAt && m.modUpdatedAt && m.modUpdatedAt < g.gameVersionUpdatedAt;

// Matrix for the conflict view: rows/cols = enabled mods, cell = 'ok' | 'suspect' | 'confirmed' | 'files' | null
function matrix(key, profileName) {
  const profile = games.profile(key, profileName);
  const a = analyse(key, profileName);
  const mods = profile.mods.filter(m => m.enabled).map(m => ({ uid: m.uid, name: m.name, status: (a.status[m.uid] || {}).status }));
  const runs = launcher.runs(key).filter(r => !r.vanilla && (!a.gameVersion || !r.gameVersion || r.gameVersion === a.gameVersion));
  const cell = {};
  for (const [k, p] of Object.entries(a.pairs)) {
    const [x, y] = k.split('|');
    const suspect = p.bad && !p.ok && workedWithout(runs, x, y) && workedWithout(runs, y, x);
    // 'unknown' = only ever crashed together alongside other mods: not enough to say.
    cell[k] = p.confirmed ? 'confirmed' : suspect ? 'suspect' : p.ok ? (p.files ? 'files' : 'ok') : p.files ? 'files' : p.bad ? 'unknown' : null;
  }
  return { mods, cell, pairs: a.pairs };
}

// ---------- culprit search ----------
// Classic "split in half": find the smallest set of mods that still crashes, with required dependencies kept together.
const searches = new Map();
let emit = () => { };
function setEmitter(fn) { emit = fn; }

function searchState(key) {
  const s = searches.get(key);
  return s ? { ...s.pub } : store.readJson(games.gdir(key, 'search-last.json'), null);
}

// mode 'auto': ModHaven launches, waits autoTestSeconds, closes game if still alive (= pass).
// mode 'manual': ModHaven launches, you play to the crash point and the run ends when you close/crash it.
async function startSearch(key, profileName, { mode = 'auto', seconds } = {}) {
  if (searches.has(key)) throw new Error('A culprit search is already running');
  const profile = games.profile(key, profileName);
  const game = games.get(key);
  if (!game || !profile) throw new Error('Unknown game or profile');
  const enabled = profile.mods.filter(m => m.enabled);
  if (enabled.length < 1) throw new Error('Turn on the mods you want to test first');
  const secs = seconds || store.settings().autoTestSeconds;
  const id = 'search-' + Date.now();
  const s = { id, cancelled: false, pub: { id, key, profile: profileName, mode, seconds: secs, state: 'running', step: 0, maxSteps: Math.ceil(Math.log2(enabled.length + 1)) * 2 + 3, log: [], result: null, startedAt: new Date().toISOString() } };
  searches.set(key, s);
  const pub = s.pub;
  const say = text => { pub.log.push({ t: new Date().toISOString(), text }); emit('search', { key, state: { ...pub } }); };

  // Mods that must travel with a mod (its dependencies, recursively).
  const byUid = new Map(profile.mods.map(m => [m.uid, m]));
  const depsOf = uid => {
    const out = new Set();
    const visit = u => { for (const m of profile.mods) if ((m.dependencyOf || []).includes(u) && !out.has(m.uid)) { out.add(m.uid); visit(m.uid); } };
    visit(uid);
    return out;
  };
  // Libraries (things others depend on) aren't split on their own; they come along with their dependents.
  const isLib = m => profile.mods.some(x => x.enabled && (m.dependencyOf || []).includes(x.uid));
  const units = enabled.filter(m => !isLib(m)).map(m => m.uid);
  const libsAlone = enabled.filter(isLib).map(m => m.uid);
  const expand = set => { const out = new Set(); for (const u of set) { out.add(u); for (const d of depsOf(u)) out.add(d); } return [...out]; };

  const test = async (set, label) => {
    if (s.cancelled) throw new Error('cancelled');
    pub.step++;
    const mods = expand(set);
    pub.current = { label, mods: mods.map(u => byUid.get(u)?.name || u) };
    say(`Test ${pub.step}: ${label} — ${mods.length} mod${mods.length === 1 ? '' : 's'} on`);
    await launcher.launch(key, { profile: profileName, onlyMods: mods, autoTestSeconds: mode === 'auto' ? secs : null, searchId: id });
    const r = await launcher.waitFor(key);
    const crashed = BAD.has(r.outcome);
    say(`  → ${crashed ? 'crashed' : 'worked'}${r.durationSec != null ? ` after ${r.durationSec}s` : ''}`);
    return crashed;
  };

  const run = async () => {
    try {
      say(`Checking the full set first (${enabled.length} mods)…`);
      if (!(await test(units.length ? units : libsAlone, 'all mods'))) {
        pub.result = { kind: 'no-crash', text: 'The game did not crash with all mods on, so there is nothing to narrow down. Try manual mode and play to the point where it crashes.' };
        return;
      }
      if (!units.length) { pub.result = { kind: 'libs', text: 'Only libraries are on — the crash is in one of them or in the game.' }; return; }
      // Vanilla check tells us whether the game itself is the problem.
      say('Checking the game with no mods…');
      pub.step++;
      await launcher.launch(key, { vanilla: true, autoTestSeconds: mode === 'auto' ? secs : null, searchId: id });
      const v = await launcher.waitFor(key);
      if (BAD.has(v.outcome)) { pub.result = { kind: 'vanilla', text: 'The game crashes even with no mods, so the problem is the game install (verify files in Steam) or drivers, not a mod.' }; return; }
      say('  → game is fine without mods');

      // find(X, base): smallest part of X that crashes when combined with base.
      const find = async (X, base) => {
        if (X.length === 1) return X;
        const h = Math.ceil(X.length / 2);
        const A = X.slice(0, h), B = X.slice(h);
        if (await test([...base, ...A], `first half of ${X.length}`)) return find(A, base);
        if (await test([...base, ...B], `second half of ${X.length}`)) return find(B, base);
        // Neither half crashes alone → mods from both halves clash.
        say('Neither half crashes on its own, so mods from both halves are clashing. Narrowing each side…');
        const a = await find(A, [...base, ...B]);
        const b = await find(B, [...base, ...a]);
        return [...a, ...b];
      };
      const culprit = await find(units, []);
      const names = culprit.map(u => byUid.get(u)?.name || u);
      const now = new Date().toISOString();
      const verdicts = store.readJson(games.gdir(key, 'verdicts.json'), []);
      if (culprit.length === 1) {
        const m = byUid.get(culprit[0]);
        verdicts.push({ kind: 'single', uid: m.uid, versionId: m.versionId, gameVersion: game.gameVersion, at: now });
        pub.result = { kind: 'single', mods: culprit, text: `${names[0]} crashes the game by itself${depsOf(m.uid).size ? ' (with its required libraries)' : ''}. Turn it off or try another version of it.` };
      } else {
        for (let i = 0; i < culprit.length; i++) for (let j = i + 1; j < culprit.length; j++) verdicts.push({ kind: 'pair', a: culprit[i], b: culprit[j], gameVersion: game.gameVersion, at: now });
        pub.result = { kind: 'pair', mods: culprit, text: `${names.join(' + ')} work on their own but crash when used together. Keep one of them off.` };
      }
      store.writeJson(games.gdir(key, 'verdicts.json'), verdicts.slice(-500));
      // Confirm everything else is fine without the culprit (marks those mods as working).
      const rest = units.filter(u => u !== culprit[culprit.length - 1]);
      if (rest.length) {
        say(`Checking the other mods work without ${names[names.length - 1]}…`);
        const restCrashed = await test(rest, 'everything except the culprit');
        if (restCrashed) pub.result.text += ' The game still crashed without it, so there may be another problem — run the search again after turning it off.';
      }
    } catch (e) {
      if (e.message === 'cancelled') pub.result = { kind: 'cancelled', text: 'Search cancelled.' };
      else { pub.result = { kind: 'error', text: e.message }; store.log('search failed', e); }
    } finally {
      pub.state = 'done';
      pub.current = null;
      pub.endedAt = new Date().toISOString();
      searches.delete(key);
      store.writeJson(games.gdir(key, 'search-last.json'), pub);
      // Put the user's own selection back into the game folder.
      try { installer.deploy(games.get(key), games.profile(key, profileName)); } catch { }
      say(pub.result ? pub.result.text : 'Done');
    }
  };
  run();
  return { ...pub };
}

function cancelSearch(key) {
  const s = searches.get(key);
  if (!s) return false;
  s.cancelled = true;
  launcher.stop(key);
  return true;
}

function clearVerdicts(key) { store.writeJson(games.gdir(key, 'verdicts.json'), []); }

const anyRunning = () => searches.size > 0;

module.exports = { analyse, matrix, startSearch, cancelSearch, searchState, setEmitter, clearVerdicts, anyRunning };
