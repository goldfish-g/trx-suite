// TRCustoms levels TRX cannot play, as the converter finds. When a player's
// conversion of a level stops because TRX cannot play it (the converter's
// UnplayableLevelError: a mod of Tomb Raider I-III Remastered, a level with
// objects TRX does not have), the page tells this server. The server does
// not take its word: it downloads the same file and runs the same converter
// on it, the checker (src/custom/convert/check.ts, built into
// server-dist/checker/check.mjs), one level at a time in a child process.
// Only then do the lists mark the level, and the page offers no download.
//
// A verdict holds for one file of a level: a new upload is a new file, with
// no verdict until a player reports it. When the checker runs another
// converter, every level found unplayable is checked again, and stays marked
// until the new converter says otherwise; other verdicts of an older
// converter are dropped.

import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CustomLevelGame } from '../../shared/api.ts';

/** What the checker answers (check.ts CheckAnswer). */
export type CheckVerdict = { verdict: 'unplayable'; reason: string } | { verdict: 'playable' } | { verdict: 'error'; message: string };

/** Runs the converter on an archive; tests stand in for the real one. */
export interface Checker {
    /** The converter it runs, a hash of its source, as the page's CONVERTER_VERSION. */
    version: string;
    /** The signal stops it, when the server shuts down. */
    check(archive: string, title: string, modId: string, signal?: AbortSignal): Promise<CheckVerdict>;
}

export interface CheckRecord {
    levelId: number;
    fileId: number;
    /** The converter that checked it. */
    converter: string;
    verdict: CheckVerdict['verdict'];
    /** Why TRX cannot play it, or how checking it failed. */
    reason?: string;
    checkedAt: string;
}

/** What the server needs to know of a level to check it, from TRCustoms. */
export interface ReportedLevel {
    id: number;
    name: string;
    game: CustomLevelGame | null;
    file: { id: number; sizeBytes: number } | null;
}

export interface UnplayableOptions {
    /** Where the verdicts and the archives being checked are kept. */
    dir: string;
    /** Null when there is none (the checker is not built): reports are then passed over. */
    checker: Checker | null;
    describe(levelId: number): Promise<ReportedLevel>;
    /** Downloads a TRCustoms file to a path, failing past maxBytes. */
    download(fileId: number, to: string, maxBytes: number, signal?: AbortSignal): Promise<void>;
    now(): number;
    log: { info(message: string): void; warn(message: string): void };
}

export type ReportOutcome = 'queued' | 'known' | 'ignored';

/** No archive on TRCustoms comes near this; the largest of TR1-3 are under 1 GB. */
const MAX_ARCHIVE_BYTES = 4 * 1024 ** 3;
const MAX_QUEUE = 25;
/** Reports one address may make in a day that lead to a check. */
const REPORTS_PER_DAY = 10;

const key = (levelId: number, fileId: number): string => `${levelId}:${fileId}`;

export class Unplayable {
    private readonly options: UnplayableOptions;
    private readonly checks = new Map<string, CheckRecord>();
    private readonly queue: { levelId: number; fileId: number }[] = [];
    private readonly reporters = new Map<string, { day: string; count: number }>();
    private running: Promise<void> | null = null;
    private stopped = false;
    /** Stops the check under way when the server shuts down. */
    private readonly stopping = new AbortController();

    constructor(options: UnplayableOptions) {
        this.options = options;
    }

    private get file(): string {
        return join(this.options.dir, 'checks.json');
    }

    private get downloads(): string {
        return join(this.options.dir, 'downloads');
    }

    /** Reads the verdicts, and checks again those an older converter made. */
    async start(): Promise<void> {
        await mkdir(this.options.dir, { recursive: true });
        // An archive left over from a check cut short.
        await rm(this.downloads, { recursive: true, force: true });
        let saved: CheckRecord[] = [];
        try {
            const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'));
            if (Array.isArray(parsed)) saved = parsed as CheckRecord[];
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.options.log.warn(`unplayable: ${this.file} could not be read: ${(error as Error).message}`);
        }
        const converter = this.options.checker?.version;
        for (const record of saved) {
            if (record.converter !== converter && record.verdict !== 'unplayable') continue;
            this.checks.set(key(record.levelId, record.fileId), record);
            if (converter !== undefined && record.converter !== converter) this.enqueue(record.levelId, record.fileId);
        }
        if (this.options.checker === null) this.options.log.warn('unplayable: no checker is built (server-dist/checker), so reports of unplayable levels are passed over.');
        this.pump();
    }

    async stop(): Promise<void> {
        this.stopped = true;
        this.queue.length = 0;
        this.stopping.abort();
        await this.running;
    }

    /** Why TRX cannot play this file of a level, where a check found so. */
    reasonFor(levelId: number, fileId: number | undefined): string | undefined {
        if (fileId === undefined) return undefined;
        const record = this.checks.get(key(levelId, fileId));
        return record?.verdict === 'unplayable' ? record.reason : undefined;
    }

    /** A player's conversion of this file said TRX cannot play it. */
    async report(levelId: number, fileId: number, reporter: string): Promise<ReportOutcome> {
        const { checker } = this.options;
        if (checker === null || this.stopped) return 'ignored';
        const known = this.checks.get(key(levelId, fileId));
        if (known !== undefined && known.converter === checker.version) return 'known';
        if (this.queue.some((item) => item.levelId === levelId && item.fileId === fileId)) return 'queued';
        if (this.queue.length >= MAX_QUEUE) return 'ignored';
        const day = new Date(this.options.now()).toISOString().slice(0, 10);
        const seen = this.reporters.get(reporter);
        const count = seen?.day === day ? seen.count : 0;
        if (count >= REPORTS_PER_DAY) return 'ignored';
        // Only the file TRCustoms offers now: the lists mark nothing else.
        const level = await this.options.describe(levelId).catch(() => null);
        if (level === null || level.game === null || level.file?.id !== fileId || level.file.sizeBytes > MAX_ARCHIVE_BYTES) return 'ignored';
        for (const [address, entry] of this.reporters) if (entry.day !== day) this.reporters.delete(address);
        this.reporters.set(reporter, { day, count: count + 1 });
        this.enqueue(levelId, fileId);
        this.pump();
        return 'queued';
    }

    /** Settles once every check queued so far is done; for tests. */
    async idle(): Promise<void> {
        while (this.running !== null) await this.running;
    }

    private enqueue(levelId: number, fileId: number): void {
        if (!this.queue.some((item) => item.levelId === levelId && item.fileId === fileId)) this.queue.push({ levelId, fileId });
    }

    private pump(): void {
        if (this.running !== null || this.queue.length === 0 || this.stopped) return;
        this.running = (async () => {
            while (this.queue.length > 0 && !this.stopped) {
                const next = this.queue.shift()!;
                await this.checkOne(next.levelId, next.fileId).catch((error: unknown) => {
                    if (!this.stopped) this.options.log.warn(`unplayable: checking level ${next.levelId} file ${next.fileId} failed: ${(error as Error).message}`);
                });
            }
        })().finally(() => {
            this.running = null;
        });
    }

    private async checkOne(levelId: number, fileId: number): Promise<void> {
        const checker = this.options.checker!;
        const level = await this.options.describe(levelId);
        if (level.file?.id !== fileId) {
            // The author has uploaded another file since; this one's verdict is no use.
            if (this.checks.delete(key(levelId, fileId))) await this.save();
            return;
        }
        await mkdir(this.downloads, { recursive: true });
        const archive = join(this.downloads, `${fileId}.archive`);
        let answer: CheckVerdict;
        try {
            const signal = this.stopping.signal;
            await this.options.download(fileId, archive, MAX_ARCHIVE_BYTES, signal);
            answer = await checker.check(archive, level.name, `custom-level-${levelId}`, signal);
            // Cut short by a shutdown: no verdict.
            if (signal.aborted) return;
        } finally {
            await rm(archive, { force: true });
        }
        const record: CheckRecord = {
            levelId,
            fileId,
            converter: checker.version,
            verdict: answer.verdict,
            ...(answer.verdict === 'unplayable' ? { reason: answer.reason } : answer.verdict === 'error' ? { reason: answer.message } : {}),
            checkedAt: new Date(this.options.now()).toISOString(),
        };
        this.checks.set(key(levelId, fileId), record);
        await this.save();
        this.options.log.info(`unplayable: level ${levelId} (${level.name}) file ${fileId}: ${record.verdict}${record.reason ? ` - ${record.reason}` : ''}`);
    }

    private async save(): Promise<void> {
        const temp = `${this.file}.tmp`;
        await writeFile(temp, JSON.stringify([...this.checks.values()], null, 1));
        await rename(temp, this.file);
    }
}

/** How long one check may take before it is given up. */
const CHECK_TIMEOUT_MS = 15 * 60_000;

/** Runs a child process of the checker and takes its one answer. */
function runChecker(path: string, args: string[], signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
        // Archives are read into memory whole, as the page reads them.
        const child = fork(path, args, { execArgv: ['--max-old-space-size=4096'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
        let answer: unknown;
        let stderr = '';
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr = (stderr + chunk.toString()).slice(-2000);
        });
        const timer = setTimeout(() => child.kill('SIGKILL'), CHECK_TIMEOUT_MS);
        const stop = () => child.kill('SIGKILL');
        signal?.addEventListener('abort', stop, { once: true });
        child.on('message', (message) => {
            answer = message;
        });
        child.on('error', reject);
        child.on('exit', (code, killedBy) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', stop);
            if (answer !== undefined) resolve(answer);
            else reject(new Error(`the checker stopped (${killedBy ?? `exit ${code}`}) without an answer${stderr ? `: ${stderr.trim().split('\n').at(-1)}` : ''}`));
        });
    });
}

/** The built checker at this path, or null when there is none. */
export async function loadChecker(path: string): Promise<Checker | null> {
    if (!existsSync(path)) return null;
    const answer = (await runChecker(path, ['--version'])) as { version?: unknown };
    if (typeof answer.version !== 'string') throw new Error(`${path} did not say which converter it runs.`);
    return {
        version: answer.version,
        async check(archive, title, modId, signal) {
            try {
                const verdict = (await runChecker(path, [archive, title, modId], signal)) as CheckVerdict;
                if (verdict.verdict === 'unplayable' || verdict.verdict === 'playable' || verdict.verdict === 'error') return verdict;
                return { verdict: 'error', message: 'the checker gave an answer this server does not know' };
            } catch (error) {
                return { verdict: 'error', message: (error as Error).message };
            }
        },
    };
}
