// Single files of the original games, for custom levels converted to TRX
// that use them without bringing them: Lara's home and the title level, the
// stock levels and cutscenes a game plays, the sound file, videos and music
// tracks (src/gamedata/imports.ts asks for what the converter lists). They
// are served to everyone who installs such a level, owner of the game or
// not, so its custom levels play without the original.

import type { FastifyInstance } from 'fastify';
import { WAD_TABLE_BYTES, findThemeFile, wadEntry } from '../../shared/themes.ts';
import type { Context } from './app.ts';
import type { Catalog } from './catalog.ts';
import { notFound } from './errors.ts';
import { statFile } from './files.ts';
import { listZip, readZipEntry, readZipRange, type ZipEntry } from './zip.ts';

/** The original games custom levels may take files from. */
const GAMES = new Set(['tr1', 'tr2', 'tr3']);
const KINDS = new Set(['level', 'cut', 'sfx', 'fmv', 'music']);

export interface OriginalFile {
    /** The name the game gives the file, with its extension. */
    name: string;
    read(): Promise<Uint8Array>;
}

const listings = new Map<string, { stamp: string; entries: ZipEntry[] }>();

async function entriesOf(archive: string): Promise<ZipEntry[] | null> {
    const stats = await statFile(archive);
    if (stats === null) return null;
    const stamp = `${stats.size}:${stats.mtimeMs}`;
    const cached = listings.get(archive);
    if (cached?.stamp === stamp) return cached.entries;
    const entries = await listZip(archive);
    listings.set(archive, { stamp, entries });
    return entries;
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).toLowerCase();

/** One file of an original game the server holds, or null. */
export async function findOriginalFile(catalog: Catalog, game: string, kind: string, name: string): Promise<OriginalFile | null> {
    const archive = catalog.games.get(game);
    if (archive === undefined || !GAMES.has(game) || !KINDS.has(kind) || !/^[\w.\- ]{1,64}$/.test(name)) return null;
    const entries = await entriesOf(archive);
    if (entries === null) return null;
    const lower = name.toLowerCase();
    const inGame = entries.filter((entry) => entry.path.toLowerCase().startsWith(`games/${game}/`));

    if (kind === 'music') {
        const track = Number(name);
        if (!Number.isInteger(track) || track < 0) return null;
        const file = findThemeFile(inGame.map((entry) => entry.path), track);
        const entry = file === null ? undefined : inGame.find((candidate) => candidate.path === file.path);
        if (file === null || entry === undefined) return null;
        if (file.wadEntry === undefined) {
            const extension = baseName(entry.path).replace(/^[^.]*/, '');
            return { name: `${track}${extension}`, read: () => readZipEntry(archive, entry) };
        }
        // A track of Tomb Raider III's cdaudio.wad, a WAV file of its own.
        const range = wadEntry(await readZipRange(archive, entry, 0, WAD_TABLE_BYTES), file.wadEntry);
        if (range === null || range.size === 0) return null;
        return { name: `${track}.wav`, read: () => readZipRange(archive, entry, range.offset, range.size) };
    }

    const dir = { level: 'levels', cut: 'cuts', sfx: '', fmv: 'fmv' }[kind as 'level' | 'cut' | 'sfx' | 'fmv'];
    const wanted = kind === 'sfx' ? `games/${game}/main.sfx` : `games/${game}/${dir}/${lower}`;
    const entry = inGame.find((candidate) => candidate.path.toLowerCase() === wanted);
    if (entry === undefined) return null;
    return { name: baseName(entry.path), read: () => readZipEntry(archive, entry) };
}

export function registerOriginalRoutes(app: FastifyInstance, context: Context): void {
    app.get<{ Params: { game: string; kind: string; name: string } }>('/api/original/:game/:kind/:name', async (request, reply) => {
        const { game, kind, name } = request.params;
        const file = await findOriginalFile(await context.loadCatalog(), game, kind, name);
        if (file === null) throw notFound('This server does not have that file of the original game.');
        const data = await file.read();
        return reply
            .header('cache-control', 'public, max-age=86400')
            .header('x-file-name', file.name)
            .header('access-control-expose-headers', 'x-file-name')
            .type('application/octet-stream')
            .send(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    });
}
