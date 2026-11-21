// The public stats of stats.tombs.nexus: what the app reports and what the
// stats page gets back. Everything is anonymous: the app sends no id of the
// player or the device, and the server keeps only counts.

import { OFFICIAL_GAMES, STEAM } from './games.ts';

export type ScreenKind = 'phone' | 'tablet' | 'desktop';
/** The installed app, or a browser tab. */
export type DisplayKind = 'app' | 'tab';
export type InputKind = 'touch' | 'mouse' | 'keyboard' | 'gamepad';
export type PadKind = 'xbox' | 'playstation' | 'nintendo';
export type LookKind = 'tr1' | 'tr2' | 'tr3';

/** An official game's mod, or 'custom' for any custom level. */
export type PlayedGame = string;

export const SCREENS: readonly ScreenKind[] = ['phone', 'tablet', 'desktop'];
export const DISPLAYS: readonly DisplayKind[] = ['app', 'tab'];
export const INPUTS: readonly InputKind[] = ['touch', 'mouse', 'keyboard', 'gamepad'];
export const PADS: readonly PadKind[] = ['xbox', 'playstation', 'nintendo'];
export const LOOKS: readonly LookKind[] = ['tr1', 'tr2', 'tr3'];
export const PLAYED_GAMES: readonly PlayedGame[] = [...OFFICIAL_GAMES.map((game) => game.mod), 'custom'];

/** What Lara did, as the save files tell it: gains since the session's start. */
export interface LaraCounts {
    deaths: number;
    secrets: number;
    kills: number;
    pickups: number;
    /** In the game's metres. */
    distance: number;
    ammoUsed: number;
    ammoHits: number;
    medipacks: number;
    /** Levels finished. */
    levels: number;
}

export const LARA_FIELDS: readonly (keyof LaraCounts)[] = [
    'deaths',
    'secrets',
    'kills',
    'pickups',
    'distance',
    'ammoUsed',
    'ammoHits',
    'medipacks',
    'levels',
];

interface EventBase {
    /** When it happened, in milliseconds since 1970: events made offline arrive later. */
    at: number;
}

export type StatsEvent = EventBase &
    (
        | {
              /** The app's menu page opened. */
              type: 'open';
              screen: ScreenKind;
              display: DisplayKind;
              look: LookKind;
              /** The browser's language, such as "pt". */
              lang?: string;
              /** The site a link to the app was on, such as "www.reddit.com". */
              referrer?: string;
          }
        | {
              /** The player used a kind of device, once per page and kind. */
              type: 'input';
              device: InputKind;
              pad?: PadKind;
          }
        | {
              /** A game or level finished installing. */
              type: 'install';
              what: 'game' | 'trcustoms' | 'file';
              /** The official game, for what=game. */
              game?: string;
              /** TRCustoms' id of the level, for what=trcustoms. */
              level?: number;
          }
        | {
              /** The app opened as an installed app, the first time on this device. */
              type: 'appinstalled';
          }
        | {
              /** Minutes of play, sent as they pass. */
              type: 'play';
              /** A random id for one game session, so one session counts once. */
              session: string;
              game: PlayedGame;
              /** TRCustoms' id of the level, for a custom level from there. */
              level?: number;
              minutes: number;
              /** The session's minutes so far. */
              total: number;
              /** The player's local day of the week (0 = Monday) and hour. */
              weekday: number;
              hour: number;
          }
        | ({
              /** What Lara did in a session, read from the save files. */
              type: 'lara';
              game: PlayedGame;
          } & LaraCounts)
    );

/** POST /api/stats/events */
export interface StatsEventsRequest {
    events: StatsEvent[];
}

export const MAX_EVENTS_PER_REQUEST = 50;

export type StatsRange = '7' | '30' | '90' | 'all';
export const STATS_RANGES: readonly StatsRange[] = ['7', '30', '90', 'all'];

export interface Tally {
    key: string;
    n: number;
}

export interface DailyStats {
    /** YYYY-MM-DD, UTC. */
    day: string;
    visits: number;
    visitors: number;
    minutes: number;
    signIns: number;
}

export interface GameStats {
    game: PlayedGame;
    minutes: number;
    plays: number;
    installs: number;
    deaths: number;
}

export interface LevelStats {
    id: number;
    name: string;
    authors: string[];
    /** 1, 2 or 3, as TRCustoms files it. */
    game: number | null;
    /** The level's cover, through the app's server. */
    cover: string | null;
    installs: number;
    minutes: number;
}

/** GET /api/stats?range=… */
export interface StatsResponse {
    generatedAt: string;
    range: StatsRange;
    /** The first day anything was counted. */
    since: string | null;
    totals: {
        visits: number;
        /** People a day, added up over the days. */
        visitors: number;
        /** Steam accounts that signed in, ever. */
        players: number;
        /** Of them, those that came back on another day. */
        returningPlayers: number;
        /** Signed-in players seen in the range. */
        activePlayers: number;
        /** Signed in for the first time in the range. */
        newPlayers: number;
        minutesPlayed: number;
        plays: number;
        gameInstalls: number;
        levelInstalls: number;
        fileInstalls: number;
        appInstalls: number;
        /** Game sessions that reported a minute in the last few minutes. */
        playingNow: number;
    };
    daily: DailyStats[];
    countries: Tally[];
    games: GameStats[];
    levels: LevelStats[];
    devices: {
        screen: Tally[];
        display: Tally[];
        input: Tally[];
        pad: Tally[];
        browser: Tally[];
        os: Tally[];
        look: Tally[];
        lang: Tally[];
    };
    referrers: Tally[];
    /** Minutes played by the players' local weekday (0 = Monday) and hour: 7 × 24 numbers. */
    hours: number[];
    steam: {
        /** Of the signed-in players, how many own each: key = STEAM_PRODUCTS key. */
        owned: Tally[];
        /** Signed-in players whose Steam games are private. */
        private: number;
    };
    cloud: { accounts: number; files: number; bytes: number };
    /** Bytes sent, by what: games, engine, levels, saves, app. */
    bytes: Tally[];
    /** Requests from bots looking for holes, by what they looked for. */
    bots: Tally[];
    lara: LaraCounts;
    longestSession: { minutes: number; game: PlayedGame; day: string } | null;
}

/** The Steam products the stats name, by Steam app id. */
export const STEAM_PRODUCTS: readonly { key: string; app: number; name: string }[] = [
    { key: 'tr1', app: STEAM.tr1, name: 'Tomb Raider I' },
    { key: 'tr2', app: STEAM.tr2, name: 'Tomb Raider II' },
    { key: 'tr3', app: STEAM.tr3, name: 'Tomb Raider III' },
    { key: 'tr4', app: STEAM.tr4, name: 'The Last Revelation' },
    { key: 'remasteredI_III', app: STEAM.remasteredI_III, name: 'Tomb Raider I-III Remastered' },
    { key: 'remasteredIV_VI', app: STEAM.remasteredIV_VI, name: 'Tomb Raider IV-VI Remastered' },
];

// ------------------------------------------------------------ checking events

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown, max: number): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

function wholeCount(value: unknown, max: number): number | null {
    const n = count(value, max);
    return n !== null && Number.isInteger(n) ? n : null;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | null {
    return options.includes(value as T) ? (value as T) : null;
}

const LANG = /^[a-z]{2,3}$/;
const HOST = /^(?=.{1,100}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const SESSION = /^[A-Za-z0-9_-]{8,40}$/;
/** What one event may claim: a session of a day, a busy day's worth of Lara. */
const LARA_LIMITS: Record<keyof LaraCounts, number> = {
    deaths: 500,
    secrets: 500,
    kills: 5000,
    pickups: 5000,
    distance: 500_000,
    ammoUsed: 100_000,
    ammoHits: 100_000,
    medipacks: 1000,
    levels: 100,
};

/**
 * The event, checked and trimmed to what the server keeps, or null when it
 * is not one. Events from more than 30 days back, or from the future, are
 * not taken.
 */
export function readStatsEvent(value: unknown, now: number): StatsEvent | null {
    if (!isRecord(value)) return null;
    const at = typeof value.at === 'number' && Number.isFinite(value.at) ? Math.floor(value.at) : null;
    if (at === null || at > now + 5 * 60_000 || at < now - 30 * 24 * 60 * 60_000) return null;
    switch (value.type) {
        case 'open': {
            const screen = oneOf(value.screen, SCREENS);
            const display = oneOf(value.display, DISPLAYS);
            const look = oneOf(value.look, LOOKS);
            if (screen === null || display === null || look === null) return null;
            const event: StatsEvent = { type: 'open', at, screen, display, look };
            const lang = typeof value.lang === 'string' ? value.lang.toLowerCase() : '';
            if (LANG.test(lang)) event.lang = lang;
            const referrer = typeof value.referrer === 'string' ? value.referrer.toLowerCase() : '';
            if (HOST.test(referrer)) event.referrer = referrer;
            return event;
        }
        case 'input': {
            const device = oneOf(value.device, INPUTS);
            if (device === null) return null;
            const pad = device === 'gamepad' ? oneOf(value.pad, PADS) : null;
            return pad === null ? { type: 'input', at, device } : { type: 'input', at, device, pad };
        }
        case 'install': {
            if (value.what === 'game') {
                const game = oneOf(value.game, OFFICIAL_GAMES.map((entry) => entry.mod));
                return game === null ? null : { type: 'install', at, what: 'game', game };
            }
            if (value.what === 'trcustoms') {
                const level = wholeCount(value.level, 10_000_000);
                return level === null || level === 0 ? null : { type: 'install', at, what: 'trcustoms', level };
            }
            return value.what === 'file' ? { type: 'install', at, what: 'file' } : null;
        }
        case 'appinstalled':
            return { type: 'appinstalled', at };
        case 'play': {
            const session = typeof value.session === 'string' && SESSION.test(value.session) ? value.session : null;
            const game = oneOf(value.game, PLAYED_GAMES);
            const minutes = wholeCount(value.minutes, 60);
            const total = wholeCount(value.total, 24 * 60);
            const weekday = wholeCount(value.weekday, 6);
            const hour = wholeCount(value.hour, 23);
            if (session === null || game === null || minutes === null || minutes === 0 || total === null || weekday === null || hour === null) {
                return null;
            }
            const event: StatsEvent = { type: 'play', at, session, game, minutes, total: Math.max(total, minutes), weekday, hour };
            const level = game === 'custom' ? wholeCount(value.level, 10_000_000) : null;
            if (level !== null && level > 0) event.level = level;
            return event;
        }
        case 'lara': {
            const game = oneOf(value.game, PLAYED_GAMES);
            if (game === null) return null;
            const counts = {} as LaraCounts;
            for (const field of LARA_FIELDS) {
                const n = count(value[field], LARA_LIMITS[field]);
                if (n === null) return null;
                counts[field] = field === 'medipacks' ? Math.round(n * 2) / 2 : Math.floor(n);
            }
            if (counts.ammoHits > counts.ammoUsed) return null;
            if (LARA_FIELDS.every((field) => counts[field] === 0)) return null;
            return { type: 'lara', at, game, ...counts };
        }
        default:
            return null;
    }
}
