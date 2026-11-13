// What a game's archive carries beside the game itself, in the engine's cfg/:
// the settings the engine wrote while the builder played, which the game's
// look can rest on (Temple of Orca's PS1 look), the outfits file the game's
// outfit objects are laid out by, the builder's settings presets, and the
// engine's own strings as the builder edited them.
import { describe, expect, it } from 'vitest';
import { detectGameVersion, processFiles } from '../../../converter/client/src/converter/gamedata.ts';
import { setupCustomGameflow } from '../../../converter/client/src/converter/gameflow.ts';
import { STOCK_BLOBS } from '../../../converter/client/src/converter/history.generated.ts';
import { migrateToCurrentTRX } from '../../../converter/client/src/converter/migrate.ts';
import { startingSettings } from '../../../converter/client/src/converter/settings.ts';
import type { MappedFile } from '../../../converter/client/src/converter/types.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const json = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value, null, 2));

// A TR3 level file: its version is all the converter reads here.
const TR3_LEVEL = new Uint8Array(64);
new DataView(TR3_LEVEL.buffer).setUint32(0, 0xff180038, true);

// A Windows executable, as far as its version resource goes.
function executable(version: string): Uint8Array {
    const utf16 = (text: string) => Uint8Array.from([...text].flatMap((c) => [c.charCodeAt(0), 0]));
    return Uint8Array.from([0x4d, 0x5a, 0, 0, ...utf16('ProductVersion\0'), 0, 0, ...utf16(version), 0, 0, 0, 0]);
}

async function convert(files: MappedFile[], mod: string) {
    const version = Number(detectGameVersion(files));
    const { mapped } = processFiles(files, mod);
    const flow = await setupCustomGameflow(mapped, mod, version, false, 'Test');
    const { files: out, notes } = await migrateToCurrentTRX(flow, { modDir: mod, gameVersion: version, upload: files });
    const byPath = new Map(out.map((file) => [file.path, file.data]));
    const read = (name: string) => {
        const data = byPath.get(`games/${mod}/${name}`);
        return data === undefined ? undefined : decoder.decode(data);
    };
    return { notes, read };
}

// The settings TRX 1.10 wrote for a builder who played with a PS1 look.
const BUILDER_SETTINGS = {
    texture_filter: 'point',
    vertex_snap_mode: '320x240',
    enable_affine_mapping: true,
    upscaling_factor: 3,
    menu_style: 'ps1',
    enable_braid: true,
    lara_outfit: 'tr3_gym',
    language: 'en',
    backend: 'controller',
    is_fullscreen: true,
    width: 1280,
    fs_width: 1920,
    keyboard_layout: 0,
    input: { keyboard: {}, controller: {}, touch: {} },
    assault_stats: { entries: [], total_attempts: 0 },
    enable_fps_counter: true,
};

// A game laid out as a whole TRX 1.10 is, as Temple of Orca's archive is:
// TRX.exe and cfg/ above games/tr3/, which holds the game and its audio.
function wholeTRX(extra: MappedFile[] = []): MappedFile[] {
    return [
        { path: 'CAC/TRX.exe', data: executable('TRX 1.10.2-304-g1f5f941') },
        { path: 'CAC/cfg/TR3X.json5', data: json(BUILDER_SETTINGS) },
        { path: 'CAC/cfg/TR2X.json5', data: json({ texture_filter: 'bilinear' }) },
        { path: 'CAC/games/tr3/gameflow.json5', data: json({
            title: { path: 'title.tr2', sequence: [{ type: 'exit_to_title' }] },
            injections: ['lara_outfits.bin'],
            levels: [{ path: 'antarc.tr2', lara_outfit: 'tr3_antarctica_beta', sequence: [{ type: 'loop_game' }] }],
        }) },
        { path: 'CAC/games/tr3/levels/title.tr2', data: TR3_LEVEL },
        { path: 'CAC/games/tr3/levels/antarc.tr2', data: TR3_LEVEL },
        { path: 'CAC/games/tr3/audio/cdaudio.wad', data: new Uint8Array(16) },
        ...extra,
    ];
}

describe('the settings a game came with', () => {
    it('are kept for its players to start from, from the engine cfg/ above the game', async () => {
        const { read, notes } = await convert(wholeTRX(), 'custom-look');
        const settings = JSON.parse(read('starting_settings.json5')!);
        expect(settings).toEqual({
            texture_filter: 'point',
            vertex_snap_mode: '320x240',
            enable_affine_mapping: true,
            upscaling_factor: 3,
            menu_style: 'ps1',
            braid_status: 'on',
        });
        expect(notes.join('\n')).toContain('cfg/TR3X.json5');
    });

    it("leave out the builder's machine, controls, language, records and outfit", () => {
        expect(startingSettings(JSON.stringify({ layout_1: [], cntlr_layout_2: [], touch_opacity: 0.5, x: 3, fov: 80 }))).toEqual({ fov: 80 });
        expect(startingSettings(JSON.stringify({ language: 'de', width: 640 }))).toBeNull();
        expect(startingSettings('{ broken')).toBeNull();
    });

    it("come from Tomb1Main's commented file, under the names TRX knows them by now", () => {
        const text = '{\n    // Enables the cutscenes.\n    "enable_cine": false,\n    "enable_braid": false,\n    "fov_value": 65,\n}';
        expect(startingSettings(text)).toEqual({ enable_cutscenes: false, braid_status: 'off', fov_value: 65 });
    });

    it('are left alone where a game has none', async () => {
        const { read } = await convert(wholeTRX().filter((f) => !f.path.endsWith('TR3X.json5')), 'custom-nolook');
        expect(read('starting_settings.json5')).toBeUndefined();
    });
});

describe('the outfits a game is laid out by', () => {
    // TRX 1.12 moved every gun four places on in the outfit objects; the
    // file TRX 1.10.2-304-g1f5f941 shipped still has them where it had.
    const OWN_OUTFITS = {
        outfits: {
            tr3_antarctica_beta: { name_gs: 'dynamic/enums/lara_outfit/tr3_antarctica_beta', mesh_object: 'O_LARA_SKIN_SWAP_21', gun_map: 0 },
        },
        gun_maps: [{ LGT_PISTOLS: { hand_r: 45, hand_l: 46, thigh_r: 3, thigh_l: 4 } }],
    };

    it('stay the game\'s own where it brings outfit objects of its own', async () => {
        const { read, notes } = await convert(wholeTRX([
            { path: 'CAC/cfg/outfits.json5', data: json(OWN_OUTFITS) },
            { path: 'CAC/games/tr3/injections/lara_outfits.bin', data: encoder.encode('TRXJ the builder\'s own objects') },
        ]), 'custom-ownobjects');
        const outfits = JSON.parse(read('outfits.json5')!);
        expect(outfits.gun_maps[0].pistols).toEqual({ hand_r: 45, hand_l: 46, thigh_r: 3, thigh_l: 4 });
        expect(outfits.outfits.tr3_antarctica_beta.mesh_object).toBe('lara_skin_swap_21');
        expect(notes.join('\n')).toContain('outfit objects of its own');
    });

    it("know TRX's own files from the development builds builders play too", () => {
        // lara_outfits.bin and outfits.json5 as TRX 1.10.2-304-g1f5f941 had them,
        // which no release did.
        expect(STOCK_BLOBS['lara_outfits.bin']).toContain('0654150e165e95f9');
        expect(STOCK_BLOBS['outfits.json5']).toContain('02f456767b1f9876');
    });
});

describe("the engine's own strings a builder edited", () => {
    const BASE_STRINGS = {
        dynamic: { config_presets: { tr3_pc: 'TR3 PC', tr3_ps1: 'True PS1', my_look: 'My Look' } },
        objects: { key_item_1: { name: 'Secret Passage Key' }, key_item_2: { name: 'Rusty Key' }, puzzle_item_1: { name: 'Puzzle Item 1' } },
    };
    const GAME_STRINGS = { objects: { key_item_2: { name: 'Gate Key' } }, levels: [{ title: 'Antarctica' }] };

    it("go into the game's strings, where its own say nothing else", async () => {
        const { read, notes } = await convert(wholeTRX([
            { path: 'CAC/cfg/base_strings.json5', data: json(BASE_STRINGS) },
            { path: 'CAC/cfg/base_strings-fr.json5', data: json({ objects: { key_item_1: { name: 'Clé du passage' } } }) },
            { path: 'CAC/games/tr3/strings.json5', data: json(GAME_STRINGS) },
        ]), 'custom-strings');
        const strings = JSON.parse(read('strings.json5')!);
        expect(strings.objects.key_item_1.name).toBe('Secret Passage Key');
        expect(strings.dynamic.config_presets).toEqual({ tr3_ps1: 'True PS1' });
        // The game's own name wins, as it did over the engine's on the builder's TRX.
        expect(strings.objects.key_item_2.name).toBe('Gate Key');
        // Texts some TRX shipped, and strings no TRX has now, stay out.
        expect(strings.objects.puzzle_item_1).toBeUndefined();
        expect(strings.levels).toEqual([{ title: 'Antarctica' }]);
        expect(JSON.parse(read('strings-fr.json5')!).objects.key_item_1.name).toBe('Clé du passage');
        expect(notes.join('\n')).toContain('"Secret Passage Key"');
    });
});

describe('the settings presets a game came with', () => {
    const preset = (name: string, config: Record<string, unknown>) => json({ name_gs: `dynamic/config_presets/${name}`, config });

    it("replace TRX's when the builder made them their own, named as the builder named them", async () => {
        const { read, notes } = await convert(wholeTRX([
            { path: 'CAC/cfg/presets/tr3-pc.json5', data: preset('tr3_pc', { texture_filter: 'point', enable_vertex_snap: true }) },
            { path: 'CAC/cfg/presets/my-look.json5', data: preset('my_look', { upscaling_factor: 3 }) },
            { path: 'CAC/cfg/base_strings.json5', data: json({ dynamic: { config_presets: { tr3_pc: 'True PS1', my_look: 'My Look' } } }) },
        ]), 'custom-presets');
        expect(JSON.parse(read('presets/tr3-pc.json5')!)).toEqual({
            name_gs: 'dynamic/config_presets/tr3_pc',
            config: { texture_filter: 'point', vertex_snap_mode: '320x240' },
        });
        expect(JSON.parse(read('presets/my-look.json5')!).config).toEqual({ upscaling_factor: 3 });
        expect(JSON.parse(read('strings.json5')!).dynamic.config_presets).toEqual({ tr3_pc: 'True PS1', my_look: 'My Look' });
        expect(notes.join('\n')).toContain('Kept the 2 settings presets');
    });

    it('stay out where an archive has none', async () => {
        const { read } = await convert(wholeTRX(), 'custom-nopresets');
        expect(read('presets/tr3-pc.json5')).toBeUndefined();
    });
});
