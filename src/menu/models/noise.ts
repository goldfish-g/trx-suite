// Small deterministic randomness helpers. Every artifact is built from a fixed
// seed so it looks the same on every device and every load.

/** Mulberry32: a tiny, fast, seedable PRNG returning floats in [0, 1). */
export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export type Noise3 = (x: number, y: number, z: number) => number;

/**
 * Seeded 3D gradient (Perlin-style) noise in roughly [-1, 1].
 */
export function gradientNoise(seed: number): Noise3 {
    const random = rng(seed);
    const perm = new Uint8Array(512);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const tmp = p[i]!;
        p[i] = p[j]!;
        p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;

    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    const grad = (hash: number, x: number, y: number, z: number) => {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    };
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    return (x, y, z) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const zi = Math.floor(z);
        const X = xi & 255;
        const Y = yi & 255;
        const Z = zi & 255;
        x -= xi;
        y -= yi;
        z -= zi;
        const u = fade(x);
        const v = fade(y);
        const w = fade(z);
        const A = perm[X]! + Y;
        const AA = perm[A]! + Z;
        const AB = perm[A + 1]! + Z;
        const B = perm[X + 1]! + Y;
        const BA = perm[B]! + Z;
        const BB = perm[B + 1]! + Z;
        return lerp(
            lerp(
                lerp(grad(perm[AA]!, x, y, z), grad(perm[BA]!, x - 1, y, z), u),
                lerp(grad(perm[AB]!, x, y - 1, z), grad(perm[BB]!, x - 1, y - 1, z), u),
                v,
            ),
            lerp(
                lerp(grad(perm[AA + 1]!, x, y, z - 1), grad(perm[BA + 1]!, x - 1, y, z - 1), u),
                lerp(grad(perm[AB + 1]!, x, y - 1, z - 1), grad(perm[BB + 1]!, x - 1, y - 1, z - 1), u),
                v,
            ),
            w,
        );
    };
}

/** Fractal sum of `octaves` noise layers, each at double frequency, half amplitude. */
export function fbm(noise: Noise3, x: number, y: number, z: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
        sum += amp * noise(x * freq, y * freq, z * freq);
        freq *= 2;
        amp *= 0.5;
    }
    return sum;
}
