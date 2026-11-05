// Procedural canvas textures. Kept small (≤ 256²) and used only where
// geometry alone can't carry the look: the soft glow halo, the lapis
// mottling, and the compass rose.

import * as THREE from 'three';
import { gradientNoise, fbm, rng } from './noise';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const el = document.createElement('canvas');
    el.width = size;
    el.height = size;
    const ctx = el.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    return [el, ctx];
}

/** Soft radial falloff for additive glow sprites (white; tinted by the sprite). */
export function haloTexture(): THREE.CanvasTexture {
    const size = 64;
    const [el, ctx] = canvas(size);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (x + 0.5) / size - 0.5;
            const dy = (y + 0.5) / size - 0.5;
            const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
            // A bright pinpoint core over a long, gentle falloff.
            const v = Math.max(0, (1 - r) ** 2 * 0.75 + Math.exp(-r * r * 40) * 0.25);
            const i = (y * size + x) * 4;
            img.data[i] = 255;
            img.data[i + 1] = 255;
            img.data[i + 2] = 255;
            img.data[i + 3] = Math.round(v * 255);
        }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/**
 * Lapis lazuli: ultramarine mottled with darker veins, faint pale calcite
 * clouds, and scattered golden pyrite flecks.
 */
export function lapisTexture(seed = 7): THREE.CanvasTexture {
    const size = 256;
    const [el, ctx] = canvas(size);
    const img = ctx.createImageData(size, size);
    const noise = gradientNoise(seed);
    const deep = [10, 24, 88];
    const bright = [30, 60, 165];
    const calcite = [120, 140, 185];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const v = y / size;
            const n = fbm(noise, u * 5, v * 5, 0.5, 4);
            const veins = Math.abs(fbm(noise, u * 3 + 10, v * 3, 2.5, 3));
            const cloud = Math.max(0, fbm(noise, u * 2.2 + 30, v * 2.2, 7.5, 3) - 0.22) * 1.6;
            let t = Math.min(1, Math.max(0, 0.5 + n * 1.3));
            t *= 0.55 + 0.45 * Math.min(1, veins * 6);
            const i = (y * size + x) * 4;
            for (let c = 0; c < 3; c++) {
                const base = deep[c]! + (bright[c]! - deep[c]!) * t;
                img.data[i + c] = Math.round(base + (calcite[c]! - base) * Math.min(0.35, cloud));
            }
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);

    // Pyrite: tiny warm gold specks, a few clustered.
    const random = rng(seed * 31 + 3);
    for (let k = 0; k < 140; k++) {
        const x = random() * size;
        const y = random() * size;
        const r = 0.35 + random() ** 3 * 1.0;
        const a = 0.5 + random() * 0.4;
        ctx.fillStyle = `rgba(${200 + random() * 30}, ${150 + random() * 30}, ${50 + random() * 30}, ${a})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
}

/**
 * The compass card: aged ivory, a degree ring, and a 16-point rose whose
 * points are split light/dark like an engraved chart rose. North is up (+v).
 */
export function compassDialTexture(): THREE.CanvasTexture {
    const size = 256;
    const [el, ctx] = canvas(size);
    const c = size / 2;

    // Ivory card with a soft vignette towards the rim.
    const bg = ctx.createRadialGradient(c, c, size * 0.05, c, c, size * 0.5);
    bg.addColorStop(0, '#f4e8c8');
    bg.addColorStop(0.75, '#e2cf9f');
    bg.addColorStop(1, '#a88a58');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    const ink = '#3b2a1a';
    const sepia = '#8a5a2b';

    // Degree ring: two thin circles with ticks between them.
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    for (const r of [0.47, 0.4]) {
        ctx.beginPath();
        ctx.arc(c, c, size * r, 0, Math.PI * 2);
        ctx.stroke();
    }
    for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const long = i % 6 === 0;
        const r0 = size * (long ? 0.4 : 0.43);
        const r1 = size * 0.47;
        ctx.lineWidth = long ? 1.6 : 0.9;
        ctx.beginPath();
        ctx.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0);
        ctx.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1);
        ctx.stroke();
    }

    // The rose: 16 points in three sizes, each with a light and a dark half.
    const point = (angle: number, length: number, width: number, light: string, dark: string) => {
        const tip = [c + Math.sin(angle) * length, c - Math.cos(angle) * length] as const;
        const left = [c + Math.sin(angle - Math.PI / 2) * width, c - Math.cos(angle - Math.PI / 2) * width] as const;
        const right = [c + Math.sin(angle + Math.PI / 2) * width, c - Math.cos(angle + Math.PI / 2) * width] as const;
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(...left);
        ctx.lineTo(...tip);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(...tip);
        ctx.lineTo(...right);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(...left);
        ctx.lineTo(...tip);
        ctx.lineTo(...right);
        ctx.stroke();
    };
    for (let i = 0; i < 16; i++) {
        if (i % 2 === 0) continue;
        point((i / 16) * Math.PI * 2, size * 0.25, size * 0.03, '#e9d7aa', sepia);
    }
    for (let i = 1; i < 8; i += 2) point((i / 8) * Math.PI * 2, size * 0.31, size * 0.045, '#f1e2bb', '#6b4524');
    for (let i = 0; i < 4; i++) {
        const north = i === 0;
        point((i / 4) * Math.PI * 2, size * 0.385, size * 0.06, north ? '#d9564a' : '#f6ead0', north ? '#7e1f1a' : ink);
    }
    ctx.fillStyle = '#c9a25a';
    ctx.beginPath();
    ctx.arc(c, c, size * 0.03, 0, Math.PI * 2);
    ctx.fill();

    // Cardinal letters inside the degree ring, between the rose points.
    ctx.fillStyle = ink;
    ctx.font = `bold ${Math.round(size * 0.075)}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const letters = ['N', 'E', 'S', 'W'];
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const r = size * 0.435;
        ctx.save();
        ctx.translate(c + Math.sin(a) * r, c - Math.cos(a) * r);
        ctx.rotate(a);
        ctx.fillStyle = '#f4e8c8';
        ctx.fillRect(-size * 0.04, -size * 0.04, size * 0.08, size * 0.08);
        ctx.fillStyle = i === 0 ? '#8e2219' : ink;
        ctx.fillText(letters[i]!, 0, size * 0.004);
        ctx.restore();
    }

    const tex = new THREE.CanvasTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}
