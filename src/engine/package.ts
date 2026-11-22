// The engine's own files: TRX.data, the package Emscripten's --preload-file
// made of what TRX ships with, which the engine reads into memory whole as it
// starts, at twice its size for a moment. Most of it belongs to one game
// each: the title, loading and credits pictures of every game (270 of its
// 335 MB) and the levels of the games the engine carries. A game shows its
// own pictures and those of the game it extends, never another's.
//
// So the engine gets the package without them: every such file is there,
// empty, for the engine to find (it checks each game's files exist as it
// starts, and offers in its game switcher only the games whose files do),
// and the session fills in those of the games it plays. Switching games in
// the engine starts a new session, which fills in the new game's.
//
// The package's table of contents is in the engine's script, as the argument
// of loadPackage(). Should a build ever write it differently, the engine gets
// the package as it is.

/** The files that belong to one game, which a session fills in for the games it plays. */
const GAME_FILE = /^\/games\/([^/]+)\/(?:images|levels)\//;
const GAMEFLOW = /^\/games\/([^/]+)\/gameflow\.json5$/;
const EXTENDS = /["']?extends["']?\s*:\s*["']([^"']+)["']/;

interface PackageFile {
    filename: string;
    start: number;
    end: number;
}

interface PackageMetadata {
    files: PackageFile[];
    remote_package_size: number;
}

/** A file of the package, of one game, that the engine gets empty. */
interface GameFile {
    path: string;
    game: string;
    blob: Blob;
}

/** The part of the engine's file system filling files in uses. */
export interface FillingFs {
    /** canOwn hands the buffer over instead of copying it. */
    writeFile(path: string, data: Uint8Array, opts?: { canOwn?: boolean }): void;
}

/**
 * Finds the table of contents in the engine's script: the object literal
 * handed to the last loadPackage() call, which is JSON.
 */
export function findPackageMetadata(script: string): { from: number; to: number; metadata: PackageMetadata } | null {
    const call = script.lastIndexOf('loadPackage(');
    if (call < 0) return null;
    const from = script.indexOf('{', call);
    if (from < 0) return null;
    let depth = 0;
    let inString = false;
    for (let at = from; at < script.length; at++) {
        const char = script[at];
        if (inString) {
            if (char === '\\') at++;
            else if (char === '"') inString = false;
        } else if (char === '"') {
            inString = true;
        } else if (char === '{') {
            depth++;
        } else if (char === '}' && --depth === 0) {
            const to = at + 1;
            try {
                const metadata = JSON.parse(script.slice(from, to)) as PackageMetadata;
                return isMetadata(metadata) ? { from, to, metadata } : null;
            } catch {
                return null;
            }
        }
    }
    return null;
}

function isMetadata(value: unknown): value is PackageMetadata {
    if (value === null || typeof value !== 'object') return false;
    const { files, remote_package_size: size } = value as Partial<PackageMetadata>;
    return (
        Array.isArray(files) &&
        typeof size === 'number' &&
        files.every(
            (file) =>
                typeof file?.filename === 'string' &&
                Number.isInteger(file.start) &&
                Number.isInteger(file.end) &&
                file.start <= file.end &&
                file.end <= size,
        )
    );
}

/** The engine's package, with each game's own files left out until a session asks for them. */
export class EnginePackage {
    /** The engine's script, its table of contents listing the left-out files as empty. */
    readonly script: Blob;
    /** The package the script now describes. */
    readonly data: Blob;
    private readonly gameFiles: readonly GameFile[];
    /** The game each game the engine carries extends, from its game flow. */
    private readonly extendsOf: ReadonlyMap<string, string>;

    private constructor(script: Blob, data: Blob, gameFiles: readonly GameFile[], extendsOf: ReadonlyMap<string, string>) {
        this.script = script;
        this.data = data;
        this.gameFiles = gameFiles;
        this.extendsOf = extendsOf;
    }

    /** The package as the engine's build made it, every file in it. */
    static whole(script: Blob, data: Blob): EnginePackage {
        return new EnginePackage(script, data, [], new Map());
    }

    /**
     * Leaves each game's own files out of the package. The package as it is
     * when its table of contents cannot be read, or does not match it.
     */
    static async split(script: Blob, data: Blob): Promise<EnginePackage> {
        const text = await script.text();
        const found = findPackageMetadata(text);
        if (found === null || found.metadata.remote_package_size !== data.size) {
            console.warn('[engine] the package of this engine build could not be read; it loads whole.');
            return EnginePackage.whole(script, data);
        }
        const parts: Blob[] = [];
        const files: PackageFile[] = [];
        const gameFiles: GameFile[] = [];
        const extendsOf = new Map<string, string>();
        let offset = 0;
        for (const file of found.metadata.files) {
            const content = data.slice(file.start, file.end);
            const flow = GAMEFLOW.exec(file.filename);
            if (flow !== null) {
                const base = EXTENDS.exec(await content.text())?.[1];
                if (base !== undefined) extendsOf.set(flow[1]!, base);
            }
            const game = GAME_FILE.exec(file.filename)?.[1];
            if (game !== undefined) {
                gameFiles.push({ path: file.filename, game, blob: content });
                files.push({ ...file, start: offset, end: offset });
                continue;
            }
            parts.push(content);
            files.push({ ...file, start: offset, end: offset + content.size });
            offset += content.size;
        }
        if (gameFiles.length === 0) return EnginePackage.whole(script, data);
        const metadata = { ...found.metadata, files, remote_package_size: offset };
        return new EnginePackage(
            new Blob([text.slice(0, found.from), JSON.stringify(metadata), text.slice(found.to)], { type: script.type }),
            new Blob(parts, { type: data.type }),
            gameFiles,
            extendsOf,
        );
    }

    /** These games and every game they extend, as far as the engine's game flows tell. */
    gamesWith(games: Iterable<string>): Set<string> {
        const all = new Set<string>();
        for (let game of games) {
            while (!all.has(game)) {
                all.add(game);
                const base = this.extendsOf.get(game);
                if (base === undefined) break;
                game = base;
            }
        }
        return all;
    }

    /**
     * Fills in the left-out files of these games, and of the games they
     * extend, in the engine's file system, before the engine runs. Resolves
     * with the bytes filled in.
     */
    async fill(fs: FillingFs, games: Iterable<string>): Promise<number> {
        const wanted = this.gamesWith(games);
        let bytes = 0;
        for (const file of this.gameFiles) {
            if (!wanted.has(file.game)) continue;
            // Handed over, not copied: one copy of each file in memory.
            fs.writeFile(file.path, new Uint8Array(await file.blob.arrayBuffer()), { canOwn: true });
            bytes += file.blob.size;
        }
        return bytes;
    }
}
