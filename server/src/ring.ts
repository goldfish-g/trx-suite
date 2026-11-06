// The ring's models: for each entry of the menu's ring, an object cut out of
// a level in the game packages this server holds (shared/ring/sources.ts
// lists which). They are built once, in memory, and again when a package
// changes. Players without a game still see its object: a few hundred
// polygons and a small texture, not the game.

import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { RingManifest, RingModelFile } from '../../shared/api.ts';
import { parseLevel } from '../../shared/level/parse.ts';
import type { Level } from '../../shared/level/types.ts';
import { extractObject, type ObjectModel } from '../../shared/ring/extract.ts';
import { RING_SOURCES } from '../../shared/ring/sources.ts';
import type { Catalog } from './catalog.ts';
import { encodePng } from './png.ts';
import { listZip, readZipEntry } from './zip.ts';

export interface RingModelSet {
    manifest: RingManifest;
    /** File name under /ring/ to its JSON. */
    files: Map<string, string>;
}

function rounded(values: ArrayLike<number>, digits: number): number[] {
    const scale = 10 ** digits;
    return Array.from(values, (v) => Math.round(v * scale) / scale);
}

function toFile(model: ObjectModel, name: string): RingModelFile {
    const png = encodePng(model.atlas.width, model.atlas.height, model.atlas.pixels);
    return {
        name,
        positions: rounded(model.positions, 5),
        normals: rounded(model.normals, 3),
        uvs: rounded(model.uvs, 5),
        indices: Array.from(model.indices),
        blendStart: model.blendStart,
        texture: `data:image/png;base64,${png.toString('base64')}`,
    };
}

/** What the set depends on: the packages it reads, and when they last changed. */
async function signature(catalog: Catalog): Promise<string> {
    const parts: string[] = [];
    for (const mod of new Set(Object.values(RING_SOURCES).flatMap((sources) => sources.map((s) => s.mod)))) {
        const path = catalog.games.get(mod);
        if (path === undefined) continue;
        const stats = await stat(path).catch(() => null);
        parts.push(`${mod}:${path}:${stats?.mtimeMs ?? 'missing'}`);
    }
    return parts.join('|');
}

async function build(catalog: Catalog, log: FastifyBaseLogger): Promise<RingModelSet> {
    const manifest: RingManifest = { models: {} };
    const files = new Map<string, string>();
    const levels = new Map<string, Promise<Level | null>>();
    const levelOf = (archive: string, file: string) => {
        const key = `${archive}|${file}`;
        let level = levels.get(key);
        if (level === undefined) {
            level = (async () => {
                const entries = await listZip(archive);
                const entry = entries.find((e) => basename(e.path).toLowerCase() === file);
                if (entry === undefined) return null;
                return parseLevel(await readZipEntry(archive, entry), basename(entry.path));
            })().catch((error: unknown) => {
                log.warn(`ring models: cannot read ${file} from ${archive}: ${(error as Error).message}`);
                return null;
            });
            levels.set(key, level);
        }
        return level;
    };
    for (const [item, sources] of Object.entries(RING_SOURCES)) {
        for (const source of sources) {
            const archive = catalog.games.get(source.mod);
            if (archive === undefined) continue;
            const level = await levelOf(archive, source.level);
            const model = level === null ? null : extractObject(level, source.object);
            if (model === null) continue;
            const json = JSON.stringify(toFile(model, source.name));
            const version = createHash('sha256').update(json).digest('hex').slice(0, 12);
            const file = `${item}.${version}.json`;
            files.set(file, json);
            manifest.models[item] = { url: `/ring/${file}`, name: source.name };
            break;
        }
    }
    log.info(`ring models: ${Object.keys(manifest.models).length} of ${Object.keys(RING_SOURCES).length} built`);
    return { manifest, files };
}

/** Builds the set when first asked for, and again whenever a package it uses changes. */
export function createRingModels(log: FastifyBaseLogger): (catalog: Catalog) => Promise<RingModelSet> {
    let key: string | null = null;
    let current: Promise<RingModelSet> | null = null;
    return async (catalog) => {
        const next = await signature(catalog);
        if (current === null || next !== key) {
            key = next;
            current = build(catalog, log);
        }
        return current;
    };
}
