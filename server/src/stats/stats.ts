// The public stats: what the app reports (sendStats in the page), what the
// server sees for itself (sign-ins, bytes sent, bots), and the summary
// stats.tombs.nexus shows. Addresses are looked up for their country and
// dropped; see store.ts for what is kept.

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { LinkedAccount } from '../../../shared/api.ts';
import {
    LARA_FIELDS,
    PLAYED_GAMES,
    STEAM_PRODUCTS,
    type DailyStats,
    type LaraCounts,
    type LevelStats,
    type StatsEvent,
    type StatsRange,
    type StatsResponse,
    type Tally,
} from '../../../shared/stats.ts';
import { botProbeOf, browserOf, referrerOf, systemOf } from './agent.ts';
import type { Geo } from './geo.ts';
import { dayOf, StatsStore } from './store.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A session that reported within this long counts as playing now. */
const LIVE_MS = 3 * 60 * 1000;
const SUMMARY_TTL_MS = 60 * 1000;
const CLOUD_TTL_MS = 10 * 60 * 1000;
/** A level's name and cover are asked of TRCustoms again after this long. */
const LEVEL_TTL_MS = 30 * DAY_MS;
/** The longest daily chart the page gets. */
const MAX_DAYS = 366;
/** The most installed custom levels the page gets; it shows the first few until asked for all. */
const TOP_LEVELS = 20;

export interface LevelInfo {
    name: string;
    authors: string[];
    game: number | null;
    cover: string | null;
}

export interface StatsOptions {
    store: StatsStore;
    geo: Geo | null;
    cloudDir: string;
    now: () => number;
    /** What TRCustoms says about a level, for the names on the page. */
    describeLevel: (id: number) => Promise<LevelInfo>;
    log: { warn(message: string): void };
}

/** Who sent events: the address (never kept) and the browser, and the signed-in accounts. */
export interface Sender {
    address: string;
    userAgent: string;
    accounts: readonly LinkedAccount[];
}

export type ByteKind = 'games' | 'engine' | 'levels' | 'saves' | 'app';

export function byteKindOf(path: string): ByteKind {
    if (path.startsWith('/api/gamedata/')) return 'games';
    if (path.startsWith('/engines/')) return 'engine';
    if (path.startsWith('/api/trcustoms/files/')) return 'levels';
    if (path.startsWith('/api/cloud')) return 'saves';
    return 'app';
}

function sorted(map: Map<string, number>): Tally[] {
    return [...map]
        .filter(([, n]) => n > 0)
        .map(([key, n]) => ({ key, n }))
        .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

export function createStats(options: StatsOptions) {
    const { store, now } = options;
    const live = new Map<string, number>();
    const summaries = new Map<StatsRange, { at: number; value: StatsResponse }>();
    const fetchingLevels = new Set<number>();
    let cloud: { at: number; value: Promise<StatsResponse['cloud']> } | null = null;

    function learnLevel(id: number): void {
        const known = store.level(id);
        if (known !== null && now() - known.fetchedAt < LEVEL_TTL_MS) return;
        if (fetchingLevels.has(id)) return;
        fetchingLevels.add(id);
        options
            .describeLevel(id)
            .then((info) => store.putLevel(id, info, now()))
            .catch((error: unknown) => options.log.warn(`stats: TRCustoms level ${id} not described: ${(error as Error).message}`))
            .finally(() => fetchingLevels.delete(id));
    }

    function seeSteam(accounts: readonly LinkedAccount[], day: string): void {
        for (const account of accounts) {
            if (account.provider !== 'steam' || account.id.startsWith('mock-')) continue;
            const seen = store.seePlayer(account.id, day, account.owned, account.privateProfile === true);
            if (seen.firstToday) store.count(day, 'players', '');
        }
    }

    function take(event: StatsEvent, sender: Sender): void {
        const day = dayOf(event.at);
        switch (event.type) {
            case 'open': {
                store.count(day, 'visits', '');
                if (event.referrer !== undefined) store.count(day, 'referrer', referrerOf(event.referrer));
                const visitor = store.visitor(day, sender.address, sender.userAgent);
                if (store.firstSighting(day, `v:${visitor}`)) {
                    store.count(day, 'visitors', '');
                    store.count(day, 'country', options.geo?.country(sender.address) ?? 'unknown');
                    store.count(day, 'screen', event.screen);
                    store.count(day, 'display', event.display);
                    store.count(day, 'look', event.look);
                    store.count(day, 'browser', browserOf(sender.userAgent));
                    store.count(day, 'os', systemOf(sender.userAgent));
                    if (event.lang !== undefined) store.count(day, 'lang', event.lang);
                }
                seeSteam(sender.accounts, day);
                return;
            }
            case 'input': {
                const visitor = store.visitor(day, sender.address, sender.userAgent);
                if (store.firstSighting(day, `i:${visitor}:${event.device}`)) store.count(day, 'input', event.device);
                if (event.pad !== undefined && store.firstSighting(day, `p:${visitor}:${event.pad}`)) store.count(day, 'pad', event.pad);
                return;
            }
            case 'install':
                if (event.what === 'game') store.count(day, 'install', `game:${event.game}`);
                else store.count(day, 'install', event.what);
                if (event.what === 'trcustoms' && event.level !== undefined) {
                    store.count(day, 'level-installs', String(event.level));
                    learnLevel(event.level);
                }
                return;
            case 'appinstalled':
                store.count(day, 'appinstalled', '');
                return;
            case 'play': {
                store.count(day, 'minutes', event.game, event.minutes);
                store.count(day, 'hours', `${event.weekday}-${event.hour}`, event.minutes);
                if (event.level !== undefined) {
                    store.count(day, 'level-minutes', String(event.level), event.minutes);
                    learnLevel(event.level);
                }
                // A session played over midnight counts on the day it started.
                const session = `s:${event.session}`;
                if (!store.sawOn(dayOf(event.at - DAY_MS), session) && store.firstSighting(day, session)) store.count(day, 'plays', event.game);
                store.record('longest-session', event.total, event.game, day);
                if (now() - event.at < LIVE_MS) live.set(event.session, event.at);
                return;
            }
            case 'lara':
                for (const field of LARA_FIELDS) {
                    // Medipacks come in halves.
                    store.count(day, 'lara', field, field === 'medipacks' ? event[field] * 2 : event[field]);
                }
                store.count(day, 'lara-deaths', event.game, event.deaths);
                return;
        }
    }

    async function cloudSummary(): Promise<StatsResponse['cloud']> {
        const result = { accounts: 0, files: 0, bytes: 0 };
        const steam = join(options.cloudDir, 'steam');
        const accounts = await readdir(steam).catch(() => [] as string[]);
        for (const account of accounts) {
            const files = await readdir(join(steam, account, 'files')).catch(() => null);
            if (files === null) continue;
            result.accounts++;
            for (const file of files) {
                const info = await stat(join(steam, account, 'files', file)).catch(() => null);
                if (info?.isFile()) {
                    result.files++;
                    result.bytes += info.size;
                }
            }
        }
        return result;
    }

    function levelStats(from: string | null): LevelStats[] {
        const installs = store.tally('level-installs', from);
        const minutes = store.tally('level-minutes', from);
        const ids = new Set([...installs.keys(), ...minutes.keys()]);
        return [...ids]
            .map((key) => {
                const id = Number(key);
                const info = store.level(id);
                return {
                    id,
                    name: info?.name ?? `TRCustoms level ${id}`,
                    authors: info?.authors ?? [],
                    game: info?.game ?? null,
                    cover: info?.cover ?? null,
                    installs: installs.get(key) ?? 0,
                    minutes: minutes.get(key) ?? 0,
                };
            })
            .sort((a, b) => b.installs - a.installs || b.minutes - a.minutes || a.name.localeCompare(b.name))
            .slice(0, TOP_LEVELS);
    }

    async function build(range: StatsRange): Promise<StatsResponse> {
        const time = now();
        const today = dayOf(time);
        const from = range === 'all' ? null : dayOf(time - (Number(range) - 1) * DAY_MS);
        const since = store.firstDay();

        const start = from ?? (since !== null && since < today ? since : today);
        const chartFrom = start < dayOf(time - (MAX_DAYS - 1) * DAY_MS) ? dayOf(time - (MAX_DAYS - 1) * DAY_MS) : start;
        const series = {
            visits: store.byDay('visits', chartFrom),
            visitors: store.byDay('visitors', chartFrom),
            minutes: store.byDay('minutes', chartFrom),
            signIns: store.byDay('signin', chartFrom),
        };
        const daily: DailyStats[] = [];
        for (let t = Date.parse(`${chartFrom}T00:00:00Z`); dayOf(t) <= today; t += DAY_MS) {
            const day = dayOf(t);
            daily.push({
                day,
                visits: series.visits.get(day) ?? 0,
                visitors: series.visitors.get(day) ?? 0,
                minutes: series.minutes.get(day) ?? 0,
                signIns: series.signIns.get(day) ?? 0,
            });
        }

        const installs = store.tally('install', from);
        const minutes = store.tally('minutes', from);
        const plays = store.tally('plays', from);
        const deaths = store.tally('lara-deaths', from);
        const games = PLAYED_GAMES.map((game) => ({
            game,
            minutes: minutes.get(game) ?? 0,
            plays: plays.get(game) ?? 0,
            installs: game === 'custom' ? (installs.get('trcustoms') ?? 0) + (installs.get('file') ?? 0) : (installs.get(`game:${game}`) ?? 0),
            deaths: deaths.get(game) ?? 0,
        }))
            .filter((game) => game.minutes + game.plays + game.installs + game.deaths > 0)
            .sort((a, b) => b.minutes - a.minutes || b.plays - a.plays || b.installs - a.installs);

        const hourly = store.tally('hours', from);
        const hours = Array.from({ length: 7 * 24 }, (_, index) => hourly.get(`${Math.floor(index / 24)}-${index % 24}`) ?? 0);

        const lara = store.tally('lara', from);
        const laraCounts = Object.fromEntries(
            LARA_FIELDS.map((field) => [field, field === 'medipacks' ? (lara.get(field) ?? 0) / 2 : (lara.get(field) ?? 0)]),
        ) as unknown as LaraCounts;

        const players = store.players();
        const owned = new Map<string, number>();
        for (const player of players) {
            const apps = new Set(JSON.parse(player.owned) as number[]);
            for (const product of STEAM_PRODUCTS) if (apps.has(product.app)) owned.set(product.key, (owned.get(product.key) ?? 0) + 1);
        }

        for (const [session, at] of live) if (time - at >= LIVE_MS) live.delete(session);
        const longest = store.getRecord('longest-session');
        const gameInstalls = [...installs].filter(([key]) => key.startsWith('game:')).reduce((sum, [, n]) => sum + n, 0);

        if (cloud === null || time - cloud.at >= CLOUD_TTL_MS) cloud = { at: time, value: cloudSummary() };

        return {
            generatedAt: new Date(time).toISOString(),
            range,
            since,
            totals: {
                visits: store.total('visits', from),
                visitors: store.total('visitors', from),
                players: players.length,
                returningPlayers: players.filter((player) => player.days > 1).length,
                activePlayers: players.filter((player) => from === null || player.last_day >= from).length,
                newPlayers: players.filter((player) => from === null || player.first_day >= from).length,
                minutesPlayed: store.total('minutes', from),
                plays: store.total('plays', from),
                gameInstalls,
                levelInstalls: installs.get('trcustoms') ?? 0,
                fileInstalls: installs.get('file') ?? 0,
                appInstalls: store.total('appinstalled', from),
                playingNow: live.size,
            },
            daily,
            countries: sorted(store.tally('country', from)),
            games,
            levels: levelStats(from),
            devices: {
                screen: sorted(store.tally('screen', from)),
                display: sorted(store.tally('display', from)),
                input: sorted(store.tally('input', from)),
                pad: sorted(store.tally('pad', from)),
                browser: sorted(store.tally('browser', from)),
                os: sorted(store.tally('os', from)),
                look: sorted(store.tally('look', from)),
                lang: sorted(store.tally('lang', from)),
            },
            referrers: sorted(store.tally('referrer', from)),
            hours,
            steam: { owned: sorted(owned), private: players.filter((player) => player.private === 1).length },
            cloud: await cloud.value,
            bytes: sorted(store.tally('bytes', from)),
            bots: sorted(store.tally('bots', from)),
            lara: laraCounts,
            longestSession: longest === null ? null : { minutes: longest.n, game: longest.detail, day: longest.day },
        };
    }

    return {
        /** Takes the events one sender reported; ones already checked by readStatsEvent. */
        take(events: readonly StatsEvent[], sender: Sender): void {
            store.purge(dayOf(now()));
            for (const event of events) take(event, sender);
        },

        /** A player signed in with Steam. */
        signedIn(account: LinkedAccount): void {
            if (account.provider !== 'steam' || account.id.startsWith('mock-')) return;
            const day = dayOf(now());
            const seen = store.seePlayer(account.id, day, account.owned, account.privateProfile === true);
            store.count(day, 'signin', seen.isNew ? 'new' : 'returning');
            if (seen.firstToday) store.count(day, 'players', '');
        },

        sent(path: string, bytes: number): void {
            if (bytes > 0) store.count(dayOf(now()), 'bytes', byteKindOf(path), bytes);
        },

        /** Counts a request for a page that only bots ask for; true when it was one. */
        probe(path: string): boolean {
            const kind = botProbeOf(path);
            if (kind !== null) store.count(dayOf(now()), 'bots', kind);
            return kind !== null;
        },

        async summary(range: StatsRange): Promise<StatsResponse> {
            const kept = summaries.get(range);
            if (kept !== undefined && now() - kept.at < SUMMARY_TTL_MS) return kept.value;
            const value = await build(range);
            summaries.set(range, { at: now(), value });
            return value;
        },
    };
}

export type Stats = ReturnType<typeof createStats>;
