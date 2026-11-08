# Server data

Everything the server hands out, apart from the built page, lives here. The
directory is gitignored except for this file and `catalog.example.json`.

```
data/
  catalog.json            which archives and flyby levels to offer
  games/
    tr1.zip               one archive per game, named in catalog.json
    tr1-ub.zip
    …
  flyby/
    house.tr2             levels shown behind the menus
  engines/                TRX WebGL builds (ENGINES_DIR)
    manifest.json         optional: {"versions": ["1.5.0"]}
    1.5.0/
      trx-adapter.js
      trx-engine.js
      TRX.wasm
      TRX.data
```

## catalog.json

Copy `catalog.example.json` to `catalog.json` and list what you have:

```json
{
  "games": { "tr1": "games/tr1.zip", "tr1-ub": "games/tr1-ub.zip" },
  "flyby": [{ "file": "flyby/house.tr2", "name": "Croft Manor", "mod": "tr3" }]
}
```

- `games` maps an official game id to its archive: `tr1`, `tr1-ub`, `tr2`,
  `tr2-gm`, `tr3`, `tr3-la` or `tr4` (see `shared/games.ts`). Each archive
  holds the game's files as the page imports them from a file on the device.
  Ids that are not official games are ignored, and so are archives that are
  not on disk, so listing a game early does no harm.
- `flyby` lists level files every player gets for the menu background, with
  the official game they come from. The page fetches them from
  `/flyby/<mod>/<file name>`, so two levels of one game must not share a
  file name.
- Relative paths resolve against `DATA_DIR`; absolute paths work too.

The server re-reads the file when it changes, so games can be added without a
restart. Problems with it are logged as warnings.

## The ring's objects

The menu shows each game as an object from the game itself: the Scion, the
Dagger of Xian, the Infada Stone, an ankh, a statue of Bastet, the Golden
Mask, the Hand of Rathmore, and a compass for custom levels. When it starts,
and again whenever a listed archive changes, the server opens the archives in
`games`, reads the level each object is in, and cuts the object out (its
meshes and just the texels it uses), serving the result at
`/ring/manifest.json` and `/ring/<entry>.<hash>.json`. Which object of which
level stands for each entry is set in `shared/ring/sources.ts`;
`/dev/objects.html?level=<url>` lays out every object of a level with its
number, for choosing others.

An entry whose game is not here falls back to the next source listed, then
to a drawn artifact of the page's own. The Hand of Rathmore is only in The
Lost Artifact's last level, so without `tr3-la` the ring draws a hand.

## Who may download what

`GET /api/catalog` lists every game whose archive is here. Downloads from
`/api/gamedata/<id>` go to:

- everyone, for Unfinished Business (`tr1-ub`) and The Golden Mask
  (`tr2-gm`), which their publisher gave away;
- players signed in with a Steam account that owns the game, for the
  rest. Which Steam apps unlock which game is set in `shared/games.ts`:
  The Lost Artifact, for example, comes only with the remastered I–III.

The server checks on every request, each Range request of a download
included. What an account owns is checked with the store when the player
signs in and kept in the signed session cookie; signing in again refreshes it.

Engine builds, flyby levels and the ring's objects go to everyone.

## Environment

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3002` | Port to listen on. |
| `HOST` | `0.0.0.0` | Address to listen on. |
| `PUBLIC_URL` | `http://localhost:$PORT` | The address players open, without a trailing slash. Steam sends players back to `$PUBLIC_URL/auth/steam/callback`, so behind a proxy, or anywhere but localhost, it must be set. |
| `SESSION_SECRET` | random per start | Signs session cookies. Required, at least 32 characters, when `NODE_ENV=production`; without it every restart signs everyone out. Generate one with `openssl rand -base64 48`. |
| `SESSION_SECRET_FILE` | none | A file holding the session secret instead. |
| `STEAM_API_KEY` | none | A Steam Web API key (<https://steamcommunity.com/dev/apikey>). Steam sign-in is off without it. |
| `STEAM_API_KEY_FILE` | none | A file holding the key instead, such as a mounted Docker secret, which keeps it out of the container's environment. |
| `DATA_DIR` | `./data` | This directory. |
| `ENGINES_DIR` | `$DATA_DIR/engines` | The engine builds. Without `manifest.json` in it, its subdirectories are the versions. |
| `STATIC_DIR` | `./dist` | The built page (`pnpm build`). |
| `HTTPS_KEY`, `HTTPS_CERT` | none | PEM files to serve https directly, for testing on phones on the LAN: browsers only run the engine in secure contexts. A local CA such as mkcert works. |
| `AUTH_MOCK` | off | `1` offers `POST /api/auth/mock`, which signs in a made-up account owning whatever it says. For end-to-end tests only: it unlocks every game for anyone, and the server refuses it when `NODE_ENV=production`. |
| `LOG_LEVEL` | `info` | Fastify's log level. |
| `CLOUD_DIR` | `$DATA_DIR/cloud` | Where the cloud saves of players signed in with Steam are kept. Back it up: it is the only copy of their saves the server has. |
| `CLOUD_QUOTA_MB` | `256` | What one account may keep in the cloud, in megabytes. |
| `TRCUSTOMS_URL` | `https://trcustoms.org` | The TRCustoms the custom levels browser lists. The server asks it for levels and streams their archives, since TRCustoms sends no CORS headers. |
| `TRCUSTOMS_MEDIA_URL` | `https://data.trcustoms.org/media` | Where TRCustoms keeps its screenshots. The server passes them on, as their missing CORP header keeps a cross-origin isolated page from showing them, and keeps the latest 64 MB in memory. |

Paths are relative to the directory the server starts in.

## Signing in

**Steam** uses OpenID: the app opens Steam's sign-in page, Steam sends the
player back to `/auth/steam/callback`, and the app collects the result by
polling. Steam only tells the server what an account owns when the profile's
*Game details* are public (Steam → Edit Profile → Privacy Settings); otherwise
the account signs in owning nothing, and the app can say why.

## Cloud saves

Players signed in with Steam keep their profiles, saves and the list of
custom levels they added in `CLOUD_DIR`, a directory per account:

```
cloud/steam/<steam id>/
  index.json        the look picked in the settings; profiles, each with its
                    save files by hash and revision;
                    custom levels (where to download them, never the files);
                    what was deleted, so other devices delete it too
  files/<sha256>    the save files, named by their contents
```

Changes to one account go one at a time, and `index.json` is replaced
whole, so a crash never leaves half of it. A save file nothing points to
any more is deleted a quarter of an hour after it was sent. Only the
player's own session reaches their directory: every `/api/cloud` route
takes the account from the signed session cookie.

## Running

```bash
pnpm build                  # the page, into dist/
node server/src/main.ts     # Node 22.18 or later runs the TypeScript as is
```

Behind a reverse proxy, set `PUBLIC_URL`, pass `X-Forwarded-Proto` through,
leave the `Cross-Origin-*` headers alone, and do not compress or buffer
`/api/gamedata` and `/engines`: downloads resume with Range requests.

## Legal

The server sends a game's files only to players who have shown, through
Steam, that they own that game, and the free expansions to everyone. That
limits who receives them; it does not give you the right to distribute them.
Hosting the games' files for others still needs permission from their rights
holders. The same goes for the background levels and the ring's objects,
which every visitor receives, whether or not they own the game. Make sure you have it before putting a server where others can reach
it.
