// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Shared HTTP helpers for source adapters (main process, Node 20+ fetch).
const UA = 'ModHaven/1.0 (desktop mod manager)';
// In-memory cache of parsed JSON: url -> {exp, data, size}. Bounded: expired entries are dropped,
// and the oldest go first once there are too many or they add up to too much.
const memo = new Map();
const MEMO_MAX = 400;
const MEMO_BYTES = 96 << 20; // rough budget, from Content-Length
let memoBytes = 0;
let sweepTimer = null;
function memoDrop(key) { const e = memo.get(key); if (e) { memoBytes -= e.size; memo.delete(key); } }
function sweep() {
  const now = Date.now();
  for (const [k, e] of memo) if (e.exp <= now) memoDrop(k);
  if (!memo.size && sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
}
function memoSet(key, data, ttl, size) {
  memoDrop(key);
  memo.set(key, { exp: Date.now() + ttl, data, size });
  memoBytes += size;
  if (memo.size > MEMO_MAX || memoBytes > MEMO_BYTES) sweep();
  for (const k of memo.keys()) { if (memo.size <= MEMO_MAX && memoBytes <= MEMO_BYTES) break; if (k !== key) memoDrop(k); }
  // Expired entries are freed even when nothing new is fetched (no wake-ups once the cache is empty).
  if (!sweepTimer) { sweepTimer = setInterval(sweep, 5 * 60e3); if (sweepTimer.unref) sweepTimer.unref(); }
}
function clearMemo() { memo.clear(); memoBytes = 0; if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; } }

async function request(url, opts = {}) {
  const { headers = {}, method = 'GET', body, timeout = 30000, retries = 2 } = opts;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, { method, body, headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ac.signal });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        await new Promise(r => setTimeout(r, 800 * (i + 1)));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const e = new Error(`HTTP ${res.status} for ${url}${text ? ': ' + text.slice(0, 200) : ''}`);
        e.status = res.status;
        throw e;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (e.status) throw e; // 4xx: don't retry
      if (i < retries) await new Promise(r => setTimeout(r, 600 * (i + 1)));
    } finally { clearTimeout(timer); }
  }
  throw lastErr;
}

// fetchJson(url, {headers, ttl}) — ttl in ms caches the parsed JSON in memory.
async function fetchJson(url, opts = {}) {
  const ttl = opts.ttl || 0;
  const key = url + '|' + JSON.stringify(opts.headers || {}) + '|' + (opts.body || '');
  if (ttl) {
    const hit = memo.get(key);
    if (hit && Date.now() < hit.exp) return hit.data;
    if (hit) memoDrop(key);
  }
  const res = await request(url, opts);
  const data = await res.json();
  if (ttl) memoSet(key, data, ttl, Number(res.headers.get('content-length')) || 64 << 10);
  return data;
}

module.exports = { request, fetchJson, clearMemo, UA };
