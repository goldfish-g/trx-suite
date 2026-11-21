// What the app tells stats.tombs.nexus. Nothing in it names the player or
// the device: a visit, a minute of play, an install, what Lara did. Reports
// wait in an outbox in localStorage until the server has them, so play
// offline counts once the app is back online.

import { MAX_EVENTS_PER_REQUEST, PLAYED_GAMES, type PlayedGame, type StatsEvent } from '../../shared/stats.ts';
import { OFFICIAL_GAMES } from '../../shared/games.ts';
import type { GameDataRecord } from '../gamedata/types';
import { onDeviceUsed, type InputDevice, type PadStyle } from '../input/controller';
import { isStandalone } from '../pwa/install';
import { useTheme } from '../ui/theme';

const OUTBOX = 'trx-suite:stats-outbox';
/** Five hours of offline play, a minute an event; the oldest go first. */
const MAX_KEPT = 300;
const FLUSH_DELAY_MS = 3000;
const LOCK = 'trx-suite:stats';

type Draft = StatsEvent extends infer E ? (E extends StatsEvent ? Omit<E, 'at'> : never) : never;

function load(): StatsEvent[] {
    try {
        const kept: unknown = JSON.parse(localStorage.getItem(OUTBOX) ?? '[]');
        return Array.isArray(kept) ? (kept as StatsEvent[]) : [];
    } catch {
        return [];
    }
}

function keep(events: readonly StatsEvent[]): void {
    try {
        if (events.length === 0) localStorage.removeItem(OUTBOX);
        else localStorage.setItem(OUTBOX, JSON.stringify(events.slice(-MAX_KEPT)));
    } catch {
        // Not kept: a private window, or storage full.
    }
}

/**
 * Runs a change to the outbox alone: the menu page and a game's frame, or
 * two tabs, each have one in hand. Where the browser has no Web Locks, the
 * page's own turn is all there is.
 */
let localTurn: Promise<unknown> = Promise.resolve();
function exclusively<T>(task: () => Promise<T> | T): Promise<T> {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks !== undefined) return locks.request(LOCK, async () => task()) as Promise<T>;
    const run = localTurn.then(task, task);
    localTurn = run.catch(() => {});
    return run;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(delay = FLUSH_DELAY_MS): void {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush();
    }, delay);
}

/** Sends what waits, a batch at a time; what the server did not take stays for later. */
export function flush(): Promise<void> {
    return exclusively(async () => {
        while (navigator.onLine !== false) {
            const events = load();
            if (events.length === 0) return;
            const batch = events.slice(0, MAX_EVENTS_PER_REQUEST);
            let response: Response;
            try {
                response = await fetch('/api/stats/events', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ events: batch }),
                    keepalive: true,
                    signal: AbortSignal.timeout(15_000),
                });
            } catch {
                return;
            }
            // Too many: later. Anything else the server answered is done with,
            // taken or turned down; resending a batch it refused would not help.
            if (response.status === 429 || response.status >= 500) return;
            // Events added meanwhile came after these.
            keep(load().slice(batch.length));
        }
    }).catch(() => {});
}

/** Puts a report in the outbox and sends it soon; resolves once it is kept. */
export function report(draft: Draft): Promise<void> {
    const event = { ...draft, at: Date.now() } as StatsEvent;
    return exclusively(() => keep([...load(), event]))
        .then(() => scheduleFlush())
        .catch(() => {});
}

// ------------------------------------------------------------- the visit

function screenKind(): 'phone' | 'tablet' | 'desktop' {
    if (!matchMedia('(pointer: coarse)').matches) return 'desktop';
    return Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet';
}

function referrerHost(): string | undefined {
    try {
        const host = document.referrer === '' ? '' : new URL(document.referrer).hostname;
        return host !== '' && host !== location.hostname ? host : undefined;
    } catch {
        return undefined;
    }
}

/** Set on a device once its installed app has been counted; never sent anywhere. */
const APP_COUNTED = 'trx-suite:stats-app-counted';

/**
 * Counts the installed app once per device, the first time it opens as one.
 * Every browser tells a page it runs as an installed app, while only some
 * say when they install it (Safari and Firefox never do), so this counts the
 * same everywhere, and installs from before the stats too.
 */
function reportAppInstall(): void {
    if (!isStandalone()) return;
    try {
        if (localStorage.getItem(APP_COUNTED) !== null) return;
    } catch {
        // Nowhere to note it, so it could only count again and again.
        return;
    }
    void report({ type: 'appinstalled' }).then(() => {
        try {
            localStorage.setItem(APP_COUNTED, '1');
        } catch {
            // Counted again next time, then.
        }
    });
}

/** Reports the visit and the devices it uses, and sends what waits. Once, on the menu page. */
export function reportVisit(): void {
    const draft: Draft = {
        type: 'open',
        screen: screenKind(),
        display: isStandalone() ? 'app' : 'tab',
        look: useTheme.getState().theme,
    };
    const lang = (navigator.language ?? '').split('-')[0]?.toLowerCase();
    if (lang) draft.lang = lang;
    const referrer = referrerHost();
    if (referrer !== undefined) draft.referrer = referrer;
    report(draft);

    const used = new Set<string>();
    onDeviceUsed((device: InputDevice, pad?: PadStyle) => {
        const key = device === 'gamepad' ? `${device}:${pad ?? ''}` : device;
        if (used.has(key)) return;
        used.add(key);
        report(device === 'gamepad' && pad !== undefined ? { type: 'input', device, pad } : { type: 'input', device });
    });

    reportAppInstall();
    window.addEventListener('online', () => scheduleFlush(0));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void flush();
    });
    // Reports a game's frame left behind.
    scheduleFlush(0);
}

// ------------------------------------------------------------- installs

const OFFICIAL_MODS = new Set(OFFICIAL_GAMES.map((game) => game.mod));

/** A game or level finished installing for the first time. */
export function reportInstall(record: GameDataRecord): void {
    const { source } = record;
    if (source.kind === 'trcustoms') report({ type: 'install', what: 'trcustoms', level: source.levelId });
    else if (source.kind === 'upload' || source.kind === 'link') report({ type: 'install', what: 'file' });
    else if (OFFICIAL_MODS.has(record.mod)) report({ type: 'install', what: 'game', game: record.mod });
}

// ------------------------------------------------------------- play

/** What the stats call a played game: an official one by its mod, any custom level as 'custom'. */
export interface PlayedLabel {
    game: PlayedGame;
    /** TRCustoms' id, for a level from there. */
    level?: number;
}

export function playedLabel(record: GameDataRecord, mod: string): PlayedLabel {
    if (record.layout === 'game' && PLAYED_GAMES.includes(mod) && mod !== 'custom') return { game: mod };
    return record.source.kind === 'trcustoms' ? { game: 'custom', level: record.source.levelId } : { game: 'custom' };
}

const TICK_MS = 15_000;

function sessionId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Counts the minutes a game is on screen and reports each one; returns what
 * stops it. A game in a hidden tab is not being played.
 */
export function startPlayClock(label: PlayedLabel): () => void {
    const session = sessionId();
    let seconds = 0;
    let total = 0;
    const timer = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        seconds += TICK_MS / 1000;
        if (seconds < 60) return;
        seconds -= 60;
        total++;
        const now = new Date();
        report({
            type: 'play',
            session,
            ...label,
            minutes: 1,
            total,
            weekday: (now.getDay() + 6) % 7,
            hour: now.getHours(),
        });
    }, TICK_MS);
    return () => clearInterval(timer);
}
