// Single files of the original games, which converted custom levels use
// without bringing them: served to anyone, with no sign-in, out of the
// server's archives of the games.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WAD_ENTRY_BYTES, WAD_TABLE_BYTES } from '../../shared/themes.ts';
import { makeApp, makeFixture, type Fixture } from './helpers.ts';

const bytes = (text: string) => new TextEncoder().encode(text);

/** A cdaudio.wad whose track 5 is the given WAV and every other track empty. */
function wad(track5: Uint8Array): Uint8Array {
    const out = new Uint8Array(WAD_TABLE_BYTES + track5.length);
    const view = new DataView(out.buffer);
    view.setUint32(5 * WAD_ENTRY_BYTES + 260, track5.length, true);
    view.setUint32(5 * WAD_ENTRY_BYTES + 264, WAD_TABLE_BYTES, true);
    out.set(track5, WAD_TABLE_BYTES);
    return out;
}

describe('original game files', () => {
    let fixture: Fixture;
    let app: FastifyInstance;
    const wav = bytes('RIFF....WAVEtrack five');

    beforeAll(async () => {
        fixture = await makeFixture();
        await writeFile(join(fixture.dataDir, 'games', 'tr2.zip'), zipSync({
            'games/tr2/levels/ASSAULT.TR2': bytes('the home'),
            'games/tr2/MAIN.SFX': bytes('the sounds'),
            'games/tr2/fmv/LOGO.RPL': bytes('the logo'),
            'games/tr2/music/Track60.ogg': bytes('the theme'),
        }, { level: 0 }));
        await writeFile(join(fixture.dataDir, 'games', 'tr3.zip'), zipSync({
            'games/tr3/cuts/CUT6.TR2': bytes('a cutscene'),
            'games/tr3/audio/cdaudio.wad': wad(wav),
        }, { level: 0 }));
        app = await makeApp(fixture);
    });

    afterAll(async () => {
        await app.close();
        await fixture.cleanup();
    });

    const get = (url: string) => app.inject({ method: 'GET', url });

    it('serves levels, the sound file and videos by the names game flows give them, to anyone', async () => {
        for (const [url, body, name] of [
            ['/api/original/tr2/level/assault.tr2', 'the home', 'assault.tr2'],
            ['/api/original/tr2/sfx/main.sfx', 'the sounds', 'main.sfx'],
            ['/api/original/tr2/fmv/logo.rpl', 'the logo', 'logo.rpl'],
            ['/api/original/tr3/cut/cut6.tr2', 'a cutscene', 'cut6.tr2'],
        ]) {
            const response = await get(url);
            expect(response.statusCode, url).toBe(200);
            expect(response.body).toBe(body);
            expect(response.headers['x-file-name']).toBe(name);
        }
    });

    it('serves a music track by its number, out of a file of its own or Tomb Raider III\'s cdaudio.wad', async () => {
        const ogg = await get('/api/original/tr2/music/60');
        expect(ogg.statusCode).toBe(200);
        expect(ogg.body).toBe('the theme');
        expect(ogg.headers['x-file-name']).toBe('60.ogg');
        const wad5 = await get('/api/original/tr3/music/5');
        expect(wad5.statusCode).toBe(200);
        expect(new Uint8Array(wad5.rawPayload)).toEqual(wav);
        expect(wad5.headers['x-file-name']).toBe('5.wav');
    });

    it('serves nothing it does not have, nor files of other games or kinds', async () => {
        for (const url of [
            '/api/original/tr2/level/venice.tr2',
            '/api/original/tr3/music/6',
            '/api/original/tr4/level/angkor1.tr4',
            '/api/original/tr2/image/title.png',
            '/api/original/tr2/level/..%2F..%2Fcatalog.json',
        ]) {
            expect((await get(url)).statusCode, url).toBe(404);
        }
    });
});
