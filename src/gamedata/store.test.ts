import { describe, expect, it } from 'vitest';
import { DamagedGameDataError, readGameDataFile } from './store';
import type { GameDataFile } from './types';

/** A Blob that claims one size and reads back as another, as Safari's stored slices do. */
function misreadBlob(size: number, read: number): Blob {
    return { size, type: '', arrayBuffer: async () => new ArrayBuffer(read) } as unknown as Blob;
}

describe('readGameDataFile', () => {
    it('reads a stored file whole', async () => {
        const file: GameDataFile = { gamedataId: 'g', path: 'games/tr1/levels/gym.phd', blob: new Blob(['level bytes']) };
        expect(new TextDecoder().decode(await readGameDataFile(file))).toBe('level bytes');
    });

    it('names the game data of a file that reads back as more than it holds', async () => {
        const file: GameDataFile = { gamedataId: 'ub', path: 'games/tr1-ub/levels/cat.phd', blob: misreadBlob(3270738, 12353536) };
        const error = await readGameDataFile(file).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(DamagedGameDataError);
        expect((error as DamagedGameDataError).gamedataId).toBe('ub');
        expect((error as Error).message).toContain('cat.phd');
    });
});
