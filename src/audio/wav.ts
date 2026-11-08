// WAV files as Tomb Raider III and The Last Revelation keep their music:
// Microsoft ADPCM, four bits a sample, which no browser plays. This turns
// them into plain 16-bit PCM, which every browser does.

export interface WavFormat {
    /** 1 for PCM, 2 for Microsoft ADPCM. */
    format: number;
    channels: number;
    rate: number;
    blockAlign: number;
    bits: number;
    /** ADPCM only: samples per channel in each block. */
    samplesPerBlock: number;
    /** ADPCM only: the predictor coefficient pairs. */
    coefficients: [number, number][];
    dataOffset: number;
    dataSize: number;
}

const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);

/** The format and where the samples are, or null when it is no WAV file. */
export function parseWav(bytes: Uint8Array): WavFormat | null {
    if (bytes.length < 12 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE') return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let format: Omit<WavFormat, 'dataOffset' | 'dataSize'> | null = null;
    for (let at = 12; at + 8 <= bytes.length; ) {
        const id = ascii(bytes, at);
        const size = view.getUint32(at + 4, true);
        const body = at + 8;
        if (id === 'fmt ' && body + 16 <= bytes.length) {
            const tag = view.getUint16(body, true);
            const coefficients: [number, number][] = [];
            let samplesPerBlock = 0;
            if (tag === 2 && size >= 20 && body + 22 <= bytes.length) {
                samplesPerBlock = view.getUint16(body + 18, true);
                const count = view.getUint16(body + 20, true);
                for (let i = 0; i < count && body + 26 + i * 4 <= bytes.length; i++) {
                    coefficients.push([view.getInt16(body + 22 + i * 4, true), view.getInt16(body + 24 + i * 4, true)]);
                }
            }
            format = {
                format: tag,
                channels: view.getUint16(body + 2, true),
                rate: view.getUint32(body + 4, true),
                blockAlign: view.getUint16(body + 12, true),
                bits: view.getUint16(body + 14, true),
                samplesPerBlock,
                coefficients,
            };
        } else if (id === 'data') {
            if (format === null) return null;
            return { ...format, dataOffset: body, dataSize: Math.min(size, bytes.length - body) };
        }
        at = body + size + (size & 1);
    }
    return null;
}

const ADAPTATION = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];
const clamp16 = (value: number) => (value > 32767 ? 32767 : value < -32768 ? -32768 : value);

/** Decodes Microsoft ADPCM into interleaved 16-bit samples. */
export function decodeMsAdpcm(bytes: Uint8Array, format: WavFormat): Int16Array {
    const { channels, blockAlign, coefficients } = format;
    if (channels < 1 || channels > 2 || blockAlign < 7 * channels || coefficients.length === 0) throw new Error('Not an ADPCM format this can read.');
    const header = 7 * channels;
    const perBlock = format.samplesPerBlock || ((blockAlign - header) * 2) / channels + 2;
    const blocks = Math.ceil(format.dataSize / blockAlign);
    const out = new Int16Array(blocks * perBlock * channels);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const coef1 = new Int32Array(channels);
    const coef2 = new Int32Array(channels);
    const delta = new Int32Array(channels);
    const sample1 = new Int32Array(channels);
    const sample2 = new Int32Array(channels);
    let written = 0;
    for (let block = 0; block < blocks; block++) {
        const start = format.dataOffset + block * blockAlign;
        const end = Math.min(format.dataOffset + format.dataSize, start + blockAlign);
        if (end - start < header) break;
        // The block's header: each channel's predictor, step, and its first two samples.
        for (let c = 0; c < channels; c++) {
            const predictor = Math.min(bytes[start + c]!, coefficients.length - 1);
            coef1[c] = coefficients[predictor]![0];
            coef2[c] = coefficients[predictor]![1];
            delta[c] = view.getInt16(start + channels + c * 2, true);
            sample1[c] = view.getInt16(start + channels * 3 + c * 2, true);
            sample2[c] = view.getInt16(start + channels * 5 + c * 2, true);
        }
        for (let c = 0; c < channels; c++) out[written + c] = sample2[c]!;
        written += channels;
        for (let c = 0; c < channels; c++) out[written + c] = sample1[c]!;
        written += channels;
        // Then four bits a sample, the high half of each byte first; in
        // stereo, the high half is the left channel and the low half the right.
        const step = (c: number, nibble: number) => {
            const signed = nibble >= 8 ? nibble - 16 : nibble;
            // Divided as C divides, toward zero, as the format and ffmpeg do.
            const value = clamp16((((sample1[c]! * coef1[c]! + sample2[c]! * coef2[c]!) / 256) | 0) + signed * delta[c]!);
            sample2[c] = sample1[c]!;
            sample1[c] = value;
            delta[c] = Math.max(16, (ADAPTATION[nibble]! * delta[c]!) >> 8);
            out[written++] = value;
        };
        const last = channels - 1;
        for (let at = start + header; at < end; at++) {
            const byte = bytes[at]!;
            step(0, byte >> 4);
            step(last, byte & 15);
        }
    }
    return out.subarray(0, written - (written % channels));
}

/** A 16-bit PCM WAV file of interleaved samples. */
export function pcmWav(samples: Int16Array, channels: number, rate: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(bytes.buffer);
    const text = (at: number, value: string) => {
        for (let i = 0; i < 4; i++) bytes[at + i] = value.charCodeAt(i);
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    new Int16Array(bytes.buffer, 44, samples.length).set(samples);
    return bytes;
}

/** Any WAV file the games have, as one every browser plays; null when it cannot be read. */
export function playableWav(bytes: Uint8Array): Uint8Array | null {
    const format = parseWav(bytes);
    if (format === null) return null;
    if (format.format === 1) return bytes;
    if (format.format === 2) return pcmWav(decodeMsAdpcm(bytes, format), format.channels, format.rate);
    return null;
}
