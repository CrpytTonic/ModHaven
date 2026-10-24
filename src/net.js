// ModHaven — Copyright (c) 2026 CrpytTonic. All rights reserved.
// Shared HTTP helpers for source adapters (main process, Node 20+ fetch).
const UA = 'ModHaven/1.0 (desktop mod manager)';
const memo = new Map(); // url -> {t, data}

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
    if (hit && Date.now() - hit.t < ttl) return hit.data;
  }
  const res = await request(url, opts);
  const data = await res.json();
  if (ttl) memo.set(key, { t: Date.now(), data });
  return data;
}

module.exports = { request, fetchJson, UA };
