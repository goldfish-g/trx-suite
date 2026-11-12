// The files a converted game flow names, settled against what the game
// brings: TRX reads no game flow at all when one of its levels is missing,
// finds injections by name, and tells case apart.
import { describe, expect, it } from 'vitest';
import { settleReferences, type BaseNeed } from '../../../converter/client/src/converter/references.ts';
import type { MappedFile } from '../../../converter/client/src/converter/types.ts';

const encoder = new TextEncoder();
const mod = 'custom-refs';
const file = (path: string): MappedFile => ({ path: `games/${mod}/${path}`, data: new Uint8Array([1]) });

function settle(flow: unknown, others: string[]): { flow: any; notes: string[] } {
    const files = [{ path: `games/${mod}/gameflow.json5`, data: encoder.encode(JSON.stringify(flow)) }, ...others.map(file)];
    const notes = settleReferences(files, mod, 2);
    return { flow: JSON.parse(new TextDecoder().decode(files[0].data)), notes };
}

describe('level files', () => {
    it('makes a level the game does not bring a stand-in, keeping the numbers after it', () => {
        const { flow, notes } = settle({
            title: { path: 'title.tr2', sequence: [] },
            levels: [
                { type: 'gym', path: 'assault.tr2', sequence: [] },
                { path: 'mine.tr2', sequence: [] },
                { path: 'boat.tr2', sequence: [] },
                { path: 'other.tr2', sequence: [] },
            ],
            cutscenes: [{ path: 'cut1.tr2', sequence: [] }],
            demos: [{ path: 'keel.tr2', sequence: [] }],
        }, ['levels/mine.tr2', 'levels/Other.tr2']);
        // A title the game does not bring is the original game's where the
        // player has it, else a level of its own; a home it does not bring
        // is a stand-in, as a player need not have the original.
        expect(flow.title.path).toEqual(['title.tr2', 'mine.tr2']);
        expect(flow.levels[0]).toEqual({ type: 'dummy', sequence: [] });
        expect(flow.levels[1].path).toBe('mine.tr2');
        expect(flow.levels[2]).toEqual({ type: 'dummy', sequence: [] });
        expect(flow.levels[3].path).toBe('Other.tr2');
        expect(flow.cutscenes).toEqual([{ type: 'dummy', sequence: [] }]);
        expect(flow.demos).toBeUndefined();
        expect(notes.join(' ')).toMatch(/stand-ins/);
    });

    it('finds a level by its name alone, as TR2X named them by their path', () => {
        const { flow } = settle({ levels: [{ path: 'data/Mine.TR2', sequence: [] }] }, ['levels/mine.tr2']);
        expect(flow.levels[0].path).toBe('mine.tr2');
    });

    it('finds a TR3 cutscene where TRX looks for it, in cuts/', () => {
        const { flow } = settle({ levels: [], cutscenes: [{ path: 'cut6.tr2', sequence: [] }] }, ['cuts/cut6.tr2']);
        expect(flow.cutscenes[0].path).toBe('cut6.tr2');
    });
});

describe('injections', () => {
    it('names them as TRX finds them, and leaves out what neither the game nor TRX has', () => {
        const { flow, notes } = settle({
            injections: ['data/injections/font.bin', 'data/injections/mine.bin', 'gone.bin'],
            levels: [{ path: 'mine.tr2', sequence: [], injections: ['data/injections/winston_model.bin'] }],
        }, ['levels/mine.tr2', 'injections/Mine.bin']);
        expect(flow.injections).toEqual(['font.bin', 'Mine.bin']);
        expect(flow.levels[0].injections).toEqual(['winston_model.bin']);
        expect(notes.join(' ')).toMatch(/gone\.bin/);
    });
});

describe('pictures, videos and sound', () => {
    it('spells a name as the file is, trying the other extensions TRX tries', () => {
        const { flow } = settle({
            main_menu_picture: 'Title.png',
            sfx_path: 'MAIN.SFX',
            fmvs: [{ path: 'Ending.mp4' }],
            levels: [{ path: 'mine.tr2', sequence: [{ type: 'loading_screen', path: 'Canada.png' }, { type: 'total_stats', background_path: 'END.PCX' }] }],
        }, ['levels/mine.tr2', 'images/title.webp', 'main.sfx', 'fmv/ending.mp4', 'images/canada.png', 'images/end.png']);
        expect(flow.main_menu_picture).toBe('title.webp');
        expect(flow.sfx_path).toBe('main.sfx');
        expect(flow.fmvs[0].path).toBe('ending.mp4');
        expect(flow.levels[0].sequence[0].path).toBe('canada.png');
        expect(flow.levels[0].sequence[1].background_path).toBe('end.png');
    });
});

describe('files of the original game', () => {
    const settleFetching = (flow: unknown, others: string[]) => {
        const files = [{ path: `games/${mod}/gameflow.json5`, data: encoder.encode(JSON.stringify(flow)) }, ...others.map(file)];
        const needs: BaseNeed[] = [];
        settleReferences(files, mod, 2, { fetchBase: true, needs });
        return { flow: JSON.parse(new TextDecoder().decode(files[0].data)), needs };
    };

    it('takes from the server what the game plays and does not bring, up to the level that ends it', () => {
        const { flow, needs } = settleFetching({
            title: { path: 'title.tr2', music_track: 64, sequence: [] },
            levels: [
                { type: 'gym', path: 'assault.tr2', lara_outfit: 'level_default', sequence: [] },
                { path: 'mine.tr2', lara_outfit: 'level_default', sequence: [{ type: 'loop_game' }, { type: 'level_complete' }] },
                { path: 'data/venice.tr2', lara_outfit: 'level_default', music_track: 33, sequence: [{ type: 'play_cutscene', cutscene_id: 0 }, { type: 'total_stats' }] },
                { path: 'opera.tr2', sequence: [] },
            ],
            cutscenes: [{ path: 'cut1.tr2', sequence: [] }, { path: 'cut2.tr2', sequence: [] }],
        }, ['levels/mine.tr2']);
        const levels = needs.filter((n) => n.kind === 'level').map((n) => n.to);
        expect(levels).toEqual(['levels/title.tr2', 'levels/assault.tr2', 'levels/venice.tr2', 'levels/cut1.tr2']);
        // The original's levels wear TRX's outfits of the original.
        expect(flow.levels[0].lara_outfit).toBe('tr2_gym');
        expect(flow.levels[2]).toMatchObject({ path: 'venice.tr2', lara_outfit: 'tr2_classic' });
        // Past the end, and a cutscene nothing plays, stay stand-ins.
        expect(flow.levels[3]).toEqual({ type: 'dummy', sequence: [] });
        expect(flow.cutscenes[1]).toEqual({ type: 'dummy', sequence: [] });
        // TR2 plays every sound from its sound file.
        expect(needs).toContainEqual({ kind: 'sfx', name: 'main.sfx', to: 'main.sfx' });
        expect(flow.sfx_path).toBe('main.sfx');
        // Music: what the flow names, the original's levels play and the engine plays by itself.
        const tracks = needs.filter((n) => n.kind === 'music').map((n) => Number(n.name));
        expect(tracks).toEqual(expect.arrayContaining([33, 43]));
        // A track the original does not have is not asked for.
        expect(tracks).not.toContain(64);
        expect(needs.find((n) => n.name === '33')?.to).toBe('music/33');
    });

    it('takes nothing a game brings, and no music when it brings all it plays', () => {
        const { needs } = settleFetching({
            title: { path: 'title.tr2', music_track: 64, sequence: [] },
            sfx_path: 'MAIN.SFX',
            levels: [{ path: 'mine.tr2', music_track: 33, sequence: [] }],
        }, ['levels/mine.tr2', 'levels/title.tr2', 'main.sfx', 'music/cdaudio.wad']);
        expect(needs).toEqual([]);
    });
});
