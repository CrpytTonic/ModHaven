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

Author and images (every Mod, from listMods and getMod):
- `author` display name, `authorUrl` link to the author's profile on that site (null only if the site gives none).
- `icon` small image for list rows; `image` larger version of the same main image for cards/headers
  (getMod returns the full-size one where the list API only has a medium one).

  | site | author / authorUrl | icon | image (list → getMod) |
  |---|---|---|---|
  | Nexus | `author` (free text credit, often a team) / uploader's `/users/{memberId}`; getMod links the credited author's own profile when `author` is a Nexus user name | `thumbnailUrl` (385px) | `thumbnailLargeUrl` (622px) → `pictureUrl` (original) |
  | Thunderstore | namespace (team) / `/c/{community}/p/{team}/` | package icon (256px) | same icon (no larger image exists) |
  | Modrinth | organization name if org-owned, else owner username / `/organization/{slug}` or `/user/{name}` | `icon_url` (96px) | `icon_url` → `raw_icon_url` (original) |
  | GameBanana | submitter / `_aSubmitter._sProfileUrl` | first preview image, 220px | 800px (or next size that exists) → original `_sFile` |
  | CurseForge | `authors[0].name` / `authors[0].url` | `logo.thumbnailUrl` | `logo.url` |
- Nexus also sets `uploader` / `uploaderUrl` (the account that published it).
- Modrinth also sets `featuredImage` (featured gallery picture, may be null).

getMod extras:
- `description`: Nexus = full BBCode description converted to HTML (`_util.bbcodeToHtml`); Thunderstore =
  README markdown of the latest version (falls back to the site's rendered html README, format 'html');
  Modrinth = body markdown; GameBanana = `_sText` html; CurseForge = `/description` html.
  bbcodeToHtml output uses classes AND inline styles: `bb-size-1..7`, `bb-size-px`, `bb-color`,
  `bb-align-center|left|right|justify`, `bb-indent`, `bb-youtube` (link wrapping a video thumbnail),
  `<details class="bb-spoiler">`. A sanitizer that drops `style` keeps the classes for CSS.
  GameBanana `_sText` uses its own classes (`GreenColor`, `RedColor`, ...).
- `screenshots` [url]: every gallery image at full size, deduplicated, in the author's order
  (Modrinth: featured first, `raw_url`; GameBanana: all `_aPreviewMedia._aImages` originals, first = main
  image; CurseForge: `screenshots[].url`; Thunderstore: images embedded in the README, badges/donate
  buttons/avatars/video thumbnails skipped; Nexus: `pictureUrl` first, then every image embedded in the
  description).
- `gallery` [{url, title, description}]: same list as `screenshots` with captions where the site has them.
- `screenshotsComplete: false` + `galleryUrl` (Nexus only): no Nexus API exposes the image gallery
  (GraphQL `Mod` has no media field, v1 has no images endpoint), so `screenshots` may be missing
  gallery pictures; `galleryUrl` is the site's Images tab.
- `credits` [{name, role, url, avatar?}]: Modrinth = organization + project members + org members
  (role = team role); GameBanana = `_aCredits` (role = "Group: role"), contributing studios, submitter;
  Nexus = author and uploader; CurseForge = `authors[]` (first = Owner); Thunderstore = team as Owner
  (team members need a login).
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
