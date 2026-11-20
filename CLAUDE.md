# CLAUDE.md

Guidance for working in this repository. Keep it in sync with the code.

## What VectorWings is

A low-poly rail shooter in the browser (Babylon.js 8): a co-op campaign of four missions for 1–4 pilots with bosses, smart bombs, charged homing shots,
barrel rolls, loops and wingmen, plus an all-range arena with **Kernjagd** (three shield cores per ship, boost-ramming steals one) and **Treffer auf Zeit**.
Genre like the classic 90s rail shooters – **names, crew (Mira the otter, Brakk the badger, Sola the lynx, Pip the owl), ships, worlds and art are our own:
never copy another game**.

VectorWings is a **plugin of MatGame** (`../MatGame`, read its CLAUDE.md). It runs on a MatGame master (`/vectorwings/`, hub `/vectorwings/hub`,
admin `/Admin/VectorWings`), as its own image (port 2776), and in the Windows app (MatGame.Shell) online or offline (`VectorWings.Local`).

## Build / run / test

- `npm ci && npm run build` – bundles `src/client/main.js` (+ SignalR + the MatGame SDK copied from `../MatGame/sdk/js`) into
  `src/VectorWings.Module/wwwroot/vendor/flight-bundle.js`. `npm run build -- --watch` for development.
- `dotnet build VectorWings.slnx`, `dotnet test VectorWings.slnx` (room rules, levels, offline profile; no database).
- Previews without a server: `node scripts/serve.mjs` → `http://localhost:2789/vectorwings/?preview=1&mission=0&t=20&god`
  (`mode=Battle|Timed`, `ship=0..2`, `bots=0`, `clean` hides the HUD, `weak` = boss with 8 % HP, `quality=low|medium|high`; `preview=menu|map|hangar|options` opens a screen, `locked` keeps the map locks). The preview uses
  `src/client/net/loopback.js`, a JS copy of the room rules – keep it in step with `Room.cs`.
- Local stack: `docker compose -f compose.local.yml up -d --build` → http://localhost:2776/vectorwings/. Client-only changes:
  `npm run build && sh artifacts/deploy-client.sh` copies the bundle into the running container (artifacts/ is git-ignored).
- Browser checks: Playwright with the installed Edge (`../TurboToys/tools/node_modules/playwright-core`). Scripts in artifacts/ (not committed):
  `shot.mjs`, `play.mjs` (holds keys, series of screenshots + game state), `mp.mjs` (two guests online: Campaign/Battle/Timed), `perf.mjs`,
  `windows-check.mjs` (the published exe through CDP). Look at the screenshots.
- Windows app: `dotnet publish src/VectorWings.App -c Release -r win-x64 -o artifacts/windows`; test with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9786`, `MATGAME_NO_UPDATES=1`, `MATGAME_PORTABLE=1`.

## Rules (from the owner's guidelines — keep them)

- **Git:** branches `main` (release) and `dev` (nightly). Commits only under the owner's name; **no Co-Authored-By or other contributor lines**, no generated-by lines in PRs.
- **Versions:** `0.3.<build>-<date>` / `nightly-<build>-<date>` / `local-<date>` (`Directory.Build.props`, CI). `VectorWingsModule.Protocol` and the min client
  rise only with a hub change old apps cannot follow (docs/PROTOCOL.md).
- **Docker:** one Dockerfile, compose files for release/dev/local, no `${VARIABLES}`, no `.env`, always a stack (`name:`).
- **C#:** Microsoft conventions, readable names, flat code. Results go to schema `vectorwings` (tables `Match`, `PilotResult`; columns are added with `ADD COLUMN IF NOT EXISTS`).
- **Offline rule:** `VectorWings.Local` answers every hub method and API call with the online shapes.
- Texts in the game are German.

## Map

```
src/VectorWings.Core     Levels.json (shared with the browser: kinds, missions with waves/pickups/props/boss parts+phases, arena), Levels.cs (loads it, protocol records),
                         Room.cs (the match: lobby, seats, driver, reports, rules, boss phases, arena rules, result)
src/VectorWings.Module   VectorWingsModule (IGameModule, /api/progress, /api/profile), FlightHub + GameTicker (20 Hz), RoomRegistry, ProgressStore (Npgsql: Match, PilotResult, Pilot),
                         Pages/Admin/VectorWings (overview, Player = pilot file + granted missions + reset)
src/VectorWings.Local    VectorWingsLocal (ILocalGame: the room offline, flight-progress.json)
src/VectorWings.App      the Windows app (MatGame.Shell + embedded wwwroot + VectorWingsLocal)
src/client               the browser part (bundled):
  main.js                app: game menus (press start, pilot, main, multiplayer, map, hangar, lobby, options, help), MatGame connection, lobby, result tally, previews
  overworld.js           the campaign map in space: planets, station, asteroids, branching lanes (Levels.json routes, secret medal lane), the ship flying between them
  render/cockpit.js      the 3D cockpit of the cockpit camera
  ui/nav.js              console-style menu navigation (keys, gamepad, pointer) over [data-nav] items
  game/game.js           one match: clock sync, own/bot/remote ships, deterministic enemies + fire, shots, bolts, charged shots, bombs, pickups, boss, camera direction, reports
  game/pilot.js          flight model (rail + arena), barrel roll, tilt, loop/U-turn, boost/brake meter, weapons; game/bots.js wingmen and arena bots
  level.js rail.js       wave expansion and movement patterns; the curved rail (rail coordinates s/x/y ↔ world)
  render/                stage (engine, sky shader, water shader, backdrop, post-processing, glow), kit (low-poly modelling), models (ships, enemies, pickups), actors (views), fx (SPS effects)
  worlds/                themes, common (chunk streaming, terrain strips, trees), river, desert, orbit, city, arena
  bosses/                base (parts, armour, scheduling), warden (river), borer (desert), frigate (orbit), arachnid (city)
  hud.js input.js audio.js menu-scene.js net/loopback.js
src/VectorWings.Module/wwwroot   index.html, flight.css, img (mark, cover, crew portraits as SVG, mission stills), vendor (bundle), matgame (SDK copy)
tests/VectorWings.Tests  RoomTests
docs/PROTOCOL.md         hub, reports, frames, who decides what, offline
```
