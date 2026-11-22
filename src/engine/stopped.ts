// Why a session ended before the player started the game: the engine's own
// last words, from its log.

/** The engine ended before the player started the game: it could not, and its log says why. */
export class EngineStoppedError extends Error {
    constructor(code: number, lines: readonly string[]) {
        // Its log lines carry terminal colours; the last error, or else the last line, tells most.
        const plain = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter((line) => line !== '');
        const error = [...plain].reverse().find((line) => /^(ERR|FTL|FATAL)\b/.test(line)) ?? plain.at(-1);
        // "ERR | <date> <time> [<source>] <message>": the message.
        const last = error?.replace(/^\w+ \| \S+ \S+ \[[^\]]*\] /, '');
        super(`The engine stopped before the game started (exit code ${code})${last === undefined ? '.' : `: ${last}`}`);
        this.name = 'EngineStoppedError';
    }
}
