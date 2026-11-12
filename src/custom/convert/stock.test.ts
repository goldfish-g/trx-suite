// Copies of TRX's own injections in a level package, under the names TRX
// gave them or names of the builder's: the converter leaves them out, so the
// game gets the ones the current TRX ships (its font with the touch control
// icons, for one).
import { describe, expect, it } from 'vitest';
import { detectGameVersion, processFiles } from '../../../converter/client/src/converter/gamedata.ts';
import { setupCustomGameflow } from '../../../converter/client/src/converter/gameflow.ts';
import { migrateToCurrentTRX } from '../../../converter/client/src/converter/migrate.ts';
import type { MappedFile } from '../../../converter/client/src/converter/types.ts';

const bytes = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
// TRX's sanctuary_scion.bin, as the current TRX ships it.
const SCION = bytes('VFJYSQEAAAAAAAAAhgMAAEIAAAB4nGNkYGBgAWJkmpkBAhihmAdZAMYeBaNghAJQFoDlDSEg5oSKsYFxPzAfsSGpUABiaShbBGoCKxAzIZkEALD3AUk=');
// TR1X 4.5's lara_jumping.bin, which TR1X 4.6 merged into lara_animations.bin.
const JUMPING = new Uint8Array(902);
JUMPING.set(bytes('VDFNSgMAAAAGAAAA'));
JUMPING.set([1], 104);
JUMPING.set([2, 0, 0, 0, 2, 0, 0, 0, 11, 0, 22, 0, 2, 0, 1, 0, 0, 0, 11, 0], 882);
// A TR1 level file: its version is all the converter reads here.
const LEVEL = new Uint8Array(64);
new DataView(LEVEL.buffer).setUint32(0, 0x20, true);

const encoder = new TextEncoder();
const json = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value));

async function convert(files: MappedFile[], mod: string): Promise<Map<string, Uint8Array>> {
    const version = Number(detectGameVersion(files));
    const { mapped } = processFiles(files, mod);
    const flow = await setupCustomGameflow(mapped, mod, version, false, 'Test');
    const { files: out } = await migrateToCurrentTRX(flow, { modDir: mod, gameVersion: version, upload: files });
    return new Map(out.map((file) => [file.path, file.data]));
}

function gameflow(out: Map<string, Uint8Array>, mod: string) {
    return JSON.parse(new TextDecoder().decode(out.get(`games/${mod}/gameflow.json5`)));
}

describe('copies of TRX injections', () => {
    it('are known by their contents, whatever a TR1X game named them', async () => {
        const mod = 'custom-renamed';
        const out = await convert([
            { path: 'cfg/TR1X_gameflow.json5', data: json({
                levels: [{
                    file: 'data/level1.phd', type: 'normal', music: 0, sequence: [{ type: 'loop_game' }],
                    injections: ['data/injections/my_scion.bin', 'data/injections/bin_jump.bin', 'data/injections/lara_animations.bin'],
                }],
            }) },
            { path: 'data/level1.phd', data: LEVEL },
            { path: 'data/injections/my_scion.bin', data: SCION },
            { path: 'data/injections/bin_jump.bin', data: JUMPING },
        ], mod);
        const level = gameflow(out, mod).levels[0];
        expect(level.injections).toContain('sanctuary_scion.bin');
        expect(level.injections).toContain('lara_animations.bin');
        // TRX's own animations carry the jumping.
        expect(level.injections).not.toContain('lara_jumping.bin');
        expect(level.injections).not.toContain('my_scion.bin');
        expect(level.injections).not.toContain('bin_jump.bin');
        expect([...out.keys()].filter((path) => path.includes('/injections/'))).toEqual([]);
    });

    // TRX refuses an injection that is not in its own format (inject/common.c,
    // "Invalid injection magic"), so a TR1X game's own animations cannot
    // play, and its copy would only hide the animations TRX ships.
    it('leave a TR1X game\'s own animations and jumping to TRX\'s, which it can read', async () => {
        const mod = 'custom-own-anims';
        const out = await convert([
            { path: 'cfg/TR1X_gameflow.json5', data: json({
                levels: [{
                    file: 'data/level1.phd', type: 'normal', music: 0, sequence: [{ type: 'loop_game' }],
                    injections: ['data/injections/lara_animations.bin', 'data/injections/bin_jump.bin'],
                }],
            }) },
            { path: 'data/level1.phd', data: LEVEL },
            { path: 'data/injections/lara_animations.bin', data: new Uint8Array([1, 2, 3, 4]) },
            { path: 'data/injections/bin_jump.bin', data: JUMPING },
        ], mod);
        const injections = gameflow(out, mod).levels[0].injections;
        expect(injections).toContain('lara_animations.bin');
        expect(injections).not.toContain('lara_jumping.bin');
        expect(out.has(`games/${mod}/injections/lara_jumping.bin`)).toBe(false);
        expect(out.has(`games/${mod}/injections/lara_animations.bin`)).toBe(false);
    });

    it('are known by their contents in a game made for TRX', async () => {
        const mod = 'custom-trx';
        const out = await convert([
            { path: 'gameflow.json5', data: json({
                injections: ['my_scion.bin'],
                levels: [{ path: 'level1.phd', music_track: 0, sequence: [{ type: 'loop_game' }], injections: ['my_scion.bin', 'sanctuary_scion.bin'] }],
            }) },
            { path: 'data/level1.phd', data: LEVEL },
            { path: 'injections/my_scion.bin', data: SCION },
        ], mod);
        const flow = gameflow(out, mod);
        expect(flow.injections).toContain('sanctuary_scion.bin');
        expect(flow.injections).not.toContain('my_scion.bin');
        expect(flow.levels[0].injections.filter((name: string) => name === 'sanctuary_scion.bin')).toHaveLength(1);
        expect([...out.keys()].filter((path) => path.includes('/injections/'))).toEqual([]);
    });
});
