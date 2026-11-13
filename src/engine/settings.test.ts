import { describe, expect, it } from 'vitest';
import { firstRunLanguage, languagesIn, prepareStartSettings, startInputFor, withStartInput, withStartingSettings } from './settings';
import type { EngineFs } from './types';

// A settings file as TRX writes it: two spaces in, keys in its own order.
const WRITTEN = `{
  "config_version": 2,
  "language": "de",
  "brightness": 1.0,
  "backend": "keyboard",
  "enable_touch_controls": true,
  "keyboard_layout": 0
}`;

describe('the device a game starts with', () => {
    it('picks the prompts, and brings the touch controls for a finger alone', () => {
        expect(startInputFor('gamepad')).toEqual({ backend: 'controller', touchControls: false });
        expect(startInputFor('touch')).toEqual({ backend: 'touch', touchControls: true });
        expect(startInputFor('keyboard')).toEqual({ backend: 'keyboard', touchControls: false });
        expect(startInputFor('mouse')).toEqual({ backend: 'keyboard', touchControls: false });
    });

    it('changes those two settings and leaves every other line as the game wrote it', () => {
        const next = withStartInput(WRITTEN, startInputFor('gamepad'), null)!;
        expect(next).toBe(WRITTEN.replace('"backend": "keyboard"', '"backend": "controller"').replace('"enable_touch_controls": true', '"enable_touch_controls": false'));
        // 1.0 stays 1.0, which JSON.stringify would have made 1.
        expect(next).toContain('"brightness": 1.0,');
    });

    it('adds them to a file that lacks them', () => {
        const next = withStartInput('{\n  "language": "fr"\n}', startInputFor('touch'), null)!;
        expect(JSON.parse(next)).toEqual({ language: 'fr', backend: 'touch', enable_touch_controls: true });
    });

    it('leaves alone a file that already says so, or that does not parse', () => {
        expect(withStartInput(WRITTEN, { backend: 'keyboard', touchControls: true }, null)).toBeNull();
        expect(withStartInput('{ broken', startInputFor('gamepad'), null)).toBeNull();
    });

    it('writes a first file with the language the game would have picked on its first run', () => {
        expect(JSON.parse(withStartInput(null, startInputFor('gamepad'), 'de')!)).toEqual({ language: 'de', backend: 'controller', enable_touch_controls: false });
        expect(JSON.parse(withStartInput(null, startInputFor('keyboard'), null)!)).toEqual({ backend: 'keyboard', enable_touch_controls: false });
    });
});

describe('the language of a first run', () => {
    const available = languagesIn(['base_strings.json5', 'base_strings-de.json5', 'base_strings-en-gb.json5', 'strings-pl.json5', 'gameflow.json5', 'base_strings-de.json5']);

    it('comes in the languages the strings files are in', () => {
        expect(available.sort()).toEqual(['de', 'en', 'en-gb', 'pl']);
    });

    it('is picked as TRX picks it', () => {
        expect(firstRunLanguage(['de-DE', 'en-US'], available)).toBe('de');
        expect(firstRunLanguage(['en-GB'], available)).toBe('en-gb');
        expect(firstRunLanguage(['en-US'], available)).toBe('en');
        // A language it lacks gives way to the next one the player reads.
        expect(firstRunLanguage(['pt-BR', 'pl'], available)).toBe('pl');
        // Only a region it has: another region of the language.
        expect(firstRunLanguage(['en-AU'], ['en-gb'])).toBe('en-gb');
        expect(firstRunLanguage(['pt-BR'], available)).toBeNull();
    });
});

describe('the settings a game came with', () => {
    // The look a builder played their level with, as the converter keeps it.
    const STARTING = JSON.stringify({ texture_filter: 'point', vertex_snap_mode: '320x240', music_volume: 0.3 }, null, 2);
    const STORAGE = '/profiles/p1/custom-3952';
    const CFG = `${STORAGE}/cfg/TR3X.json5`;
    const GAME = '/games/custom-3952/starting_settings.json5';

    function memoryFs(files: Record<string, string>): EngineFs & { files: Map<string, string> } {
        const map = new Map(Object.entries(files));
        return {
            files: map,
            mkdirTree: () => {},
            writeFile: (path, data) => void map.set(path, new TextDecoder().decode(data)),
            readFile: (path) => new TextEncoder().encode(map.get(path)),
            analyzePath: (path) => ({ exists: map.has(path) || [...map.keys()].some((key) => key.startsWith(`${path}/`)) }),
            readdir: (path) => [...map.keys()].filter((key) => key.startsWith(`${path}/`)).map((key) => key.slice(path.length + 1).split('/')[0]!),
            symlink: () => {},
            unlink: (path) => void map.delete(path),
            mount: () => ({ mount: null }),
            syncfs: () => {},
        };
    }
    const prepare = (fs: EngineFs, device: 'gamepad' | 'keyboard' = 'gamepad') =>
        prepareStartSettings(fs, { storagePath: STORAGE, engine: 3, stringsDirs: ['/games/custom-3952'], startingSettingsPath: GAME, device, languages: ['de-DE'] });

    it('start a new profile, in the language the game would pick and with the starting device', () => {
        const fs = memoryFs({ [GAME]: STARTING, '/games/custom-3952/strings-de.json5': '{}' });
        prepare(fs);
        expect(JSON.parse(fs.files.get(CFG)!)).toEqual({
            language: 'de', texture_filter: 'point', vertex_snap_mode: '320x240', music_volume: 0.3,
            backend: 'controller', enable_touch_controls: false,
        });
    });

    it('go over the settings of a profile made before the level brought them, once', () => {
        const fs = memoryFs({ [GAME]: STARTING, [CFG]: WRITTEN.replace('"brightness": 1.0', '"texture_filter": "bilinear"') });
        prepare(fs, 'keyboard');
        const first = JSON.parse(fs.files.get(CFG)!);
        expect(first).toMatchObject({ language: 'de', texture_filter: 'point', vertex_snap_mode: '320x240', keyboard_layout: 0 });

        // The player turns the filter back on; their choice stays.
        fs.files.set(CFG, fs.files.get(CFG)!.replace('"point"', '"bilinear"'));
        prepare(fs, 'keyboard');
        expect(JSON.parse(fs.files.get(CFG)!).texture_filter).toBe('bilinear');
    });

    it('go over them again when the level brings other ones', () => {
        const fs = memoryFs({ [GAME]: STARTING });
        prepare(fs);
        fs.files.set(CFG, fs.files.get(CFG)!.replace('"point"', '"bilinear"'));
        fs.files.set(GAME, STARTING.replace('0.3', '0.5'));
        prepare(fs);
        expect(JSON.parse(fs.files.get(CFG)!)).toMatchObject({ texture_filter: 'point', music_volume: 0.5 });
    });

    it('leave a game without them, and a settings file that does not parse, as they were', () => {
        const without = memoryFs({});
        prepare(without);
        expect(JSON.parse(without.files.get(CFG)!)).toEqual({ backend: 'controller', enable_touch_controls: false });
        expect(without.files.has(`${STORAGE}/cfg/starting_settings.version`)).toBe(false);

        expect(withStartingSettings('{ broken', STARTING, null)).toBeNull();
        const broken = memoryFs({ [GAME]: STARTING, [CFG]: '{ broken' });
        prepare(broken);
        expect(broken.files.get(CFG)).toBe('{ broken');
    });
});
