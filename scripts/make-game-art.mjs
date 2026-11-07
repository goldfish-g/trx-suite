// Takes the menu's lettering and button prompts from TRX's own: the
// in-game font of TR1, TR2 and TR3, and the controller and keyboard icons
// each draws in its prompts, one sheet per game for the menu's themes.
//
//   node scripts/make-game-art.mjs <TRX checkout> <TRXInjectionTool checkout>
//
// TRX builds each game's font from the sprites the injection tool packs
// (src/Resources/TR*/Font, GPL-3.0) and finds a character's sprite by the
// index in src/trx/game/ui/text_autogen.def. This reads both, packs the
// glyphs the menu may need and the icons its prompts use into
// src/ui/gameArt/<theme>.png, and writes where each one is, and how TRX
// sets it, to src/ui/gameArt/sheets.ts.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const [trx, tool] = process.argv.slice(2);
if (trx === undefined || tool === undefined) {
    console.error('usage: node scripts/make-game-art.mjs <TRX checkout> <TRXInjectionTool checkout>');
    process.exit(1);
}
const out = 'src/ui/gameArt';
mkdirSync(out, { recursive: true });

const THEMES = { tr1: 'TR1', tr2: 'TR2', tr3: 'TR3' };
const ICONS = [
    'controller button a', 'controller button b', 'controller button x', 'controller button y',
    'controller button cross', 'controller button circle', 'controller button square', 'controller button triangle',
    'controller dpad up', 'controller dpad down', 'controller dpad left', 'controller dpad right',
    'controller bumper left', 'controller bumper right', 'controller button l1', 'controller button r1',
    'controller button options', 'controller button share',
    'controller trigger left', 'controller trigger right', 'controller button l2', 'controller button r2',
    'keyboard return', 'keyboard escape', 'keyboard e', 'keyboard f', 'keyboard m', 'keyboard q', 'keyboard r', 'keyboard v', 'keyboard z', 'keyboard c',
    'keyboard left', 'keyboard right', 'keyboard up', 'keyboard down',
];
/** Latin letters, punctuation and the typographer's marks: what names and labels use. */
const wantedChar = (cp) => (cp >= 0x21 && cp <= 0x7e) || (cp >= 0xa1 && cp <= 0x17f) || (cp >= 0x2010 && cp <= 0x2044);

// X_GLYPH_DEFINE("a", GLYPH_TEXT, 26) and X_GLYPH_DEFINE("\\{controller button a}", GLYPH_ICON, 760)
const chars = new Map();
const icons = new Map();
for (const [, text, kind, index] of readFileSync(join(trx, 'src/trx/game/ui/text_autogen.def'), 'utf8').matchAll(
    /X_GLYPH_DEFINE\(("(?:[^"\\]|\\.)*"), (GLYPH_\w+), (\d+)\)/g,
)) {
    const value = JSON.parse(text);
    if (kind === 'GLYPH_TEXT' && [...value].length === 1 && wantedChar(value.codePointAt(0))) chars.set(value, Number(index));
    const icon = /^\\\{(.+)\}$/.exec(value)?.[1];
    if (kind === 'GLYPH_ICON' && icon !== undefined && ICONS.includes(icon)) icons.set(icon, Number(index));
}
for (const name of ICONS) if (!icons.has(name)) throw new Error(`TRX has no icon ${name}`);

const sheets = {};
for (const [theme, game] of Object.entries(THEMES)) {
    const dir = join(tool, 'src/Resources', game, 'Font');
    const info = new Map(JSON.parse(readFileSync(join(dir, 'glyph_info.json'), 'utf8')).map((entry) => [entry.mesh_num, entry]));
    const atlases = new Map();
    const atlas = (name) => {
        if (!atlases.has(name)) atlases.set(name, decodePng(readFileSync(join(dir, name))));
        return atlases.get(name);
    };
    const items = [];
    for (const [char, index] of chars) if (info.has(index)) items.push({ key: char, kind: 'glyph', entry: info.get(index) });
    for (const [name, index] of icons) {
        if (!info.has(index)) throw new Error(`${game} has no sprite for ${name}`);
        items.push({ key: name, kind: 'icon', entry: info.get(index) });
    }

    // Shelves, tallest first, a pixel apart so no glyph bleeds into the next.
    const WIDTH = 256;
    items.sort((a, b) => b.entry.h - a.entry.h || b.entry.w - a.entry.w);
    let x = 1;
    let y = 1;
    let shelf = 0;
    for (const item of items) {
        if (x + item.entry.w + 1 > WIDTH) {
            x = 1;
            y += shelf + 1;
            shelf = 0;
        }
        item.x = x;
        item.y = y;
        x += item.entry.w + 1;
        shelf = Math.max(shelf, item.entry.h);
    }
    const height = y + shelf + 1;
    const pixels = new Uint8Array(WIDTH * height * 4);
    for (const item of items) {
        const { filename, x: sx, y: sy, w, h } = item.entry;
        const source = atlas(filename);
        for (let row = 0; row < h; row++) {
            const from = ((sy + row) * source.width + sx) * 4;
            pixels.set(source.rgba.subarray(from, from + w * 4), ((item.y + row) * WIDTH + item.x) * 4);
        }
    }
    writeFileSync(join(out, `${theme}.png`), encodePng(WIDTH, height, pixels));
    if (theme === 'tr1') writeIcon(items, pixels, WIDTH);

    const glyphs = {};
    const iconRects = {};
    for (const item of items.sort((a, b) => a.key.localeCompare(b.key))) {
        const { w, h, l, t } = item.entry;
        // A sprite's width, as the level stores it, is its pixels times 256
        // plus 255: TRX advances by that over 255, one more than the pixels.
        if (item.kind === 'glyph') glyphs[item.key] = [item.x, item.y, w, h, w + 1, l, t];
        else iconRects[item.key] = [item.x, item.y, w, h];
    }
    sheets[theme] = { glyphs, icons: iconRects, size: [WIDTH, height] };
    console.log(`${theme}: ${Object.keys(glyphs).length} glyphs, ${Object.keys(iconRects).length} icons, ${WIDTH}x${height}`);
}

const format = (record) =>
    Object.entries(record)
        .map(([key, value]) => `            ${JSON.stringify(key)}: [${value.join(', ')}],`)
        .join('\n');
writeFileSync(
    join(out, 'sheets.ts'),
    `// Generated by scripts/make-game-art.mjs from TRX's fonts and prompt icons
// (TRX and TRXInjectionTool, GPL-3.0): one sheet per game, <theme>.png.

export type Theme = ${Object.keys(THEMES).map((theme) => `'${theme}'`).join(' | ')};

/** A line of text, and where its baseline is, in the font's pixels. */
export const LINE_HEIGHT = 18;
export const BASELINE = 15;
/** The gap TRX leaves between letters, and the width of its space. */
export const LETTER_SPACING = 0.5;
export const WORD_SPACING = 6;

export type IconName =
${ICONS.map((name) => `    | '${name}'`).join('\n')};

export interface Sheet {
    /** x, y, width and height on the sheet; how far the pen moves past it; its left and top, from the pen on the baseline. */
    glyphs: Record<string, readonly [number, number, number, number, number, number, number]>;
    /** x, y, width and height on the sheet. */
    icons: Record<IconName, readonly [number, number, number, number]>;
    size: readonly [number, number];
}

export const SHEETS: Record<Theme, Sheet> = {
${Object.entries(sheets)
    .map(
        ([theme, sheet]) => `    ${theme}: {
        glyphs: {
${format(sheet.glyphs)}
        },
        icons: {
${format(sheet.icons)}
        },
        size: [${sheet.size.join(', ')}],
    },`,
    )
    .join('\n')}
};
`,
);

/**
 * The app's icon, public/icons/icon.svg: "TRX" in TR1's lettering, pixel by
 * pixel off its sheet, on the PlayStation games' selection glow inside TR1's
 * etched gold frame. scripts/make-icons.mjs draws the PNGs from it.
 */
function writeIcon(items, pixels, sheetWidth) {
    const S = 8; // icon units per pixel of the font
    const letters = [...'TRX'].map((char) => items.find((item) => item.key === char));
    const width = letters.reduce((sum, item) => sum + (item.entry.w + 1) * S, 0) - S;
    const top = Math.min(...letters.map((item) => item.entry.t));
    const bottom = Math.max(...letters.map((item) => item.entry.t + item.entry.h));
    let penX = Math.round((512 - width) / 2);
    const baseline = Math.round((512 - (bottom - top) * S) / 2) - top * S;
    const hex = (at) => '#' + [...pixels.subarray(at, at + 3)].map((v) => v.toString(16).padStart(2, '0')).join('');
    const rects = [];
    for (const item of letters) {
        const { w, h, l, t } = item.entry;
        for (let row = 0; row < h; row++) {
            let run = null;
            const flush = () => {
                if (run !== null) {
                    rects.push(`<rect x="${penX + (l + run.x) * S}" y="${baseline + (t + row) * S}" width="${run.n * S}" height="${S}" fill="${run.color}"/>`);
                }
                run = null;
            };
            for (let col = 0; col < w; col++) {
                const at = ((item.y + row) * sheetWidth + item.x + col) * 4;
                const color = pixels[at + 3] < 128 ? null : hex(at);
                if (run !== null && run.color === color) run.n++;
                else {
                    flush();
                    if (color !== null) run = { x: col, n: 1, color };
                }
            }
            flush();
        }
        penX += (w + 1) * S;
    }
    // The frame as the menus draw it: light outside and dark inside along
    // the top and left, the other way round along the bottom and right.
    const [light, dark, e, a, b] = ['#e8c070', '#8c7038', 8, 40, 472];
    const square = (inset, size, fill) => `<rect x="${a + inset}" y="${a + inset}" width="${size}" height="${size}" fill="${fill}"/>`;
    const frame = [
        square(0, b - a, dark),
        square(0, b - a - e, light),
        square(e, b - a - 2 * e, light),
        square(e, b - a - 3 * e, dark),
        square(2 * e, b - a - 4 * e, '#000'),
    ];
    writeFileSync(
        'public/icons/icon.svg',
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" shape-rendering="crispEdges">
  <!-- Generated by scripts/make-game-art.mjs: "TRX" in TR1's font, from TRX's sprite sheets (GPL-3.0). -->
  <defs>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000"/>
      <stop offset="0.5" stop-color="#e8c070" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#000"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="#000"/>
  ${frame.join('\n  ')}
  <rect x="${a + 2 * e}" y="${baseline + (top - 4) * S}" width="${b - a - 4 * e}" height="${(bottom - top + 8) * S}" fill="url(#glow)"/>
  ${rects.join('\n  ')}
</svg>
`,
    );
}

/** Reads an 8-bit, non-interlaced PNG: greyscale, RGB, palette, or with alpha. */
function decodePng(file) {
    let offset = 8;
    let width = 0;
    let height = 0;
    let type = 0;
    let palette = null;
    let transparency = null;
    const data = [];
    while (offset < file.length) {
        const length = file.readUInt32BE(offset);
        const name = file.toString('latin1', offset + 4, offset + 8);
        const body = file.subarray(offset + 8, offset + 8 + length);
        if (name === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            type = body[9];
            if (body[8] !== 8 || body[12] !== 0) throw new Error('only 8-bit, non-interlaced PNGs');
        } else if (name === 'PLTE') palette = body;
        else if (name === 'tRNS') transparency = body;
        else if (name === 'IDAT') data.push(body);
        offset += length + 12;
    }
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
    const stride = width * channels;
    const raw = inflateSync(Buffer.concat(data));
    const rows = new Uint8Array(stride * height);
    for (let row = 0; row < height; row++) {
        const filter = raw[row * (stride + 1)];
        const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
        for (let i = 0; i < stride; i++) {
            const left = i >= channels ? rows[row * stride + i - channels] : 0;
            const up = row > 0 ? rows[(row - 1) * stride + i] : 0;
            const corner = row > 0 && i >= channels ? rows[(row - 1) * stride + i - channels] : 0;
            let value = line[i];
            if (filter === 1) value += left;
            else if (filter === 2) value += up;
            else if (filter === 3) value += (left + up) >> 1;
            else if (filter === 4) {
                const p = left + up - corner;
                const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
                value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
            }
            rows[row * stride + i] = value;
        }
    }
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const p = rows.subarray(i * channels, (i + 1) * channels);
        const [r, g, b, a] =
            type === 6 ? p
            : type === 2 ? [p[0], p[1], p[2], 255]
            : type === 3 ? [palette[p[0] * 3], palette[p[0] * 3 + 1], palette[p[0] * 3 + 2], transparency?.[p[0]] ?? 255]
            : type === 4 ? [p[0], p[0], p[0], p[1]]
            : [p[0], p[0], p[0], 255];
        rgba.set([r, g, b, a], i * 4);
    }
    return { width, height, rgba };
}

function encodePng(width, height, rgba) {
    const chunk = (name, body) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(body.length, 0);
        head.write(name, 4, 'latin1');
        const tail = Buffer.alloc(4);
        tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
        return Buffer.concat([head, body, tail]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8);
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let row = 0; row < height; row++) raw.set(rgba.subarray(row * width * 4, (row + 1) * width * 4), row * (width * 4 + 1) + 1);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}
