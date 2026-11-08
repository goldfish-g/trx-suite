// The sounds of the games' own menus, for the app's menus in each game's
// look: read out of each game's title level (and MAIN.SFX, for II and III)
// in its archive, once, like the ring's objects. Each file's name carries a
// hash of it, so browsers keep it for good.

import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { MenuSoundsManifest } from '../../shared/api.ts';
import { readLevelSounds, soundWav } from '../../shared/level/sounds.ts';
import { MENU_SOUND_IDS, MENU_SOUND_SOURCES } from '../../shared/sounds.ts';
import type { Catalog } from './catalog.ts';
import { listZip, readZipEntry } from './zip.ts';

export interface MenuSoundSet {
    manifest: MenuSoundsManifest;
    /** File name under /sfx/ to its WAV bytes. */
    files: Map<string, Uint8Array>;
}

type Look = keyof typeof MENU_SOUND_IDS;

async function signature(catalog: Catalog): Promise<string> {
    const parts: string[] = [];
    for (const mod of Object.values(MENU_SOUND_SOURCES).flat()) {
        const path = catalog.games.get(mod);
        if (path === undefined) continue;
        const stats = await stat(path).catch(() => null);
        parts.push(`${mod}:${path}:${stats?.mtimeMs ?? 'missing'}`);
    }
    return parts.join('|');
}

/** The menu sounds of one game, from the first of its archives (its own, or an expansion's) that has them. */
async function lookSounds(catalog: Catalog, look: Look, log: FastifyBaseLogger): Promise<Map<string, Uint8Array> | null> {
    for (const mod of MENU_SOUND_SOURCES[look]) {
        const archive = catalog.games.get(mod);
        if (archive === undefined) continue;
        try {
            const entries = await listZip(archive);
            const title = entries.find((entry) => /(^|\/)levels\/title\.(phd|tr2)$/i.test(entry.path));
            const main = entries.find((entry) => /(^|\/)main\.sfx$/i.test(entry.path));
            if (title === undefined || (look !== 'tr1' && main === undefined)) continue;
            const sounds = await readLevelSounds(await readZipEntry(archive, title), title.path);
            const mainSfx = main === undefined ? undefined : await readZipEntry(archive, main);
            const files = new Map<string, Uint8Array>();
            for (const [name, id] of Object.entries(MENU_SOUND_IDS[look])) {
                const wav = soundWav(sounds, id, mainSfx);
                if (wav !== null) files.set(name, wav);
            }
            if (files.size > 0) return files;
        } catch (error) {
            log.warn(`menu sounds: ${mod}: ${(error as Error).message}`);
        }
    }
    return null;
}

async function build(catalog: Catalog, log: FastifyBaseLogger): Promise<MenuSoundSet> {
    const manifest: MenuSoundsManifest = { looks: {} };
    const files = new Map<string, Uint8Array>();
    for (const look of Object.keys(MENU_SOUND_IDS) as Look[]) {
        const sounds = await lookSounds(catalog, look, log);
        if (sounds === null) continue;
        const urls: Record<string, string> = {};
        for (const [name, wav] of sounds) {
            const file = `${look}-${name}.${createHash('sha1').update(wav).digest('hex').slice(0, 12)}.wav`;
            files.set(file, wav);
            urls[name] = `/sfx/${file}`;
        }
        manifest.looks[look] = urls;
    }
    log.info(`menu sounds: ${Object.keys(manifest.looks).join(', ') || 'none'}`);
    return { manifest, files };
}

export function createMenuSounds(log: FastifyBaseLogger): (catalog: Catalog) => Promise<MenuSoundSet> {
    let key: string | null = null;
    let current: Promise<MenuSoundSet> | null = null;
    return async (catalog) => {
        const next = await signature(catalog);
        if (current === null || next !== key) {
            key = next;
            current = build(catalog, log);
        }
        return current;
    };
}
