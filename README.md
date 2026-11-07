# TRX Suite

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
  expansions) and flies a camera through it. TR4 levels follow their own
  scripted flyby cameras, timed by their speeds as the game times them and
  cut where the game cuts; other routes are made up through the rooms.
  Players without a game get the levels the
  server offers everyone (Croft Manor from Tomb Raider III by default). The
  level files are read in the browser and drawn with three.js, the approach
  of Evgeny Popov's [TRN](https://github.com/Popov72/TRN2) viewer. Made-up
  routes are smoothed like a pulled string and slow down through bends;
  `src/flyby/route/smoothness.test.ts` measures every route of every level
  for jolts.
- **A ring of artifacts** stands for the games, each an object from the game
  itself, cut out of its level files by the server: Tomb Raider's Scion, the
  Dagger of Xian, the Infada Stone, an ankh from The Last Revelation, a
  statue of Bastet from Unfinished Business, the Golden Mask, the Hand of
  Rathmore from The Lost Artifact, and The Last Revelation's compass for
  custom levels. Games the player has not unlocked show theirs turned to
  stone. Without the games on the server, the ring draws artifacts of its
  own.
- **Built for a gamepad.** Every action is a button prompt, such as "(A)
  Play" or "(B) Back", showing the glyph of the device in hand: Xbox,
  PlayStation or Nintendo buttons, or keys (Enter, Esc, F, R, M, V, Q/E). The
  d-pad walks lists, where each row carries its own prompts. With a mouse or
  a finger the glyphs go and the prompts are plain buttons; the ring also
  turns with a swipe, the wheel or its arrows.
- **Who may download what.** The server holds every game but sends only
  Unfinished Business and The Golden Mask, which their publisher gave away,
  to everyone. The others unlock when the player signs in with a Steam or GOG
  account that owns them, or their remaster. Anyone can add the files of
  their own copy instead, which never leave the device.
- **Offline.** A service worker keeps the app and the background levels;
  engine builds and game files stay in the browser (Cache Storage and
  IndexedDB). Downloads resume after a reload or a dropped connection.
- **Custom levels** open their own list of profiles; TRX packages and lone
  level files play directly, older ones link to the TRX Level Converter.
- **Playing.** Each profile keeps its saves and settings in IndexedDB. The
  engine's game switcher offers every installed game; picking one starts the
  play page afresh for it, so only one game's files take up memory. The
  screen stays on while the app is open, so FMVs play without a touch.

## Running

No game data is in the repository. See [data/README.md](data/README.md) for
the server's data directory, its catalog and every environment variable.

```bash
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
- `/dev/cullcheck.html?level=<url>` renders moments of every route with and
  without room culling and reports how many pixels differ.
- `/dev/objects.html?level=<url>&maxr=400` lays out every object of a level
  with its number, for choosing the ring's objects (`shared/ring/sources.ts`).
- `/dev/models.html` shows the ring's own drawn artifacts, the fallback.

`TRX_LEVELS_DIR=<dir with level files> pnpm test` also reads every level it
finds there. Browser tests of whole flows are in [e2e/](e2e/README.md).

## Sign-in

- **Steam** uses OpenID to learn the account, then the Web API
  (`IPlayerService/GetOwnedGames`, which needs `STEAM_API_KEY`) for what it
  owns. Steam only answers for profiles whose game details are public; the
  app tells the player when that is the problem. The app polls the server
  while the player signs in on Steam's page, so it also works where that
  page opens outside an installed app.
- **GOG** has no sign-in for other sites. The app opens GOG's own login (the
  one GOG Galaxy and Heroic use); GOG then shows a blank page whose address
  the player pastes back into the app.

What an account owns is kept in a signed session cookie; signing in again
refreshes it. The server checks it on every download request.

## Layout

```
shared/        what the page and the server agree on: games, store ids, API shapes;
               the level file reader and the ring's objects
server/        the API server: catalog, sign-in, downloads, static files
src/
  flyby/       culled rendering of levels, smooth camera routes
  menu/        the home screen, the ring and its artifacts, the panels
  stage/       the WebGL canvas behind the menus
  input/       keyboard, gamepad, mouse and touch as one stream of actions
  account/     sign-in and the catalog, remembered for offline use
  pwa/         installing, updating, the service worker's registration, keeping the screen on
  gamedata/    the library: imports, layout, storage   (from the shell)
  games/       recognising games and custom levels     (from the shell)
  engine/      loading and running the engine          (from the shell)
  profiles/    profiles and their saves                (from the shell)
  play/        the play screen
vite/          dev proxy, service worker template and its build plugin
scripts/       dev runner, icon and level-list generators
dev/           preview pages
```

## Legal

Tomb Raider is a trademark of its owners; this project is not affiliated with
them. The repository contains no game data. The server sends every visitor the
background levels and the ring's objects, which come from the games. Gating
downloads on store ownership is a good-faith measure, not a licence: hosting
the games, and those parts of them, still needs their rights holders'
permission.
