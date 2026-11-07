import { describe, expect, it } from 'vitest';
import type { EngineNumber } from '../games/catalog';
import type { GameDataRecord } from '../gamedata/types';
import { GameFiles, type StagedGame, type StagingFs } from './files';

function fakeFs(existing: Record<string, string> = {}) {
    const files = new Map<string, Uint8Array>(Object.entries(existing).map(([path, text]) => [path, new TextEncoder().encode(text)]));
    const fs: StagingFs = {
        mkdirTree: () => {},
        writeFile: (path, data) => void files.set(path, data),
        analyzePath: (path) => ({ exists: files.has(path) }),
    };
    const read = (path: string) => new TextDecoder().decode(files.get(path));
    return { fs, files, read };
}

function game(mod: string, engine: EngineNumber, paths: string[], layout: GameDataRecord['layout'] = 'game'): StagedGame {
    const record = { id: `id-${mod}`, mod, engine, layout } as GameDataRecord;
    return {
        record,
        files: paths.map((path) => ({ gamedataId: record.id, path, blob: new Blob([`${mod}:${path}`]) })),
    };
}

const tr4 = game('tr4', 4, ['games/tr4/levels/angkor1.tr4', 'games/tr4/fmv/Fmv12.bik']);
const tr2 = game('tr2', 2, ['games/tr2/levels/wall.tr2']);
// The engine ships The Golden Mask's levels itself.
const tr2gm = game('tr2-gm', 2, ['games/tr2-gm/levels/level1.tr2']);
const tr1 = game('tr1', 1, ['games/tr1/levels/gym.phd', 'games/tr1/music/track02.flac']);
// Unfinished Business carries Tomb Raider's music.
const tr1ub = game('tr1-ub', 1, ['games/tr1-ub/levels/egypt.phd', 'games/tr1/music/track02.flac']);

describe('GameFiles', () => {
    it('shows every game to the engine but fills in only the one played', async () => {
        const { fs, files, read } = fakeFs({ '/games/tr2-gm/levels/level1.tr2': 'shipped' });
        const staged = new GameFiles(fs, [tr4, tr2, tr2gm, tr1]);
        staged.placeStandIns();
        await staged.use('tr4');

        expect(read('/games/tr4/levels/angkor1.tr4')).toBe('tr4:games/tr4/levels/angkor1.tr4');
        expect(read('/games/tr4/fmv/Fmv12.bik')).toBe('tr4:games/tr4/fmv/Fmv12.bik');
        expect(files.get('/games/tr2/levels/wall.tr2')).toHaveLength(0);
        expect(files.get('/games/tr1/levels/gym.phd')).toHaveLength(0);
        expect(read('/games/tr2-gm/levels/level1.tr2')).toBe('shipped');
    });

    it('swaps one game for another, with the games of its engine', async () => {
        const { fs, files, read } = fakeFs({ '/games/tr2-gm/levels/level1.tr2': 'shipped' });
        const staged = new GameFiles(fs, [tr4, tr2, tr2gm, tr1]);
        staged.placeStandIns();
        await staged.use('tr4');

        const progress: number[] = [];
        await staged.use('tr2-gm', (done) => progress.push(done));
        expect(files.get('/games/tr4/levels/angkor1.tr4')).toHaveLength(0);
        expect(read('/games/tr2-gm/levels/level1.tr2')).toBe('tr2-gm:games/tr2-gm/levels/level1.tr2');
        expect(read('/games/tr2/levels/wall.tr2')).toBe('tr2:games/tr2/levels/wall.tr2');
        expect(progress.length).toBe(2);

        // Shipped files keep their contents when the game is left.
        await staged.use('tr4');
        expect(read('/games/tr2-gm/levels/level1.tr2')).toBe('tr2-gm:games/tr2-gm/levels/level1.tr2');
        expect(files.get('/games/tr2/levels/wall.tr2')).toHaveLength(0);
    });

    it('keeps a file two games share while either is played', async () => {
        const { fs, read } = fakeFs();
        const staged = new GameFiles(fs, [tr1ub, tr1, tr4]);
        staged.placeStandIns();
        await staged.use('tr1-ub');
        expect(read('/games/tr1/music/track02.flac')).toBe('tr1-ub:games/tr1/music/track02.flac');
        await staged.use('tr1');
        expect(read('/games/tr1/music/track02.flac')).toBe('tr1-ub:games/tr1/music/track02.flac');
        expect(read('/games/tr1/levels/gym.phd')).toBe('tr1:games/tr1/levels/gym.phd');
    });

    it('leaves everything as it is for a mod it does not know', async () => {
        const { fs, read } = fakeFs();
        const level = game('custom-wall', 2, ['custom-levels/custom-wall/wall.tr2'], 'level');
        const staged = new GameFiles(fs, [level, tr2]);
        staged.placeStandIns();
        await staged.use('custom-wall');
        expect(staged.gamesFor('tr2-level')).toBeNull();
        await staged.use('tr2-level');
        expect(read('/custom-levels/custom-wall/wall.tr2')).toBe('custom-wall:custom-levels/custom-wall/wall.tr2');
        expect(read('/games/tr2/levels/wall.tr2')).toBe('tr2:games/tr2/levels/wall.tr2');
    });
});
