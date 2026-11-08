// The ADPCM decoder: against an encoder that keeps the decoder's state, and
// on the real music of The Last Revelation and Tomb Raider III under
// $TRX_LEVELS_DIR, whose headers it must read so the samples come out as
// sound rather than noise. The order of the nibbles is the format's (and
// ffmpeg's): the high one first, to the left channel.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WAD_TABLE_BYTES, wadEntry } from '../../shared/themes.ts';
import { decodeMsAdpcm, parseWav, pcmWav, playableWav } from './wav';

const ADAPTATION = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];
const COEFFICIENTS: [number, number][] = [
    [256, 0],
    [512, -256],
    [0, 0],
    [192, 64],
    [240, 0],
    [460, -208],
    [392, -232],
];

/** Encodes interleaved samples as Microsoft ADPCM, predictor 1, tracking what a decoder makes of each nibble. */
function encode(samples: Int16Array, channels: number, blockAlign: number): { wav: Uint8Array; decoded: Int16Array } {
    const perBlock = ((blockAlign - 7 * channels) * 2) / channels + 2;
    const frames = samples.length / channels;
    const blocks = Math.ceil(frames / perBlock);
    const data = new Uint8Array(blocks * blockAlign);
    const decoded: number[] = [];
    for (let b = 0; b < blocks; b++) {
        const at = b * blockAlign;
        const view = new DataView(data.buffer, at, blockAlign);
        const frame = (i: number, c: number) => samples[Math.min(frames - 1, b * perBlock + i) * channels + c]!;
        const s1: number[] = [];
        const s2: number[] = [];
        const delta: number[] = [];
        for (let c = 0; c < channels; c++) {
            data[at + c] = 1;
            delta[c] = 16;
            s2[c] = frame(0, c);
            s1[c] = frame(1, c);
            view.setInt16(channels + c * 2, delta[c]!, true);
            view.setInt16(channels * 3 + c * 2, s1[c]!, true);
            view.setInt16(channels * 5 + c * 2, s2[c]!, true);
        }
        for (let c = 0; c < channels; c++) decoded.push(s2[c]!);
        for (let c = 0; c < channels; c++) decoded.push(s1[c]!);
        const nibbles: number[] = [];
        for (let i = 2; i < perBlock; i++) {
            for (let c = 0; c < channels; c++) {
                const predicted = ((s1[c]! * 512 + s2[c]! * -256) / 256) | 0;
                const nibble = Math.max(-8, Math.min(7, Math.round((frame(i, c) - predicted) / delta[c]!)));
                const value = Math.max(-32768, Math.min(32767, predicted + nibble * delta[c]!));
                s2[c] = s1[c]!;
                s1[c] = value;
                delta[c] = Math.max(16, (ADAPTATION[nibble & 15]! * delta[c]!) >> 8);
                decoded.push(value);
                nibbles.push(nibble & 15);
            }
        }
        for (let i = 0; i < nibbles.length; i += 2) data[at + 7 * channels + i / 2] = (nibbles[i]! << 4) | (nibbles[i + 1] ?? 0);
    }
    const header = new Uint8Array(4 + 8 + 50 + 8);
    const view = new DataView(header.buffer);
    const text = (at: number, value: string) => [...value].forEach((char, i) => (header[at + i] = char.charCodeAt(0)));
    text(0, 'WAVE');
    text(4, 'fmt ');
    view.setUint32(8, 50, true);
    view.setUint16(12, 2, true);
    view.setUint16(14, channels, true);
    view.setUint32(16, 22050, true);
    view.setUint16(24, blockAlign, true);
    view.setUint16(26, 4, true);
    view.setUint16(28, 32, true);
    view.setUint16(30, perBlock, true);
    view.setUint16(32, COEFFICIENTS.length, true);
    COEFFICIENTS.forEach(([a, b], i) => {
        view.setInt16(34 + i * 4, a, true);
        view.setInt16(36 + i * 4, b, true);
    });
    text(62, 'data');
    view.setUint32(66, data.length, true);
    const wav = new Uint8Array(8 + header.length + data.length);
    wav.set([...'RIFF'].map((char) => char.charCodeAt(0)));
    new DataView(wav.buffer).setUint32(4, wav.length - 8, true);
    wav.set(header, 8);
    wav.set(data, 8 + header.length);
    return { wav, decoded: Int16Array.from(decoded) };
}

function sine(frames: number, channels: number): Int16Array {
    const out = new Int16Array(frames * channels);
    for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) out[i * channels + c] = Math.round(12000 * Math.sin((i * (c + 1) * 2 * Math.PI) / 90));
    return out;
}

/** How rough a signal is: the mean step between neighbouring samples, against its mean level. */
function roughness(samples: Int16Array, channels: number): number {
    let steps = 0;
    let level = 0;
    for (let i = channels; i < samples.length; i++) {
        steps += Math.abs(samples[i]! - samples[i - channels]!);
        level += Math.abs(samples[i]!);
    }
    return steps / Math.max(1, level);
}

describe('Microsoft ADPCM', () => {
    for (const channels of [1, 2]) {
        it(`decodes what an encoder made, ${channels === 1 ? 'mono' : 'stereo'}`, () => {
            const { wav, decoded } = encode(sine(5000, channels), channels, 256);
            const format = parseWav(wav);
            expect(format?.format).toBe(2);
            const samples = decodeMsAdpcm(wav, format!);
            expect(samples.length).toBe(decoded.length);
            expect([...samples]).toEqual([...decoded]);
        });
    }

    it('writes plain PCM that reads back', () => {
        const samples = sine(100, 2);
        const wav = pcmWav(samples, 2, 44100);
        const format = parseWav(wav)!;
        expect(format).toMatchObject({ format: 1, channels: 2, rate: 44100, bits: 16, dataSize: samples.length * 2 });
        expect(playableWav(wav)).toBe(wav);
    });

    const dir = process.env.TRX_LEVELS_DIR;
    const tr4 = dir === undefined ? null : join(dir, 'tr4/audio/039_TR4_Title_Q10.wav');
    it.skipIf(tr4 === null || !existsSync(tr4))('turns The Last Revelation’s main theme into music', () => {
        const bytes = new Uint8Array(readFileSync(tr4!));
        const format = parseWav(bytes)!;
        expect(format).toMatchObject({ format: 2, channels: 2, rate: 44100 });
        const samples = decodeMsAdpcm(bytes, format);
        const seconds = samples.length / 2 / format.rate;
        expect(seconds).toBeGreaterThan(60);
        // Sound moves little from one sample to the next; a misread header gives noise.
        expect(roughness(samples, 2)).toBeLessThan(0.2);
    });

    const tr3 = dir === undefined ? null : join(dir, 'tr3/app/audio/cdaudio.wad');
    it.skipIf(tr3 === null || !existsSync(tr3))('finds and decodes Tomb Raider III’s main theme in cdaudio.wad', () => {
        const wad = readFileSync(tr3!);
        const entry = wadEntry(new Uint8Array(wad.subarray(0, WAD_TABLE_BYTES)), 5)!;
        expect(entry.size).toBeGreaterThan(1_000_000);
        const bytes = new Uint8Array(wad.subarray(entry.offset, entry.offset + entry.size));
        const wav = playableWav(bytes)!;
        const format = parseWav(wav)!;
        expect(format.format).toBe(1);
        const samples = new Int16Array(wav.buffer, wav.byteOffset + format.dataOffset, format.dataSize / 2);
        expect(samples.length / 2 / format.rate).toBeGreaterThan(60);
        expect(roughness(samples, 2)).toBeLessThan(0.2);
    });
});
