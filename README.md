# tombs.nexus

Tomb Raider I–IV and their expansions in the browser, played with the
[TRX](https://github.com/LostArtefacts/TRX) engine's WebGL build. It installs
as an app and, once a game is downloaded, plays without a connection.

This is an interpretation of the reference shell in
[trx-webgl-shell](https://github.com/goldfish-g/trx-webgl-shell): the same
library, profiles, resumable downloads and engine contract, with its own
menu, store sign-in and offline support.

## What it does

- **A level flies by behind the menu.** On every visit the app picks a level
  from the games in the player's library (the official games and their
  expansions) and flies a camera through it. Players without a game get the
  levels the server offers everyone (Croft Manor from Tomb Raider III by
  default). The level files are read in the browser and drawn with three.js,
  the approach of Evgeny Popov's [TRN](https://github.com/Popov72/TRN2)
  viewer; TR4 levels get their sky (horizon and tinted clouds) as their
  script sets it.
- **The flybys are planned to show each level off** (`src/flyby/route/plan.ts`):
  long, slow tours over the places Lara can reach (`reach.ts`: a flood from
  her start and every trigger she sets off, by walking, climbing, ladders,
  jumps, swimming and drops), at about her own camera's height, through the
  best-looking places. Every triangle that is drawn counts (`world.ts`), so
  the camera keeps clear of walls, statics and objects alike; it may pass
  only see-through faces, doors and smashable windows. Along the way the
  camera turns, slowly, toward the most open, bright and varied view. Each
  route is flown as the menu flies it and every half second its view is
  checked by casting sight lines (and against the rooms the renderer would
  cull from there): a wall up close or filling the view, grazing a wall,
  darkness, nothing but sky, the void past the edge of the level or a hole
  in it, a stall or a whip-pan; the tour is cut to its good stretches.
  TR4's own flyby paths are checked the same way. The official levels'
  routes are planned ahead (`node scripts/plan-flybys.mjs`, into
  `src/flyby/planned/`) and ship with the app; a file that differs is
  planned on the spot, and a level with nothing worth showing is skipped.
  `src/flyby/route/planned.test.ts` flies every shipped route against its
  level for room, faults and jolts.
- **A ring of artifacts** stands for the games, each an object from the game
  itself, cut out of its level files by the server: Tomb Raider's Scion, the
  Dagger of Xian, the Infada Stone, an ankh from The Last Revelation, a
  statue of Bastet from Unfinished Business, the Golden Mask, the Hand of
  Rathmore from The Lost Artifact, and The Last Revelation's compass for
  custom levels. Games the player has not unlocked show theirs turned to
  stone. Without the games on the server, the ring draws artifacts of its
  own.
- **The games' own sound.** The menu plays the main theme of the game whose
  level flies by (`shared/themes.ts`: the title screens' tracks, but The
  Last Revelation's main theme rather than its title screen's ambience),
  out of the player's copy of the game, or from the server with the levels
  it shows everyone. Changing to a game with another theme fades the music
  out while the next level loads. Tomb Raider III's and The Last
  Revelation's ADPCM is turned into PCM in a worker (`src/audio/wav.ts`).
  The menus make the sounds of the menus of the game whose look they wear,
  as TRX's menus use them: the ring's rotate sound, choose, spin-out and
  the passport's page; the server reads them out of each game's title level
  and MAIN.SFX (`server/src/sounds.ts`). Settings → Sound sets both volumes.
- **Built for a gamepad.** Every action is a button prompt, such as "(A)
  Play" or "(B) Back", showing the glyph of the device in hand: Xbox,
  PlayStation or Nintendo buttons, or keys (Enter, Esc, F, R, M, V, Q/E). The
  d-pad walks lists, where each row carries its own prompts. With a mouse or
  a finger the glyphs go and the prompts are plain buttons; the ring also
  turns with a swipe, the wheel or its arrows.
- **Who may download what.** The server holds every game but sends only
  Unfinished Business and The Golden Mask, which their publisher gave away,
  to everyone. The others unlock when the player signs in with a Steam
  account that owns them, or their remaster. Anyone can add the files of
  their own copy instead, bought anywhere, which never leave the device.
- **Offline.** A service worker keeps the app and the background levels;
  engine builds and game files stay in the browser (Cache Storage and
  IndexedDB). Downloads resume after a reload or a dropped connection.
- **Dressed like the games' menus**, and the player picks which: Tomb
  Raider, II or III, under Settings → Look. Titles and button labels are in
  that game's in-game lettering and the prompts show its controller and
  keyboard icons, as TRX draws them: `scripts/make-game-art.mjs` packs them
  per game from TRX's font sprites (TRXInjectionTool, GPL-3.0), and draws
  the app icon from TR1's. They are drawn a whole number of screen pixels
  per pixel, so they stay sharp at any zoom. Panels and buttons sit in the
  game's etched frames (TR1's gold, TR2's white, TR3's blue, with the
  colours of TRX's `ui.json5`), the selected one glows like the PlayStation
  games' selection bar, and progress bars are banded like one of the
  game's bars. Other text is set in Alegreya.
- **Custom levels from TRCustoms.** The ring's compass opens a screen of
  its own over the level flying by, with two sections: the player's own
  custom levels (Library), with any the cloud keeps from their other
  devices, and the ones on
  [TRCustoms](https://trcustoms.org) (Browse), each by the game they were
  made for, Tomb Raider I, II or III. The triggers switch sections, the
  bumpers games; a click or a tap on a tab does too. Levels are cards
  with a screenshot, name, rating class, difficulty and length; one opens
  to its screenshots, description and details, and downloads or plays
  from there. Browse searches and orders TRCustoms' lists. The server
  passes TRCustoms' lists, images and archives on, since TRCustoms sends
  no CORS headers.
- **Every level converted.** Each custom level goes through the TRX Level
  Converter ([trx-update-tool](https://github.com/goldfish-g/trx-update-tool),
  the `converter` submodule) as it comes in, in a worker in the browser:
  levels made for the original games get a game flow from their script,
  and ones made for an older TRX are brought up to date. Levels from
  files on the device are converted the same way.
- **Custom levels play on their own.** A custom level's session holds only
  the level and what it borrows from the game it builds on (its title and
  home levels, music, sounds and videos), and the engine's own copies of
  the other games' game flows are taken away, so TRX finds nothing else
  to start and its passport has no Switch Game.
- **Cloud saves.** Signed in with Steam, a player's profiles and their
  saves, and the custom levels they added, are kept on the server with
  their Steam account. Another device signed in to the same account gets
  the profiles back, saves and all, once it has the game they play, and
  lists the custom levels under Custom levels → Library ("In your
  cloud") to download again; the server keeps where a level came from,
  never the level. Saves are merged file by file against what the device
  and the cloud last agreed on: a slot changed on one device goes to the
  others, and a slot two devices both changed keeps the newer save. They
  sync when the menus open, when a game starts (before the engine reads
  them) and as the game saves. The account panel lists what the cloud
  keeps of each game and level; taking one out deletes its profiles and
  saves from the cloud and from every device, and deleting a profile
  deletes it everywhere. Removing a custom level from a device leaves
  the cloud's copy alone. Only the save files travel; each device keeps
  its own settings, except the look picked under Settings → Look, which
  follows the player (the latest pick wins).
- **Playing.** Each profile keeps its saves and settings in IndexedDB. For
  the official games, the
  engine's game switcher offers every installed game; picking one starts the
  play page afresh for it, so only one game's files take up memory. The
  screen stays on while the app is open, so FMVs play without a touch.

## Running

No game data is in the repository. See [data/README.md](data/README.md) for
the server's data directory, its catalog and every environment variable.

```bash
git submodule update --init   # the converter, in converter/
pnpm install
pnpm dev            # API server on :3002 and Vite on :5173, proxied together
pnpm test           # unit tests: level reader, layout, archives, server
pnpm typecheck
pnpm build          # the page in dist/, with the service worker
pnpm start          # the server, serving dist/ and the API
```

The engine runs threads, which need `SharedArrayBuffer`: the page must be
served over HTTPS (or from localhost) with
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. The server and the dev server
send both; the service worker adds them to what it serves from its cache.

### Docker

```bash
docker build -t trx-suite .
docker run -p 8080:8080 -v /path/to/data:/data \
  -e PUBLIC_URL=https://trx.example.com \
  -e SESSION_SECRET="$(openssl rand -base64 48)" \
  -e STEAM_API_KEY=… trx-suite
```

### Previews while developing

- `/dev/flyby.html?level=<url>&seed=1&route=0&t=5` shows a level's flyby,
  held at a moment of a route when `route` and `t` are given.
- `/dev/flybysheet.html?level=<url>&routes=<url of a JSON route list>` lays
  out every route of a level as a strip of frames, each with the planner's
  verdict on its view; without `routes` it plans them (`attempts=60`).
- `/dev/cullcheck.html?level=<url>` renders moments of every route with and
  without room culling and reports how many pixels differ.
- `/dev/objects.html?level=<url>&maxr=400` lays out every object of a level
  with its number, for choosing the ring's objects (`shared/ring/sources.ts`).
- `/dev/models.html` shows the ring's own drawn artifacts, the fallback.

`TRX_LEVELS_DIR=<dir with level files> pnpm test` also reads every level it
finds there. Browser tests of whole flows are in [e2e/](e2e/README.md).

## Sign-in

Steam uses OpenID to learn the account, then the Web API
(`IPlayerService/GetOwnedGames`, which needs `STEAM_API_KEY`) for what it
owns. Steam only answers for profiles whose game details are public; the app
tells the player when that is the problem. The app polls the server while
the player signs in on Steam's page, so it also works where that page opens
outside an installed app.

GOG has no sign-in that sends players back to another site, only to its own
pages, which a web page cannot read; GOG owners bring the files of their own
copy instead.

What an account owns is kept in a signed session cookie; signing in again
refreshes it. The server checks it on every download request. The cloud
saves belong to the Steam account in that cookie.

## Layout

```
shared/        what the page and the server agree on: games, store ids, API shapes;
               the level file reader and the ring's objects
server/        the API server: catalog, sign-in, downloads, TRCustoms, static files
src/
  flyby/       culled rendering of levels, smooth camera routes
  menu/        the home screen, the ring and its artifacts, the panels
  custom/      custom levels: Library and Browse, TRCustoms, the converter's worker
  stage/       the WebGL canvas behind the menus
  input/       keyboard, gamepad, mouse and touch as one stream of actions
  account/     sign-in and the catalog, remembered for offline use
  cloud/       cloud saves: syncing profiles, saves and custom levels with the server
  pwa/         installing, updating, the service worker's registration, keeping the screen on
  gamedata/    the library: imports, layout, storage   (from the shell)
  games/       recognising games and custom levels     (from the shell)
  engine/      loading and running the engine          (from the shell)
  profiles/    profiles and their saves                (from the shell)
  play/        the play screen
vite/          dev proxy, service worker template and its build plugin
scripts/       dev runner, icon and level-list generators
dev/           preview pages
converter/     the TRX Level Converter (trx-update-tool), a submodule
```

## Legal

Tomb Raider is a trademark of its owners; this project is not affiliated with
them. The repository contains no game data. The server sends every visitor the
background levels and the ring's objects, which come from the games. Gating
downloads on store ownership is a good-faith measure, not a licence: hosting
the games, and those parts of them, still needs their rights holders'
permission.
