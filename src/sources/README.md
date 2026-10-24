# Source adapters

Each file in this folder (except index.js) exports one adapter object. index.js
lists them. All functions are async and run in the Electron main process.

```js
module.exports = {
  id: 'thunderstore',            // stable id, used in saved data
  name: 'Thunderstore',          // display name
  color: '#23ffb0',              // badge colour (readable on dark AND light bg with white/black text chosen by UI)
  site: 'https://thunderstore.io',
  needsKey: false,               // true → ctx.keys[id] must be set, else listGames/listMods return [] / throw {code:'NO_KEY'}
  keyHelp: 'Where to get the key (one sentence + URL)',

  listGames(ctx) -> [{ sourceGameId, name, slug, image, url, modCount? , steamAppId? }]
  listMods(ctx, sourceGameId, { query, sort, page, pageSize, gameVersion, category })
      sort ∈ 'popular' | 'updated' | 'downloads' | 'name' | 'newest'
      page starts at 0
      -> { mods: [Mod], hasMore: bool, total?: number }
  getMod(ctx, sourceGameId, modId) -> Mod (+ description, descriptionFormat: 'html'|'markdown'|'text', screenshots: [url])
  getVersions(ctx, sourceGameId, modId) -> [Version] newest first
  resolveDownload(ctx, sourceGameId, modId, versionId) -> { url, fileName, headers? } | { manual: true, pageUrl, reason }
  categories?(ctx, sourceGameId) -> [{id, name}]
}
```

Mod = {
  source, id (string), gameId (sourceGameId), name, author, summary, version,
  updatedAt (ISO string), createdAt (ISO), downloads (number), likes (number),
  icon (url|null), url (web page), categories: [string], nsfw: bool,
  deprecated: bool, gameVersions: [string]  // supported game versions if the site tracks them, else []
}

Version = {
  id (string), version (string), date (ISO), gameVersions: [string], loaders: [string],
  fileName, size (bytes|null), downloadUrl (string|null), changelog (string|null),
  dependencies: [{ source, modId, name?, versionRange? , required: bool }]
}

ctx = { fetchJson(url, {headers, ttl, method, body}), request(url, opts), keys: { curseforge, nexus, ... }, settings }

Rules: never scrape HTML when an API exists; respect rate limits (cache with ttl);
no API keys hard-coded; Nexus non-premium downloads come back as {manual:true}
unless resolveDownload gets an nxm key/expires (opts in ctx.nxm).

## Implementation notes / contract additions

Files: `_util.js` is a shared helper module (not an adapter, not in index.js).

Errors: a missing key throws `{code:'NO_KEY'}` (message includes keyHelp); a key the site
rejects throws `{code:'BAD_KEY'}` (CurseForge any call, Nexus downloads). Other errors are plain `Error`s with
`.status` from net.js on HTTP 4xx.

`ctx.settings.showNsfw` (bool, default false): Thunderstore and Nexus hide adult mods unless set.

Adapter extras:
- `keylessBrowse: true` (Nexus) — needsKey is true, but listGames/listMods/getMod/getVersions/categories
  work without a key (public GraphQL v2); only resolveDownload throws NO_KEY.
- `nexus.parseNxm(url)` -> `{domain, modId, fileId, key, expires, userId}` or null. Pass the
  result as `ctx.nxm` to resolveDownload for free-account downloads.
- `thunderstore.parseDep("Ns-Name-1.2.3")` -> dependency object.

Game:
- `slug` is a normalised cross-site merge key (`_util.gameSlug(name)`: lowercase, accents/™ stripped,
  `&`->and, apostrophes dropped, other punctuation -> `-`), e.g. "Baldur's Gate 3" -> `baldurs-gate-3`.
  `name` has ™/®/© removed. No keyless site exposes Steam app ids, so `steamAppId` is never set yet.
- `nexusId` (Nexus only): numeric game id.

Mod:
- `downloads` may be `null` when the list API doesn't report it (GameBanana lists; getMod has it).
- `version` / `updatedAt` / `author` may be null when unknown.
- optional: `slug` (Modrinth, CurseForge), `loaders` [string] (Modrinth), `views` (GameBanana),
  `websiteUrl`, `allowModDistribution` (CurseForge), `requirements` [{name,url}] (GameBanana getMod).
- categories(): ids are what listMods' `category` option expects. For Nexus the id IS the category
  name; for Modrinth it is the tag name; elsewhere a numeric id as string.
- sort 'name': Thunderstore and Modrinth have no name ordering server-side; the page is sorted locally.
  GameBanana search (query) is capped by the server at ~100 results.

Version (all optional):
- `title` human file title, `channel` 'release'|'beta'|'alpha' (Modrinth, CurseForge),
  `category` (Nexus: MAIN|UPDATE|OPTIONAL|MISCELLANEOUS|OLD_VERSION|ARCHIVED), `archived` bool,
  `primary` bool (Nexus), `description`, `sha1` (Modrinth), `md5` (GameBanana).
- `dependenciesKnown: false` — Thunderstore only fetches dependency lists for the 10 newest
  versions; older ones have `dependencies: []` and this flag.
- Order: newest first, except Nexus (MAIN, UPDATE, OPTIONAL, MISC first, OLD_VERSION/ARCHIVED last,
  newest first inside each group) and GameBanana (archived files last).
- `downloadUrl` is null for Nexus/CurseForge-restricted files — always call resolveDownload.

Dependency extras: `versionId` (Modrinth exact version), `gameNumId` (Nexus requirement from another game).
