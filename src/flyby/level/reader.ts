// Reads the little-endian binary layout of the original level files. Every
// read is bounds-checked by DataView, so a truncated or foreign file fails
// with a RangeError instead of producing garbage.

export class LevelFormatError extends Error {}

export class Reader {
    readonly bytes: Uint8Array;
    readonly view: DataView;
    pos = 0;

    constructor(bytes: Uint8Array) {
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    get length(): number {
        return this.bytes.byteLength;
    }

    get remaining(): number {
        return this.bytes.byteLength - this.pos;
    }

    u8(): number {
        return this.view.getUint8(this.pos++);
    }

    i8(): number {
        return this.view.getInt8(this.pos++);
    }

    u16(): number {
        const value = this.view.getUint16(this.pos, true);
        this.pos += 2;
        return value;
    }

    i16(): number {
        const value = this.view.getInt16(this.pos, true);
        this.pos += 2;
        return value;
    }

    u32(): number {
        const value = this.view.getUint32(this.pos, true);
        this.pos += 4;
        return value;
    }

    i32(): number {
        const value = this.view.getInt32(this.pos, true);
        this.pos += 4;
        return value;
    }

    f32(): number {
        const value = this.view.getFloat32(this.pos, true);
        this.pos += 4;
        return value;
    }

    skip(bytes: number): void {
        if (bytes < 0 || this.pos + bytes > this.length) {
            throw new LevelFormatError(`The level ends early (wanted ${bytes} bytes at ${this.pos}).`);
        }
        this.pos += bytes;
    }

    /** A view of the next bytes, without copying. */
    take(bytes: number): Uint8Array {
        if (bytes < 0 || this.pos + bytes > this.length) {
            throw new LevelFormatError(`The level ends early (wanted ${bytes} bytes at ${this.pos}).`);
        }
        const slice = this.bytes.subarray(this.pos, this.pos + bytes);
        this.pos += bytes;
        return slice;
    }

    /** A count of records, refused when the records could not fit in what is left. */
    count32(recordBytes: number, what: string): number {
        const count = this.u32();
        this.checkFits(count, recordBytes, what);
        return count;
    }

    count16(recordBytes: number, what: string): number {
        const count = this.u16();
        this.checkFits(count, recordBytes, what);
        return count;
    }

    private checkFits(count: number, recordBytes: number, what: string): void {
        if (count * recordBytes > this.remaining) {
            throw new LevelFormatError(`The level claims ${count} ${what}, more than the file holds.`);
        }
    }

    i16Array(count: number): Int16Array {
        const out = new Int16Array(count);
        for (let i = 0; i < count; i++) out[i] = this.i16();
        return out;
    }

    u16Array(count: number): Uint16Array {
        const out = new Uint16Array(count);
        for (let i = 0; i < count; i++) out[i] = this.u16();
        return out;
    }

    u32Array(count: number): Uint32Array {
        const out = new Uint32Array(count);
        for (let i = 0; i < count; i++) out[i] = this.u32();
        return out;
    }

    i32Array(count: number): Int32Array {
        const out = new Int32Array(count);
        for (let i = 0; i < count; i++) out[i] = this.i32();
        return out;
    }
}
