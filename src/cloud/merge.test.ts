import { describe, expect, it } from 'vitest';
import type { CloudFile } from '../../shared/cloud.ts';
import { mergeSaves } from './merge';

const file = (hash: string, mtime = 1): CloudFile => ({ hash: hash.padEnd(64, '0'), size: 10, mtime });

describe('mergeSaves', () => {
    it('leaves alone what both sides agree on', () => {
        const same = { 'saves/a': file('a') };
        expect(mergeSaves(same, same, {})).toEqual({ result: same, download: [], removeLocal: [], upload: false });
    });

    it('sends a device’s new and changed saves to the cloud', () => {
        const base = { 'saves/a': file('a') };
        const merged = mergeSaves({ 'saves/a': file('a2', 5), 'saves/b': file('b') }, base, base);
        expect(merged.upload).toBe(true);
        expect(merged.result).toEqual({ 'saves/a': file('a2', 5), 'saves/b': file('b') });
        expect(merged.download).toEqual([]);
    });

    it('brings the cloud’s saves to a device that has none', () => {
        const remote = { 'saves/a': file('a'), 'saves/b': file('b') };
        const merged = mergeSaves({}, remote, {});
        expect(merged).toEqual({ result: remote, download: ['saves/a', 'saves/b'], removeLocal: [], upload: false });
    });

    it('passes deletions on both ways', () => {
        const base = { 'saves/a': file('a'), 'saves/b': file('b') };
        const merged = mergeSaves({ 'saves/b': file('b') }, { 'saves/a': file('a') }, base);
        expect(merged.result).toEqual({});
        expect(merged.removeLocal).toEqual(['saves/b']);
        expect(merged.upload).toBe(true);
    });

    it('keeps saves in different slots from two devices', () => {
        const base = { 'saves/a': file('a') };
        const merged = mergeSaves({ 'saves/a': file('a'), 'saves/b': file('b') }, { 'saves/a': file('a'), 'saves/c': file('c') }, base);
        expect(merged.result).toEqual({ 'saves/a': file('a'), 'saves/b': file('b'), 'saves/c': file('c') });
        expect(merged.download).toEqual(['saves/c']);
        expect(merged.upload).toBe(true);
    });

    it('keeps the newer of a slot both devices saved in, and a save over its deletion', () => {
        const base = { 'saves/a': file('a'), 'saves/b': file('b') };
        const newer = mergeSaves({ 'saves/a': file('mine', 10) }, { 'saves/a': file('theirs', 20) }, base);
        expect(newer.result['saves/a']).toEqual(file('theirs', 20));
        expect(newer.download).toEqual(['saves/a']);
        const mine = mergeSaves({ 'saves/a': file('mine', 30), 'saves/b': file('b2') }, { 'saves/a': file('theirs', 20) }, base);
        expect(mine.result).toEqual({ 'saves/a': file('mine', 30), 'saves/b': file('b2') });
        expect(mine.upload).toBe(true);
    });

    it('meets two devices that never synced with the union of their saves', () => {
        const merged = mergeSaves({ 'saves/a': file('a', 1), 'saves/b': file('b') }, { 'saves/a': file('a-other', 2), 'saves/c': file('c') }, {});
        expect(merged.result).toEqual({ 'saves/a': file('a-other', 2), 'saves/b': file('b'), 'saves/c': file('c') });
        expect(merged.download.sort()).toEqual(['saves/a', 'saves/c']);
        expect(merged.upload).toBe(true);
    });
});
