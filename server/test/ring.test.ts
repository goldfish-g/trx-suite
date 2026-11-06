// The ring's models and what they are made with: the zip reader, the PNG
// writer, and the routes. Real levels are not part of the repository, so the
// routes are checked against packages that hold none.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateRawSync, inflateSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RingManifest } from '../../shared/api.ts';
import { encodePng } from '../src/png.ts';
import { listZip, readZipEntry } from '../src/zip.ts';
import { makeApp, makeFixture, type Fixture } from './helpers.ts';

let fixture: Fixture;
let app: FastifyInstance;

beforeAll(async () => {
    fixture = await makeFixture();
    app = await makeApp(fixture);
});

afterAll(async () => {
    await app.close();
    await fixture.cleanup();
});

/** A zip of the given files, the first stored and the rest deflated. */
function makeZip(files: { name: string; data: Buffer }[]): Buffer {
    const parts: Buffer[] = [];
    const directory: Buffer[] = [];
    let offset = 0;
    files.forEach((file, index) => {
        const name = Buffer.from(file.name);
        const deflate = index > 0;
        const body = deflate ? deflateRawSync(file.data) : file.data;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(deflate ? 8 : 0, 8);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(file.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE(deflate ? 8 : 0, 10);
        entry.writeUInt32LE(body.length, 20);
        entry.writeUInt32LE(file.data.length, 24);
        entry.writeUInt16LE(name.length, 28);
        entry.writeUInt32LE(offset, 42);
        parts.push(local, name, body);
        directory.push(entry, name);
        offset += local.length + name.length + body.length;
    });
    const size = directory.reduce((sum, part) => sum + part.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, ...directory, end]);
}

describe('zip reader', () => {
    it('lists entries and reads stored and deflated ones', async () => {
        const level = Buffer.from('a level, many times over. '.repeat(200));
        const path = join(fixture.root, 'test.zip');
        await writeFile(path, makeZip([{ name: 'readme.txt', data: Buffer.from('hello') }, { name: 'DATA\\LEVEL1.PHD', data: level }]));
        const entries = await listZip(path);
        expect(entries.map((e) => e.path)).toEqual(['readme.txt', 'DATA/LEVEL1.PHD']);
        expect(Buffer.from(await readZipEntry(path, entries[0]!)).toString()).toBe('hello');
        expect(Buffer.from(await readZipEntry(path, entries[1]!)).equals(level)).toBe(true);
    });

    it('refuses a file that is not a zip', async () => {
        const path = join(fixture.root, 'not.zip');
        await writeFile(path, 'plain text');
        await expect(listZip(path)).rejects.toThrow(/not a zip/);
    });
});

describe('PNG writer', () => {
    it('writes the pixels back unchanged', () => {
        const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 8, 7, 6]);
        const png = encodePng(2, 2, pixels);
        expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
        expect(png.toString('latin1', 12, 16)).toBe('IHDR');
        expect(png.readUInt32BE(16)).toBe(2);
        expect(png.readUInt32BE(20)).toBe(2);
        const dataLength = png.readUInt32BE(33);
        expect(png.toString('latin1', 37, 41)).toBe('IDAT');
        const rows = inflateSync(png.subarray(41, 41 + dataLength));
        // Each row starts with its filter byte, 0.
        expect([...rows.subarray(0, 9)]).toEqual([0, ...pixels.subarray(0, 8)]);
        expect([...rows.subarray(9, 18)]).toEqual([0, ...pixels.subarray(8, 16)]);
    });
});

describe('/ring', () => {
    it('lists no models when the packages hold no levels', async () => {
        const response = await app.inject({ url: '/ring/manifest.json' });
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-cache');
        expect(response.json<RingManifest>()).toEqual({ models: {} });
    });

    it('answers 404 for a model it does not have', async () => {
        const response = await app.inject({ url: '/ring/tr1.0123456789ab.json' });
        expect(response.statusCode).toBe(404);
    });
});
