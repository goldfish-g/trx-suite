import { afterEach, describe, expect, it, vi } from 'vitest';
import { download } from './download';

function bytes(count: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) out[i] = i % 251;
    return out;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('download', () => {
    it('takes a compressed answer whole, though its Content-Length counts the compressed bytes', async () => {
        // As Caddy answers a script: 4317 bytes on disk, 1698 compressed.
        const fetch = vi.fn(async () => new Response(bytes(4317), { headers: { 'Content-Encoding': 'zstd', 'Content-Length': '1698' } }));
        vi.stubGlobal('fetch', fetch);
        const progress: (number | null)[] = [];
        const blob = await download('/engines/1.5.0/trx-adapter.js', { onProgress: ({ total }) => progress.push(total) });
        expect(blob.size).toBe(4317);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(progress.every((total) => total === null)).toBe(true);
    });

    it('still counts on the size it was told, for a compressed answer too', async () => {
        vi.stubGlobal('fetch', async () => new Response(bytes(4317), { headers: { 'Content-Encoding': 'gzip', 'Content-Length': '1698' } }));
        const blob = await download('/engines/1.5.0/trx-adapter.js', { expectedSize: 4317 });
        expect(blob.size).toBe(4317);
    });

    it('resumes an uncompressed answer cut short, from the byte it stopped at', async () => {
        const whole = bytes(10);
        const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
            const range = new Headers(init?.headers).get('Range');
            if (range === null) return new Response(whole.slice(0, 4), { headers: { 'Content-Length': '10' } });
            expect(range).toBe('bytes=4-');
            return new Response(whole.slice(4), { status: 206, headers: { 'Content-Range': 'bytes 4-9/10', 'Content-Length': '6' } });
        });
        vi.stubGlobal('fetch', fetch);
        const blob = await download('/games/tr1.zip', { onRetry: () => {} });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(whole);
    });
});
