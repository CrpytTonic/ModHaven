// Artwork for games none of the mod sites have pictures for: look the game up on the Steam
// store by name. Results (including "not on Steam") are saved, so each game is asked once.
//
// Matching is strict on purpose: a wrong cover is worse than the generated placeholder.
//  1. exact: names equal after normalising (case, ™®, accents, "the", "&"/"and", roman numerals,
//     punctuation; either side of "A | B").
//  2. edition: equal after also dropping edition words (Definitive, Remastered, GOTY, Enhanced...),
//     preferring the plainest Steam name when several qualify.
// Demos, soundtracks, DLC, playtests, tools and servers are never accepted.
// Images come from Steam's GetItems asset list (the real hashed URLs: the old flat
// /steam/apps/<id>/library_600x900.jpg path 404s for many newer games), and every URL is
// checked before it is saved.
const store = require('./store');
const net = require('./net');
const { normName } = require('./catalog');

const VER = 2; // bump to re-ask games cached by an older matcher
const FILE = () => store.root('cache', 'steam-art.json');
let cache = null;
const load = () => (cache = cache || store.readJson(FILE(), {}));
let saveTimer = null;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.writeJson(FILE(), cache), 1500); };

// One request at a time with a gap: the store API rate-limits bursts.
let chain = Promise.resolve();
const GAP = 350;
const pause = () => new Promise(r => setTimeout(r, GAP));
const queued = fn => (chain = chain.then(pause).then(fn, fn));

// ---- name matching ----
const EDITION = new Set(['definitive', 'remastered', 'remaster', 'goty', 'gameoftheyear', 'enhanced', 'complete',
  'deluxe', 'ultimate', 'anniversary', 'edition', 'directors', 'cut', 'hd', 'special', 'collectors', 'gold',
  'premium', 'standard', 'classic', 'redux', 'legendary', 'extended', 'expanded', 'version']);
const JUNK = /\b(demo|soundtrack|ost|dlc|playtest|season pass|art ?book|dedicated server|server|sdk|editor|benchmark|wallpapers?|upgrade|bundle|costume|skin pack)\b/i;

const plain = s => String(s || '').replace(/[™®©℠]/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/game of the year/ig, 'gameoftheyear').replace(/\b(director|collector)'?s\b/ig, '$1s')
  .replace(/(\w)['’]s\b/g, '$1s') // "Caden's" = "Cadens"; full(s, true) also tries "Tiny Tina's" = "Tiny Tina"
  .replace(/\+/g, ' plus ').replace(/[\/|~*#@]/g, ' ');
const words = s => plain(s).split(/\s+/).map(w => normName(w)).filter(Boolean)
  .filter((w, i) => !(i === 0 && w === 'the'));
const full = (s, noPoss) => words(noPoss ? String(s || '').replace(/(\w)['’]s\b/g, '$1') : s).join('');
// Edition-free form; "<anything> Edition" (Reloaded Edition, Console Edition) counts as an edition too.
const core = s => {
  const w = words(String(s || '').replace(/\b[\w'’]+\s+edition\b/ig, ' edition '));
  const c = w.filter(x => !EDITION.has(x));
  return (c.length ? c : w).join('');
};
const editionWords = s => words(s).filter(x => EDITION.has(x)).length;
// GameBanana lists ports separately: "Rayman Legends (Wii U)", "X-Men Origins: Wolverine - PSP".
const PLATFORM = '(?:pc|steam|switch|nintendo switch|gamecube|gc|ps[1-5p]?|psp port|vita|vita3k|wii u?|xbox(?: 360| one)?|x360|n?3?ds|nes|snes|n64|gba|mobile|android|ios|recomp)';
const stripPlatform = s => String(s || '')
  .replace(new RegExp(`\\s*[(\\[]${PLATFORM}[)\\]]\\s*$`, 'i'), '')
  .replace(new RegExp(`\\s+[-–—]\\s*${PLATFORM}\\s*$`, 'i'), '').trim();

// Names worth searching for: the name itself, then simpler spellings.
function variants(name) {
  const s = stripPlatform(String(name || '').trim());
  const out = [String(name || '').trim(), s, ...s.split(/\s*\|\s*/), s.replace(/^\(the\)\s*/i, '')];
  out.push(s.replace(/[™®©]/g, '').replace(/\s*[:\-–—]\s*/g, ' ').replace(/\s+/g, ' '));
  out.push(plain(s).split(/\s+/).filter(w => !EDITION.has(normName(w))).join(' '));
  return [...new Set(out.map(x => x.trim()).filter(x => x.length > 1))];
}

// The result that is clearly the same game, or null.
function pick(name, items) {
  const apps = (items || []).filter(i => i && i.type === 'app' && i.name && (!JUNK.test(i.name) || JUNK.test(name)));
  const bare = stripPlatform(name);
  const ours = [name, bare, ...bare.split(/\s*\|\s*/)];
  const keys = new Set([...ours.map(n => full(n)), ...ours.map(n => full(n, true))].filter(Boolean));
  const exact = apps.find(i => keys.has(full(i.name)) || keys.has(full(i.name, true)));
  if (exact) return { item: exact, how: 'exact' };
  const c = core(bare);
  if (c.length < 4) return null; // too short to trust without the exact name
  const ed = apps.filter(i => core(i.name) === c).sort((a, b) => editionWords(a.name) - editionWords(b.name));
  return ed.length ? { item: ed[0], how: 'edition' } : null;
}

// ---- images ----
const CDN = 'https://shared.akamai.steamstatic.com/store_item_assets/';
async function urlOk(url) {
  try {
    const r = await net.request(url, { method: 'HEAD', retries: 1, timeout: 15000, headers: { Accept: 'image/*' } });
    return /^image\//.test(r.headers.get('content-type') || 'image/');
  } catch { return false; }
}

async function imagesFor(appid, tiny) {
  const input = { ids: [{ appid: Number(appid) }], context: { language: 'english', country_code: 'US' }, data_request: { include_assets: true } };
  const cand = [];
  try {
    const d = await net.fetchJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`, { retries: 1 });
    const a = d && d.response && d.response.store_items && d.response.store_items[0] && d.response.store_items[0].assets;
    if (a && a.asset_url_format) {
      const u = f => (f ? CDN + a.asset_url_format.replace('${FILENAME}', f) : null);
      cand.push({ url: u(a.library_capsule_2x) || u(a.library_capsule), kind: 'portrait' });
      cand.push({ url: u(a.header), kind: 'wide' });
      cand.push({ url: u(a.main_capsule), kind: 'wide' });
    }
  } catch (e) { store.log('steam art assets failed', appid, e.message); }
  if (!cand.some(c => c.url)) { // older apps: the flat paths still work for many; checked below
    cand.push({ url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`, kind: 'portrait' });
    cand.push({ url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`, kind: 'wide' });
  }
  if (tiny) cand.push({ url: tiny, kind: 'wide' });
  const seen = new Set();
  const out = [];
  for (const c of cand) {
    if (!c.url || seen.has(c.url)) continue;
    seen.add(c.url);
    if (await urlOk(c.url)) out.push(c);
  }
  return out;
}

const _debug = {}; // name -> {how, steam, appid}, for tests

async function lookup(name) {
  const key = normName(name);
  if (!key) return [];
  load();
  const hit = cache[key];
  if (hit && hit.v === VER && (hit.images.length || Date.now() - hit.t < 14 * 86400e3)) return hit.images;
  return queued(async () => {
    const h = cache[key];
    if (h && h.v === VER && h.images.length) return h.images;
    let images = [];
    let found = null;
    try {
      const qs = variants(name);
      for (let i = 0; i < qs.length && !found; i++) {
        if (i) await pause();
        const s = await net.fetchJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(qs[i])}&l=english&cc=US`, { retries: 1 });
        found = pick(name, s.items);
      }
      if (found) {
        images = await imagesFor(found.item.id, found.item.tiny_image);
        _debug[name] = { how: found.how, steam: found.item.name, appid: found.item.id };
      }
    } catch (e) {
      store.log('steam art lookup failed', name, e.message);
      return []; // not cached: try again another time
    }
    cache[key] = { v: VER, t: Date.now(), images, appid: found ? found.item.id : null, steamName: found ? found.item.name : null };
    save();
    return images;
  });
}

module.exports = { lookup, _debug, _pick: pick, _variants: variants };
