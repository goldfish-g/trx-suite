# Browser tests

End-to-end checks in Chromium (Playwright), run against a running server
started with `AUTH_MOCK=1` and a catalog that offers The Golden Mask, the
default flyby level and an engine build. Screenshots go to `$SHOTS`
(default `.work/shots`).

```bash
BASE=https://localhost:5173 node e2e/play.mjs     # dev server: ring, free download, play, flyby from the library, test sign-in
BASE=https://localhost:5173 node e2e/input.mjs    # gamepad (simulated), mouse drag, wheel, click, keyboard
BASE=https://localhost:8080 node e2e/offline.mjs  # built app (pnpm build && pnpm start): installs, downloads, plays offline
```

WebGL runs in SwiftShader, so frames are slow; the scripts allow for that.
`offline.mjs` needs `--ignore-certificate-errors` for a self-signed
certificate, because Chromium refuses to register a service worker over one.
