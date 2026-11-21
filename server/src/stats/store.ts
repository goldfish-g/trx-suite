// Where the stats are kept: an SQLite file of counts by day. Nothing in it
// names a person or a device. Within a day, people are told apart by a hash of
// their address, and their devices by one of address and browser, made with a
// salt that changes every day; the hashes
// and the salts go after two days, so no one can be followed from one day to
// the next. Signed-in players are counted by a keyed hash of their Steam id,
// which is what lets the page say how many come back.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

/** UTC day of a time, YYYY-MM-DD. */
export function dayOf(time: number): string {
    return new Date(time).toISOString().slice(0, 10);
}

/** Visitor hashes and session ids are kept this many days, for events that arrive late. */
const SEEN_DAYS = 2;

export interface PlayerRow {
    first_day: string;
    last_day: string;
    days: number;
    owned: string;
    private: number;
}

export class StatsStore {
    private readonly db: DatabaseSync;
    private readonly add: StatementSync;
    private readonly see: StatementSync;
    private readonly getSalt: StatementSync;
    private readonly putSalt: StatementSync;
    private salts = new Map<string, string>();
    private lastPurge = '';

    /** Keys the hashes of Steam accounts; made once and kept with the stats, so players stay one each. */
    private readonly playerKey: string;

    constructor(path: string) {
        if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
        this.db = new DatabaseSync(path);
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS counters (
                day TEXT NOT NULL, metric TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL,
                PRIMARY KEY (day, metric, key)
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS seen (day TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY (day, key)) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS keys (name TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS players (
                id TEXT PRIMARY KEY, first_day TEXT NOT NULL, last_day TEXT NOT NULL,
                days INTEGER NOT NULL, owned TEXT NOT NULL, private INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS records (
                name TEXT PRIMARY KEY, n INTEGER NOT NULL, detail TEXT NOT NULL, day TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS levels (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, authors TEXT NOT NULL,
                game INTEGER, cover TEXT, fetched_at INTEGER NOT NULL
            );
        `);
        this.add = this.db.prepare(
            'INSERT INTO counters (day, metric, key, n) VALUES (?, ?, ?, ?) ON CONFLICT (day, metric, key) DO UPDATE SET n = n + excluded.n',
        );
        this.see = this.db.prepare('INSERT OR IGNORE INTO seen (day, key) VALUES (?, ?)');
        this.getSalt = this.db.prepare('SELECT salt FROM salts WHERE day = ?');
        this.putSalt = this.db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)');
        this.db.prepare('INSERT OR IGNORE INTO keys (name, value) VALUES (?, ?)').run('players', randomBytes(32).toString('hex'));
        this.playerKey = (this.db.prepare('SELECT value FROM keys WHERE name = ?').get('players') as { value: string }).value;
    }

    close(): void {
        this.db.close();
    }

    count(day: string, metric: string, key: string, n = 1): void {
        if (n !== 0) this.add.run(day, metric, key, n);
    }

    /** True the first time a key is seen on a day. */
    firstSighting(day: string, key: string): boolean {
        return Number(this.see.run(day, key).changes) > 0;
    }

    sawOn(day: string, key: string): boolean {
        return this.db.prepare('SELECT 1 FROM seen WHERE day = ? AND key = ?').get(day, key) !== undefined;
    }

    /**
     * A visitor's name for one day, no other day's linked to it: of the
     * address alone for a person, of the address and browser for a device.
     */
    visitor(day: string, address: string, userAgent?: string): string {
        let salt = this.salts.get(day);
        if (salt === undefined) {
            this.putSalt.run(day, randomBytes(16).toString('hex'));
            salt = (this.getSalt.get(day) as { salt: string }).salt;
            this.salts.set(day, salt);
        }
        const name = userAgent === undefined ? address : `${address}\n${userAgent}`;
        return createHash('sha256').update(`${salt}\n${name}`).digest('base64url').slice(0, 22);
    }

    /** Forgets visitor hashes, session ids and salts older than a couple of days. */
    purge(today: string): void {
        if (today === this.lastPurge) return;
        this.lastPurge = today;
        const cutoff = dayOf(Date.parse(`${today}T00:00:00Z`) - SEEN_DAYS * 24 * 60 * 60 * 1000);
        this.db.prepare('DELETE FROM seen WHERE day < ?').run(cutoff);
        this.db.prepare('DELETE FROM salts WHERE day < ?').run(cutoff);
        for (const day of this.salts.keys()) if (day < cutoff) this.salts.delete(day);
    }

    playerId(steamId: string): string {
        return createHmac('sha256', this.playerKey).update(`steam:${steamId}`).digest('base64url').slice(0, 22);
    }

    /**
     * Notes a signed-in player on a day; returns whether they are new, and
     * whether this is their first time that day.
     */
    seePlayer(steamId: string, day: string, owned: readonly number[], privateProfile: boolean): { isNew: boolean; firstToday: boolean } {
        const id = this.playerId(steamId);
        const row = this.db.prepare('SELECT last_day, days FROM players WHERE id = ?').get(id) as
            | { last_day: string; days: number }
            | undefined;
        const ownedText = JSON.stringify([...owned].sort((a, b) => a - b));
        if (row === undefined) {
            this.db
                .prepare('INSERT INTO players (id, first_day, last_day, days, owned, private) VALUES (?, ?, ?, 1, ?, ?)')
                .run(id, day, day, ownedText, privateProfile ? 1 : 0);
            return { isNew: true, firstToday: true };
        }
        const firstToday = day > row.last_day;
        this.db
            .prepare('UPDATE players SET last_day = ?, days = ?, owned = ?, private = ? WHERE id = ?')
            .run(firstToday ? day : row.last_day, firstToday ? row.days + 1 : row.days, ownedText, privateProfile ? 1 : 0, id);
        return { isNew: false, firstToday };
    }

    /** Keeps the larger of a record and a new value. */
    record(name: string, n: number, detail: string, day: string): void {
        this.db
            .prepare(
                'INSERT INTO records (name, n, detail, day) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET n = excluded.n, detail = excluded.detail, day = excluded.day WHERE excluded.n > records.n',
            )
            .run(name, n, detail, day);
    }

    getRecord(name: string): { n: number; detail: string; day: string } | null {
        return (this.db.prepare('SELECT n, detail, day FROM records WHERE name = ?').get(name) as { n: number; detail: string; day: string } | undefined) ?? null;
    }

    // -------------------------------------------------------------- reading

    /** Totals of a metric by key over the days from `from` (inclusive), all days when null. */
    tally(metric: string, from: string | null): Map<string, number> {
        const rows = this.db
            .prepare('SELECT key, SUM(n) AS n FROM counters WHERE metric = ? AND day >= ? GROUP BY key')
            .all(metric, from ?? '') as { key: string; n: number }[];
        return new Map(rows.map((row) => [row.key, Number(row.n)]));
    }

    total(metric: string, from: string | null): number {
        const row = this.db.prepare('SELECT SUM(n) AS n FROM counters WHERE metric = ? AND day >= ?').get(metric, from ?? '') as {
            n: number | null;
        };
        return Number(row.n ?? 0);
    }

    /** A metric's total by day, from a day on. */
    byDay(metric: string, from: string): Map<string, number> {
        const rows = this.db
            .prepare('SELECT day, SUM(n) AS n FROM counters WHERE metric = ? AND day >= ? GROUP BY day')
            .all(metric, from) as { day: string; n: number }[];
        return new Map(rows.map((row) => [row.day, Number(row.n)]));
    }

    firstDay(): string | null {
        const row = this.db.prepare('SELECT MIN(day) AS day FROM counters').get() as { day: string | null };
        return row.day;
    }

    players(): PlayerRow[] {
        return this.db.prepare('SELECT first_day, last_day, days, owned, private FROM players').all() as unknown as PlayerRow[];
    }

    // --------------------------------------------------------------- levels

    level(id: number): { name: string; authors: string[]; game: number | null; cover: string | null; fetchedAt: number } | null {
        const row = this.db.prepare('SELECT name, authors, game, cover, fetched_at FROM levels WHERE id = ?').get(id) as
            | { name: string; authors: string; game: number | null; cover: string | null; fetched_at: number }
            | undefined;
        if (row === undefined) return null;
        return { name: row.name, authors: JSON.parse(row.authors) as string[], game: row.game, cover: row.cover, fetchedAt: row.fetched_at };
    }

    putLevel(id: number, level: { name: string; authors: string[]; game: number | null; cover: string | null }, fetchedAt: number): void {
        this.db
            .prepare(
                'INSERT INTO levels (id, name, authors, game, cover, fetched_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, authors = excluded.authors, game = excluded.game, cover = excluded.cover, fetched_at = excluded.fetched_at',
            )
            .run(id, level.name, JSON.stringify(level.authors), level.game, level.cover, fetchedAt);
    }
}
