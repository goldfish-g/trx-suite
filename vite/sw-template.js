// The service worker. vite/pwa.ts fills in, at build time, the list of
// files the app needs and a version that changes with them.
//
// - The app itself (page, scripts, styles, fonts, icons) is cached on
//   install, so the app opens with no connection.
// - The background levels every player gets, and the objects on the
//   menu's ring, are cached on install too.
// - Engines and game data are stored by the app itself (Cache Storage and
//   IndexedDB), with resumable downloads; the worker stays out of their way.
// - Every page it serves carries the cross-origin isolation headers, which
//   the engine's threads need, even when it comes from the cache.

const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const SHELL = `trx-web-shell-${VERSION}`;
const RUNTIME = 'trx-web-runtime';
const NAVIGATION_TIMEOUT_MS = 4000;
const ISOLATION = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
};

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(SHELL);
            await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
            await cacheFlybyLevels().catch((error) => console.warn('[sw] background levels not cached:', error));
            await cacheRingModels().catch((error) => console.warn('[sw] ring models not cached:', error));
        })(),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            for (const name of await caches.keys()) {
                if (name.startsWith('trx-web-shell-') && name !== SHELL) await caches.delete(name);
            }
            await self.clients.claim();
        })(),
    );
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'skip-waiting') self.skipWaiting();
});

async function cacheFlybyLevels() {
    const cache = await caches.open(RUNTIME);
    const response = await fetch('/flyby/manifest.json', { cache: 'no-store' });
    if (!response.ok) return;
    await cache.put('/flyby/manifest.json', response.clone());
    const manifest = await response.json();
    for (const level of manifest.levels ?? []) {
        if (typeof level.url !== 'string' || (await cache.match(level.url))) continue;
        const file = await fetch(level.url);
        if (file.ok) await cache.put(level.url, file);
    }
}

async function cacheRingModels() {
    const cache = await caches.open(RUNTIME);
    const response = await fetch('/ring/manifest.json', { cache: 'no-store' });
    if (!response.ok) return;
    await cache.put('/ring/manifest.json', response.clone());
    const manifest = await response.json();
    for (const model of Object.values(manifest.models ?? {})) {
        if (typeof model?.url !== 'string' || (await cache.match(model.url))) continue;
        const file = await fetch(model.url);
        if (file.ok) await cache.put(model.url, file);
    }
}

function withIsolation(response) {
    if (response.type === 'opaque' || response.headers.get('Cross-Origin-Embedder-Policy') === 'require-corp') return response;
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(ISOLATION)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function navigate(request) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
        const response = await fetch(request, { signal: controller.signal });
        clearTimeout(timer);
        if (response.ok) return withIsolation(response);
        throw new Error(`status ${response.status}`);
    } catch {
        const cached = (await caches.match('/index.html', { cacheName: SHELL })) ?? (await caches.match('/'));
        if (cached !== undefined) return withIsolation(cached);
        return new Response('Offline, and the app is not stored yet.', { status: 503, headers: ISOLATION });
    }
}

async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request, { cacheName });
    if (cached !== undefined) return withIsolation(cached);
    const response = await fetch(request);
    if (response.ok && cacheName === RUNTIME) {
        const cache = await caches.open(RUNTIME);
        await cache.put(request, response.clone());
    }
    return withIsolation(response);
}

async function networkFirst(request) {
    try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok) {
            const cache = await caches.open(RUNTIME);
            await cache.put(request, response.clone());
        }
        return withIsolation(response);
    } catch (error) {
        const cached = await caches.match(request, { cacheName: RUNTIME });
        if (cached !== undefined) return withIsolation(cached);
        throw error;
    }
}

const PRECACHED = new Set(PRECACHE);

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    const path = url.pathname;

    if (request.mode === 'navigate') {
        event.respondWith(navigate(request));
        return;
    }
    // Sign-in, the catalog and game downloads need the server, and the app
    // keeps its own copies of what it must know offline.
    if (path.startsWith('/api/') || path.startsWith('/auth/')) return;
    if (path === '/engines/manifest.json' || path === '/flyby/manifest.json' || path === '/ring/manifest.json') {
        event.respondWith(networkFirst(request));
        return;
    }
    // Engine builds are large; the app stores them itself, resumably.
    if (path.startsWith('/engines/')) return;
    // Flyby levels and ring models: their names change when they do.
    if (path.startsWith('/flyby/') || path.startsWith('/ring/')) {
        event.respondWith(cacheFirst(request, RUNTIME));
        return;
    }
    if (PRECACHED.has(path)) {
        event.respondWith(cacheFirst(request, SHELL));
    }
});
