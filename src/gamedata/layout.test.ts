import { describe, expect, it } from 'vitest';
import { customMod } from '../games/catalog';
import type { ArchiveEntry } from '../lib/archive';
import { LayoutError, placeGameFile, planLayout } from './layout';

function entries(paths: string[]): ArchiveEntry[] {
    return paths.map((path) => ({ path, size: 1, read: async () => new Blob(['x']) }));
}

describe('placeGameFile', () => {
    it('sorts a game folder by kind', () => {
        expect(placeGameFile('TOMBRAID/DATA/LEVEL1.PHD', 'tr1', 1)).toBe('games/tr1/levels/level1.phd');
        expect(placeGameFile('tr2/data/MAIN.SFX', 'tr2', 2)).toBe('games/tr2/main.sfx');
        expect(placeGameFile('FMV/ANCIENT.RPL', 'tr2', 2)).toBe('games/tr2/fmv/ancient.rpl');
        expect(placeGameFile('audio/cdaudio.wad', 'tr3', 3)).toBe('games/tr3/audio/cdaudio.wad');
        expect(placeGameFile('music/track05.ogg', 'tr2', 2)).toBe('games/tr2/music/track05.ogg');
        expect(placeGameFile('readme.txt', 'tr2', 2)).toBeNull();
    });

    it('keeps the audio directory TR4 reads its music from', () => {
        expect(placeGameFile('AUDIO/044_Attack_part_i.wav', 'tr4', 4)).toBe('games/tr4/audio/044_attack_part_i.wav');
        expect(placeGameFile('music/track02.wav', 'tr1', 1)).toBe('games/tr1/music/track02.wav');
        expect(placeGameFile('fmv/fmv01.bik', 'tr4', 4)).toBe('games/tr4/fmv/fmv01.bik');
    });

    it('only takes the level files of its own engine', () => {
        expect(placeGameFile('data/angkor1.tr4', 'tr2', 2)).toBeNull();
        expect(placeGameFile('data/angkor1.tr4', 'tr4', 4)).toBe('games/tr4/levels/angkor1.tr4');
    });

    it('keeps the paths of archives already laid out for the engine', () => {
        expect(placeGameFile('pack/games/tr2/levels/Wall.tr2', 'tr2', 2)).toBe('games/tr2/levels/wall.tr2');
        expect(placeGameFile('games/tr1/data/notes.txt', 'tr1', 1)).toBe('games/tr1/data/notes.txt');
    });
});

describe('planLayout', () => {
    it('refuses a game without levels', () => {
        expect(() => planLayout(entries(['music/track02.flac']), { mod: 'tr1', engine: 1, layout: 'game' })).toThrow(
            LayoutError,
        );
    });

    it('keeps a custom level around its gameflow', () => {
        const plan = planLayout(
            entries(['Pack/Level/gameflow.json5', 'Pack/Level/levels/a.tr2', 'Pack/readme.txt']),
            { mod: 'custom-x', engine: 2, layout: 'custom' },
        );
        expect(plan.map((file) => file.path)).toEqual([
            'games/custom-x/gameflow.json5',
            'games/custom-x/levels/a.tr2',
        ]);
    });

    it('keeps lone levels out of the directories the engine takes for mods', () => {
        const plan = planLayout(entries(['My Level/MyLevel.TR2', 'My Level/music/theme.ogg', 'My Level/readme.txt']), {
            mod: 'custom-mylevel',
            engine: 2,
            layout: 'level',
        });
        expect(plan.map((file) => file.path)).toEqual(['custom-levels/custom-mylevel/mylevel.tr2']);
    });

    it('refuses a custom level without a gameflow', () => {
        expect(() => planLayout(entries(['levels/a.tr2']), { mod: 'custom-x', engine: 2, layout: 'custom' })).toThrow(
            LayoutError,
        );
    });
});

describe('customMod', () => {
    it('makes a directory name from any title', () => {
        expect(customMod('The Lost Valley: Remix!')).toBe('custom-the-lost-valley-remix');
        expect(customMod('???')).toBe('custom-level');
    });
});
