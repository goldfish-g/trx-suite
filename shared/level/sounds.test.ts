// Reads the menu sounds out of the real title levels under $TRX_LEVELS_DIR
// (the games are not part of the repository): each must be a short PCM WAV.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MENU_SOUND_IDS } from '../sounds.ts';
import { readLevelSounds, soundWav } from './sounds.ts';

const dir = process.env.TRX_LEVELS_DIR;
const GAMES: { game: 'tr1' | 'tr2' | 'tr3'; title: string; sfx?: string }[] = [
    { game: 'tr1', title: 'tr1/disc/DATA/TITLE.PHD' },
    { game: 'tr2', title: 'tr2/app/data/TITLE.tr2', sfx: 'tr2/app/data/MAIN.SFX' },
    { game: 'tr3', title: 'tr3/app/DATA/TITLE.TR2', sfx: 'tr3/app/DATA/MAIN.SFX' },
];

describe('menu sounds', () => {
    for (const { game, title, sfx } of GAMES) {
        const path = dir === undefined ? null : join(dir, title);
        it.skipIf(path === null || !existsSync(path))(`come out of ${game}'s title level`, async () => {
            const sounds = await readLevelSounds(new Uint8Array(readFileSync(path!)), title);
            const mainSfx = sfx === undefined ? undefined : new Uint8Array(readFileSync(join(dir!, sfx)));
            for (const [name, id] of Object.entries(MENU_SOUND_IDS[game])) {
                const wav = soundWav(sounds, id, mainSfx);
                expect(wav, `${game} ${name}`).not.toBeNull();
                const view = new DataView(wav!.buffer, wav!.byteOffset);
                expect(String.fromCharCode(...wav!.subarray(8, 12))).toBe('WAVE');
                expect(view.getUint16(20, true), `${game} ${name} format`).toBe(1);
                const seconds = (wav!.length - 44) / view.getUint32(28, true);
                expect(seconds, `${game} ${name} length`).toBeGreaterThan(0.03);
                expect(seconds, `${game} ${name} length`).toBeLessThan(4);
            }
        });
    }
});
