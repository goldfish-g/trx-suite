import { describe, expect, it } from 'vitest';
import type { CloudFile } from '../../shared/cloud.ts';
import { mergeSaves } from './merge';

const file = (hash: string, mtime = 1): CloudFile => ({ hash: hash.padEnd(64, '0'), size: 10, mtime });

describe('mergeSaves', () => {
    it('leaves alone what both sides agree on', () => {
        const same = { 'saves/tr2/a': file('a') };
        expect(mergeSaves(same, same, {})).toEqual({ result: same, download: [], removeLocal: [], upload: false });
    });

    it('sends a device’s new and changed saves to the cloud', () => {
        const base = { 'saves/tr2/a': file('a') };
        const merged = mergeSaves({ 'saves/tr2/a': file('a2', 5), 'saves/tr2/b': file('b') }, base, base);
        expect(merged.upload).toBe(true);
        expect(merged.result).toEqual({ 'saves/tr2/a': file('a2', 5), 'saves/tr2/b': file('b') });
        expect(merged.download).toEqual([]);
    });

    it('brings the cloud’s saves to a device that has none', () => {
        const remote = { 'saves/tr2/a': file('a'), 'saves/tr2/b': file('b') };
        const merged = mergeSaves({}, remote, {});
        expect(merged).toEqual({ result: remote, download: ['saves/tr2/a', 'saves/tr2/b'], removeLocal: [], upload: false });
    });

    it('passes deletions on both ways', () => {
        const base = { 'saves/tr2/a': file('a'), 'saves/tr2/b': file('b') };
        const merged = mergeSaves({ 'saves/tr2/b': file('b') }, { 'saves/tr2/a': file('a') }, base);
        expect(merged.result).toEqual({});
        expect(merged.removeLocal).toEqual(['saves/tr2/b']);
        expect(merged.upload).toBe(true);
    });

    it('keeps saves in different slots from two devices', () => {
        const base = { 'saves/tr2/a': file('a') };
        const merged = mergeSaves({ 'saves/tr2/a': file('a'), 'saves/tr2/b': file('b') }, { 'saves/tr2/a': file('a'), 'saves/tr2/c': file('c') }, base);
        expect(merged.result).toEqual({ 'saves/tr2/a': file('a'), 'saves/tr2/b': file('b'), 'saves/tr2/c': file('c') });
        expect(merged.download).toEqual(['saves/tr2/c']);
        expect(merged.upload).toBe(true);
    });

    it('keeps the newer of a slot both devices saved in, and a save over its deletion', () => {
        const base = { 'saves/tr2/a': file('a'), 'saves/tr2/b': file('b') };
        const newer = mergeSaves({ 'saves/tr2/a': file('mine', 10) }, { 'saves/tr2/a': file('theirs', 20) }, base);
        expect(newer.result['saves/tr2/a']).toEqual(file('theirs', 20));
        expect(newer.download).toEqual(['saves/tr2/a']);
        const mine = mergeSaves({ 'saves/tr2/a': file('mine', 30), 'saves/tr2/b': file('b2') }, { 'saves/tr2/a': file('theirs', 20) }, base);
        expect(mine.result).toEqual({ 'saves/tr2/a': file('mine', 30), 'saves/tr2/b': file('b2') });
        expect(mine.upload).toBe(true);
    });

    it('meets two devices that never synced with the union of their saves', () => {
        const merged = mergeSaves({ 'saves/tr2/a': file('a', 1), 'saves/tr2/b': file('b') }, { 'saves/tr2/a': file('a-other', 2), 'saves/tr2/c': file('c') }, {});
        expect(merged.result).toEqual({ 'saves/tr2/a': file('a-other', 2), 'saves/tr2/b': file('b'), 'saves/tr2/c': file('c') });
        expect(merged.download.sort()).toEqual(['saves/tr2/a', 'saves/tr2/c']);
        expect(merged.upload).toBe(true);
    });
});
