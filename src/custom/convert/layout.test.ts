// Games made for TR1X 4.14, TR2X 1.4 and TRX up to 1.4 kept their game flow
// and strings in cfg/<game>/, and TRX's catalogs beside them in cfg/; since
// TRX 1.5 a game keeps them in a directory of its own. The converter moves
// them there and names the files they list the way TRX looks them up now.
// Settings a game enforces by an older name take their current one.
import { describe, expect, it } from 'vitest';
import { detectGameVersion, processFiles } from '../../../converter/client/src/converter/gamedata.ts';
import { setupCustomGameflow } from '../../../converter/client/src/converter/gameflow.ts';
import { migrateToCurrentTRX } from '../../../converter/client/src/converter/migrate.ts';
import type { MappedFile } from '../../../converter/client/src/converter/types.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const json = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value));

// Level files: their version is all the converter reads here.
function level(version: number): Uint8Array {
    const data = new Uint8Array(64);
    new DataView(data.buffer).setUint32(0, version, true);
    return data;
}
const TR1_LEVEL = level(0x20);
const TR2_LEVEL = level(0x2d);

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
    return { byPath, notes, read, gameflow: JSON.parse(read('gameflow.json5') ?? 'null') };
}

// A TR2 game laid out for TRX 1.0, as the Advent Calendar 2025's "A (Not So)
// Peaceful Christmas" is, made with a TRX built before 1.0.
function trx10Game(exe: string, extra: Record<string, unknown> = {}): MappedFile[] {
    return [
        { path: 'Game/TRX.exe', data: executable(exe) },
        { path: 'Game/cfg/tr2/gameflow.json5', data: json({
            main_menu_picture: 'data/images/Title.png',
            savegame_fmt_legacy: 'savegame.%d',
            demo_delay: 9999,
            secret_track: 43,
            enforced_config: { enable_braid: true, enable_game_modes: false, enable_loading_screens: true },
            hidden_config: ['enable_braid', 'enable_game_modes', 'enable_cheats'],
            title: { path: 'data/Title.tr2', music_track: 42, sequence: [{ type: 'exit_to_title' }] },
            sfx_path: 'data/main.sfx',
            injections: ['data/injections/pda_model.bin'],
            levels: [{
                path: 'data/Croft_Manor.tr2',
                music_track: 44,
                sequence: [
                    { type: 'loading_screen', path: 'data/images/Croft Manor.png' },
                    { type: 'loop_game' },
                    { type: 'level_stats' },
                ],
                ...extra,
            }],
            fmvs: [{ path: 'data/PSX_Start.avi', legal: true }],
        }) },
        { path: 'Game/cfg/tr2/strings.json5', data: json({ levels: [{ title: 'Croft Manor' }] }) },
        { path: 'Game/cfg/tr1-level/gameflow.json5', data: json({ levels: [] }) },
        { path: 'Game/data/Title.tr2', data: TR2_LEVEL },
        { path: 'Game/data/Croft_Manor.tr2', data: TR2_LEVEL },
        { path: 'Game/data/images/title.png', data: new Uint8Array([1]) },
        { path: 'Game/data/images/Croft Manor.png', data: new Uint8Array([1]) },
        { path: 'Game/data/main.sfx', data: new Uint8Array([1]) },
        { path: 'Game/music/42.mp3', data: new Uint8Array([1]) },
    ];
}

describe('a game made for TRX 1.0 to 1.4', () => {
    it('keeps its own game flow, title and music, with its files named as TRX looks them up', async () => {
        const mod = 'custom-trx10';
        const { gameflow, read, notes } = await convert(trx10Game('TRX 0.0-18-g3cde9d3'), mod);
        expect(gameflow.title).toMatchObject({ path: 'title.tr2', music_track: 42 });
        // The picture is title.png, which the game named Title.png.
        expect(gameflow.main_menu_picture).toBe('title.png');
        expect(gameflow.sfx_path).toBe('main.sfx');
        expect(gameflow.levels).toHaveLength(1);
        expect(gameflow.levels[0].path).toBe('croft_manor.tr2');
        expect(gameflow.levels[0].music_track).toBe(44);
        expect(gameflow.levels[0].sequence[0]).toMatchObject({ type: 'loading_screen', path: 'croft manor.png' });
        expect(gameflow.fmvs).toEqual([{ path: 'psx_start.avi', legal: true }]);
        expect(gameflow.extends).toBe('tr2');
        // What TRX 1.0 dropped, and the settings it made the player's.
        expect(gameflow.savegame_fmt_legacy).toBeUndefined();
        expect(gameflow.secret_track).toBeUndefined();
        expect(gameflow.demo_delay).toBeUndefined();
        expect(gameflow.enforced_config.demo_delay).toBe(9999);
        expect(JSON.parse(read('strings.json5')!).levels[0].title).toBe('Croft Manor');
        expect(notes.join('\n')).toContain('Made for TRX 1.0 (TRX 0.0-18-g3cde9d3)');
    });

    it('dresses Lara in what her levels carry before TRX 1.2 had outfits', async () => {
        const mod = 'custom-trx10-outfit';
        const { gameflow, read } = await convert(trx10Game('TRX 1.0.3'), mod);
        expect(gameflow.levels[0].lara_outfit).toBe('level_default');
        expect(JSON.parse(read('outfits.json5')!).outfits.level_default).toBeDefined();
        // TRX's own Winston, which would take the place of the level's, is not injected.
        expect(gameflow.injections).not.toContain('winston_model.bin');
    });

    it('keeps the outfits a game made for TRX 1.2 or later gave', async () => {
        const mod = 'custom-trx13';
        const { gameflow, notes } = await convert(trx10Game('TRX 1.3.1', { lara_outfit: 'tr2_classic' }), mod);
        expect(gameflow.levels[0].lara_outfit).toBe('tr2_classic');
        expect(notes.join('\n')).toContain('Made for TRX 1.3');
    });

    it('enforces its settings by their current names', async () => {
        const { gameflow } = await convert(trx10Game('TRX 1.0'), 'custom-settings');
        expect(gameflow.enforced_config).toMatchObject({ braid_status: 'on', game_modes_policy: 'never', loading_screens: 'always' });
        expect(gameflow.enforced_config.enable_braid).toBeUndefined();
        expect(gameflow.enforced_config.enable_loading_screens).toBeUndefined();
        expect(gameflow.hidden_config).toEqual(['braid_status', 'game_modes_policy', 'enable_cheats']);
    });
});

describe('a TR1X game', () => {
    const legacyLevel = (file: string) => ({ file, type: 'normal', music: 0, sequence: [{ type: 'loop_game' }] });

    it('takes the game flow of cfg/tr1/ that TR1X 4.14 and later read, over an older one and the lone-level game beside it', async () => {
        const mod = 'custom-tr1x415';
        const { gameflow } = await convert([
            { path: 'TR1X.exe', data: executable('TR1X 4.15.1-228-b2a47285e') },
            { path: 'cfg/TR1X_gameflow.json5', data: json({ levels: [legacyLevel('data/old.phd')] }) },
            { path: 'cfg/tr1/gameflow.json5', data: json({ levels: [legacyLevel('data/new.phd')] }) },
            { path: 'cfg/tr1/strings.json5', data: json({ levels: [{ title: 'The New One' }] }) },
            { path: 'cfg/tr1-level/gameflow.json5', data: json({ levels: [{ path: 'data/level.phd', type: 'normal' }] }) },
            { path: 'data/old.phd', data: TR1_LEVEL },
            { path: 'data/new.phd', data: TR1_LEVEL },
        ], mod);
        expect(gameflow.levels.map((l: { path: string }) => l.path)).toEqual(['new.phd']);
        expect(gameflow.levels[0].lara_outfit).toBe('level_default');
    });

    it('starts with the loading screens its game flow turned on', async () => {
        const { gameflow } = await convert([
            { path: 'cfg/TR1X_gameflow.json5', data: json({
                enforced_config: { enable_loading_screens: true, enable_enhanced_look: true, revert_to_pistols: true },
                levels: [legacyLevel('data/level1.phd')],
            }) },
            { path: 'data/level1.phd', data: TR1_LEVEL },
        ], 'custom-tr1x-loading');
        expect(gameflow.enforced_config).toMatchObject({ loading_screens: 'always', look_mode: 'unrestricted', remember_gun_status: false });
    });
});

describe('a TR2X game', () => {
    it('keeps the monks on Lara\'s side, as tomb2.exe and TR2X had them', async () => {
        const { read } = await convert([
            { path: 'cfg/TR2X_gameflow.json5', data: json({
                levels: [{ path: 'data/monastry.tr2', type: 'normal', music_track: 0, sequence: [{ type: 'loop_game' }] }],
            }) },
            { path: 'data/monastry.tr2', data: TR2_LEVEL },
        ], 'custom-tr2x');
        expect(read('scripts/_game.lua')).toContain('"monk_1"');
    });
});
