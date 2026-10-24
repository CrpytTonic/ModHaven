# ModHaven

By **CrpytTonic**. Copyright (c) 2026 CrpytTonic. All rights reserved; see [LICENSE](LICENSE).

All-in-one mod manager for Windows: browse, install and auto-update mods from **Thunderstore, Modrinth, GameBanana, Nexus Mods and CurseForge** in one place, with profiles, crash tracking and a culprit finder that pinpoints which mod (or pair of mods) crashes the game.

Run: `dist\ModHaven-win32-x64\ModHaven.exe` (Desktop / Start menu shortcut "ModHaven").
All data lives next to the exe in `ModHaven Data\` (portable).

## Mod sites
| Site | Browse | Download |
|---|---|---|
| Thunderstore, Modrinth, GameBanana | no key | no key |
| Nexus Mods | no key | personal API key; free accounts use the website's "Mod Manager Download" button (turn on *Settings → Handle Nexus links*) |
| CurseForge | free key from console.curseforge.com | same key; some authors block third-party downloads → opens the page |

## Status triangles
- **Green**: up to date and ran OK on the current game version
- **Half yellow / green**: not tested yet (new install, mod update or game update)
- **Yellow**: conflicts with another mod (named in the tooltip and in the crash center)
- **Red**: out of date / broken (deprecated, made for another game version, or crashes the game by itself)

When the game version changes (Steam build id / exe version), every mod goes back to "not tested" until it runs OK again.

## Mods you installed yourself
When you open a game, ModHaven scans its folder for mods it didn't install itself and shows a banner. The scan covers:
- BepInEx and MelonLoader plugins and loaders
- Minecraft jars
- Bethesda plugins and script-extender DLLs
- Unreal `.pak` / UE4SS mods
- proxy DLLs and ASI plugins

To review them later, open **⋯ → Find mods I installed myself**.

Each mod is matched to the sites in this order:
1. An exact file match: Modrinth sha1, CurseForge fingerprint (needs a key), or Nexus MD5 (needs a key).
2. A Thunderstore package folder or `manifest.json`.
3. The name and version read from the DLL or jar metadata, accepted only on an exact name match.

Adopting a mod copies its files to a backup (`games/<game>/adopt-backup/`) and moves them into ModHaven's store. ModHaven then puts them straight back, so the game is unchanged, and from then on it updates them like any other mod. Mods you leave unticked can be ignored for good.

Updates and removals are also applied to the game folder right away when that profile is the one currently deployed, so starting the game from Steam gets the new files too.

## Crash tracking
Every launch from ModHaven is recorded. On a crash, it saves the new log files and dumps (BepInEx, MelonLoader, Unity Player.log, Unreal Saved/Logs + Crashes, crash dumps), reads the Windows Application Error / .NET Runtime events (faulting module), and maps DLLs, plugin names and stack-trace namespaces back to the mods that installed them.

**Culprit finder** (Crash center): launches the game with halves of your mods until it finds the single mod that crashes, or the pair that crashes only together, then confirms the rest work. Automatic mode counts a run as passing after N seconds and closes the game; manual mode lets you play to the crash point.

## Development
- `npm start`: dev run (data in `ModHaven Data\` in the project folder; `MH_DATA=<dir>` overrides)
- `npm run package`: builds into `dist\ModHaven-win32-x64` through `dist-stage`, keeping `ModHaven Data`
- `node tools/test-sources.js [--contract]`: live tests of the site connectors (`CF_KEY` / `NEXUS_KEY` env for the keyed ones)
- `MH_HARNESS=<script.js>`: a dev hook that receives the BrowserWindow (used for screenshot tests)
- `electron tools/make-icon.js`: regenerates `app/icon.png` / `app/icon.ico`

Layout: `main.js` (IPC), `src/` (store, localgames, catalog, games/profiles, installer/deploy, launcher/crash evidence, analysis/culprit search, modmanager, sources/*), `app/` (UI).
