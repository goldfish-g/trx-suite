// What a game made for TRX 1.10 and later keeps of its builder's work: the
// weapons and ring files TRX reads on their own, where a field or an entry
// left out was left out on purpose; the level scripts of an archive laid out
// as a whole TRX, beside copies of TRX's own; and none of the original
// engine's rules for a game that never ran on it.
import { describe, expect, it } from 'vitest';
import { detectGameVersion, processFiles } from '../../../converter/client/src/converter/gamedata.ts';
import { setupCustomGameflow } from '../../../converter/client/src/converter/gameflow.ts';
import { migrateToCurrentTRX } from '../../../converter/client/src/converter/migrate.ts';
import { mergeRing } from '../../../converter/client/src/converter/ring.ts';
import { STOCK_RING_OBJECTS, STOCK_WEAPON_FIELDS } from '../../../converter/client/src/converter/stockfields.generated.ts';
import { mergeWeapons } from '../../../converter/client/src/converter/weapons.ts';
import { tr2RealTrack } from '../../../converter/client/src/converter/tombpc.ts';
import { parseCdAudioDat, splitCdAudio } from '../../../converter/client/src/converter/cdaudio.ts';
import { BASE_FILES } from '../../../converter/client/src/templates/base/index.ts';
import { parseJSON5 } from '../../../converter/client/src/converter/json5.ts';
import type { MappedFile } from '../../../converter/client/src/converter/types.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const json = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value, null, 2));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const base = (game: string, file: string): any => parseJSON5(BASE_FILES[`${game}/${file}`]!);

const TR3_LEVEL = new Uint8Array(64);
new DataView(TR3_LEVEL.buffer).setUint32(0, 0xff180038, true);

function executable(version: string): Uint8Array {
    const utf16 = (text: string) => Uint8Array.from([...text].flatMap((c) => [c.charCodeAt(0), 0]));
    return Uint8Array.from([0x4d, 0x5a, 0, 0, ...utf16('ProductVersion\0'), 0, 0, ...utf16(version), 0, 0, 0, 0]);
}

async function convert(files: MappedFile[], mod: string) {
    const version = Number(detectGameVersion(files));
    const { mapped } = processFiles(files, mod);
    const flow = await setupCustomGameflow(mapped, mod, version, false, 'Test');
    const { files: out, notes } = await migrateToCurrentTRX(flow, { modDir: mod, gameVersion: version, upload: files });
    const byPath = new Map(out.map((file) => [file.path, file.data]));
    const read = (name: string) => {
        const data = byPath.get(`games/${mod}/${name}`);
        return data === undefined ? undefined : decoder.decode(data);
    };
    return { notes, read, paths: [...byPath.keys()] };
}

// TR3's scripts as TRX 1.10.2-304-g1f5f941 shipped them.
const STOCK_HOUSE = "trx.events.on_game_start(function()\n  -- Setup shoals\n  trx.items[55].properties.range = { x = 22, y = 2, z = 10 }\n  trx.items[56].properties.range = { x = 18, y = 1, z = 10 }\n  trx.items[57].properties.range = { x = 10, y = 1, z = 14 }\n  trx.items[58].properties.range = { x = 18, y = 2, z = 10 }\n  trx.items[59].properties.range = { x = 26, y = 2, z = 10 }\n  trx.items[77].properties.range = { x = 10, y = 2, z = 18 }\n  trx.items[56].properties.sprite_offset = 1\n  trx.items[57].properties.sprite_offset = 1\n  trx.items[59].properties.sprite_offset = 1\nend)\n";
const STOCK_ANTARC = "trx.events.on_game_start(function()\n  for _, room in pairs(trx.rooms) do\n    room.damaging = room.underwater\n    room.cold = true\n  end\nend)\n";
const STOCK_GAME = "require(\"common.water_color\").declare({\n  order = { \"pc\", \"ps1\", \"custom\" },\n  modes = {\n    pc = \"80E0FF\",\n    -- The two levels with no water carry the PC color, so the mode still has\n    -- an answer for them.\n    -- stylua: ignore\n    ps1 = {\n      house    = \"CCFF80\", -- Lara's Home\n      jungle   = \"CCFF80\", -- Jungle\n      temple   = \"CCFF80\", -- Temple Ruins\n      quadchas = \"CCFF80\", -- The River Ganges\n      tonyboss = \"CCFF80\", -- Caves of Kaliya\n      shore    = \"80FFFF\", -- Coastal Village\n      crash    = \"FFFFFF\", -- Crash Site\n      rapids   = \"FFFFFF\", -- Madubu Gorge\n      triboss  = \"80E0FF\", -- Temple of Puna\n      roofs    = \"FFFFFF\", -- Thames Wharf\n      sewer    = \"CCFF80\", -- Aldwych\n      tower    = \"CCFF80\", -- Lud's Gate\n      office   = \"CCFF80\", -- City\n      nevada   = \"FFFFFF\", -- Nevada Desert\n      compound = \"FFFFFF\", -- High Security Compound\n      area51   = \"FFFFFF\", -- Area 51\n      antarc   = \"80FFFF\", -- Antarctica\n      mines    = \"CCFFCC\", -- RX-Tech Mines\n      city     = \"80E0FF\", -- Lost City of Tinnos\n      chamber  = \"80E0FF\", -- Meteorite Cavern\n      stpaul   = \"B2E6E6\", -- All Hallows\n    },\n  },\n})\n\nrequire(\"common.save_crystal\").initialise()\n";

// A game laid out as a whole TRX 1.10 is, as Temple of Orca's archive is:
// TRX.exe and cfg/ above games/, which holds TRX's lone-level game beside
// the builder's, and a TOMBPC.DAT left over from the original game.
function wholeTRX(extra: MappedFile[] = []): MappedFile[] {
    return [
        { path: 'CAC/TRX.exe', data: executable('TRX 1.10.2-304-g1f5f941') },
        { path: 'CAC/games/tr3/gameflow.json5', data: json({
            title: { path: 'title.tr2', sequence: [{ type: 'exit_to_title' }] },
            levels: [
                { path: 'house.tr2', type: 'gym', sequence: [{ type: 'loop_game' }] },
                { path: 'antarc.tr2', sequence: [{ type: 'loop_game' }] },
            ],
        }) },
        { path: 'CAC/games/tr3/levels/TITLE.TR2', data: TR3_LEVEL },
        { path: 'CAC/games/tr3/levels/house.tr2', data: TR3_LEVEL },
        { path: 'CAC/games/tr3/levels/ANTARC.tr2', data: TR3_LEVEL },
        { path: 'CAC/games/tr3/levels/TOMBPC.DAT', data: new Uint8Array(512).fill(1) },
        { path: 'CAC/games/tr3/audio/cdaudio.wad', data: new Uint8Array(16) },
        { path: 'CAC/games/tr3/scripts/_game.lua', data: encoder.encode(STOCK_GAME) },
        { path: 'CAC/games/tr3/scripts/house.lua', data: encoder.encode(STOCK_HOUSE) },
        { path: 'CAC/games/tr3/scripts/antarc.lua', data: encoder.encode(STOCK_ANTARC.replace('\n', '\n  trx.weather.severity = 4.0\n')) },
        { path: 'CAC/games/tr3/images/og/theend.webp', data: new Uint8Array([1, 2, 3]) },
        { path: 'CAC/games/tr3-level/gameflow.json5', data: json({ levels: [] }) },
        { path: 'CAC/games/tr3-level/strings.json5', data: json({ levels: [] }) },
        ...extra,
    ];
}

describe("a TRX 1.10 game's weapons", () => {
    // TRX 1.10.2's own pistols, flat, as a builder copies them.
    const pistols = (ammo: Record<string, unknown>) => ({
        type: 'WEAPON_TYPE_DUAL_PISTOLS', damage: 1, gun_height: 650, sample_num: 'SFX_LARA_PISTOLS',
        aim_speed: 10, shot_accuracy: 8, target_dist: 8.0, recoil_frame: 9,
        flash_time: 3, flash_shade: 5120, flash_pos: { y: 185, z: 40 }, ammo,
    });

    it('run out where the builder took infinite ammo away', () => {
        const out = mergeWeapons({ LGT_PISTOLS: pistols({ initial_qty: 48, pickup_qty: 48, inventory_qty: 2 }) }, base('tr3', 'weapons.json5'), 10, 3, STOCK_WEAPON_FIELDS);
        expect(out.pistols.ammo).toEqual({ initial_shots: 48, box_shots: 48, box_label_qty: 2 });
        // What TRX has added since stays: the key that draws them, their objects.
        expect(out.pistols.equip_key).toBe('equip_pistols');
        expect(out.pistols.objects.pickup).toBe('pistols_item');
        // A position read as TRX did, with a left-out axis at 0.
        expect(out.pistols.flash.pos).toEqual({ x: 0, y: 185, z: 40 });
    });

    it('never run out where the builder left them as TRX had them', () => {
        const out = mergeWeapons({ LGT_PISTOLS: pistols({ initial_shots: 32, box_shots: 32, box_label_qty: 2, infinite: true }) }, base('tr3', 'weapons.json5'), 10, 3, STOCK_WEAPON_FIELDS);
        expect(out.pistols.ammo.infinite).toBe(true);
    });

    it('leave out a weapon the builder took out of the file', () => {
        const out = mergeWeapons({ LGT_PISTOLS: pistols({ infinite: true }) }, base('tr3', 'weapons.json5'), 10, 3, STOCK_WEAPON_FIELDS);
        expect(out.uzis).toBeUndefined();
        expect(out.pistols).toBeDefined();
    });

    it('keep what the engine had where a game before TRX 1.10 left a field out', () => {
        const out = mergeWeapons({ LGT_PISTOLS: pistols({ initial_qty: 48 }) }, base('tr3', 'weapons.json5'), 9, 3, STOCK_WEAPON_FIELDS);
        expect(out.pistols.ammo.infinite).toBe(true);
        expect(out.uzis).toBeDefined();
    });
});

describe("a TRX game's inventory ring", () => {
    const ring = base('tr1', 'inv_ring.json5') as Record<string, unknown>[];
    const stock = ring.find((e) => e.object_id === 'pistols_option')!;

    it("keeps the builder's entries as TRX read them, a left-out field at 0", () => {
        const own = [{ ...stock, object_id: 'O_PISTOL_OPTION', frames_total: 13, open_frame: 12, x_rot_sel: undefined, y_rot_sel: -8192 }];
        const out = mergeRing(JSON.parse(JSON.stringify(own)), ring, 10, 1, STOCK_RING_OBJECTS)!;
        const pistol = out.find((e) => e.object_id === 'pistols_option')!;
        expect(pistol).toMatchObject({ frames_total: 13, open_frame: 12, y_rot_sel: -8192, x_rot_sel: 0 });
        // An entry TRX's ring had at 1.10 and the builder's leaves out is off it.
        expect(out.find((e) => e.object_id === 'small_medipack_option')).toBeUndefined();
        // One TRX has put on since stays.
        const since = ring.filter((e) => !STOCK_RING_OBJECTS.tr1![10]!.includes(e.object_id as string));
        for (const entry of since) expect(out).toContainEqual(entry);
    });
});

describe('a game laid out as a whole TRX', () => {
    it("keeps the builder's level scripts, and TRX's own as TRX has them now", async () => {
        const { read, notes } = await convert(wholeTRX(), 'custom-whole');
        expect(read('scripts/antarc.lua')).toContain('trx.weather.severity = 4.0');
        // A copy of TRX's house.lua as TRX ships it now: the gym's assault course timer.
        expect(read('scripts/house.lua')).toContain('common.ui.hud.assault');
        expect(read('scripts/house.lua')).not.toContain('trx_compat');
        expect(notes.join('\n')).toContain("unchanged copies of TRX's own scripts");
    });

    it('runs none of the original engine\'s rules for a TOMBPC.DAT it never read', async () => {
        const { read, paths } = await convert(wholeTRX(), 'custom-notombpc');
        expect(paths.some((p) => /tombpc\.dat$/i.test(p) && !p.includes('/levels/'))).toBe(false);
        // Vehicles setting off heavy triggers, artefacts ending a level: tomb3.exe's rules, gone before TRX 1.10.
        expect(read('scripts/_game.lua') ?? '').not.toContain('is_heavy');
        expect(read('scripts/antarc.lua')).not.toContain('end_level');
        expect(read('scripts/house.lua')).not.toContain('end_level');
    });

    it('keeps its pictures where TRX looks for them, and leaves the games TRX ships beside it', async () => {
        const { read, paths } = await convert(wholeTRX(), 'custom-pictures');
        expect(paths).toContain('games/custom-pictures/images/og/theend.webp');
        expect(paths).not.toContain('games/custom-pictures/images/theend.webp');
        expect(JSON.parse(read('gameflow.json5')!).levels).toHaveLength(2);
    });

    it("takes the game's own level over a copy in the engine's data/", async () => {
        const stray = Uint8Array.from([...TR3_LEVEL, 9]);
        const { mapped } = processFiles(wholeTRX([{ path: 'CAC/data/antarc.tr2', data: stray }]), 'custom-ownlevel');
        const levels = mapped.filter((f) => f.path === 'games/custom-ownlevel/levels/antarc.tr2');
        expect(levels).toHaveLength(1);
        expect(levels[0]!.data).not.toBe(stray);
    });

    it("takes the engine's cfg/ data files where the game has none of its own", async () => {
        const weapons = { LGT_PISTOLS: { type: 'WEAPON_TYPE_DUAL_PISTOLS', damage: 7, ammo: { infinite: true } } };
        const fallback = await convert(wholeTRX([{ path: 'CAC/cfg/weapons.json5', data: json(weapons) }]), 'custom-cfgdata');
        expect(JSON.parse(fallback.read('weapons.json5')!).pistols.damage).toBe(7);
        const own = await convert(wholeTRX([
            { path: 'CAC/cfg/weapons.json5', data: json(weapons) },
            { path: 'CAC/games/tr3/weapons.json5', data: json({ ...weapons, LGT_PISTOLS: { ...weapons.LGT_PISTOLS, damage: 3 } }) },
        ]), 'custom-owndata');
        expect(JSON.parse(own.read('weapons.json5')!).pistols.damage).toBe(3);
    });
});

describe('the music of a game made for tomb2.exe or TR2X before 1.2', () => {
    it('plays the files the original engine played for its track numbers', () => {
        // MUSIC_TRACK_ID of tomb2.exe, and the file each played.
        const files: Record<number, number> = {
            2: 2, 3: 2, 4: 3, 5: 4, 18: 17, 19: 18, 20: 18, 21: 18, 22: 19, 25: 22, 26: 23, 27: 23, 28: 24,
            41: 37, 47: 43, 48: 44, 52: 48, 53: 49, 61: 57, 63: 59, 64: 60, 65: 61,
        };
        for (const [track, file] of Object.entries(files)) expect(tr2RealTrack(Number(track))).toBe(file);
        expect(tr2RealTrack(-1)).toBe(-1);
    });
});

describe('a TR2 soundtrack in one file', () => {
    // A WAV of 1000 Hz mono 8-bit samples, one second long: each sample is
    // its own millisecond.
    function wav(): Uint8Array {
        const pcm = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
        const out = new Uint8Array(44 + pcm.length);
        const w = new DataView(out.buffer);
        out.set(encoder.encode('RIFF'), 0);
        w.setUint32(4, out.length - 8, true);
        out.set(encoder.encode('WAVEfmt '), 8);
        w.setUint32(16, 16, true);
        w.setUint16(20, 1, true);
        w.setUint16(22, 1, true);
        w.setUint32(24, 1000, true);
        w.setUint32(28, 1000, true);
        w.setUint16(32, 1, true);
        w.setUint16(34, 8, true);
        out.set(encoder.encode('data'), 36);
        w.setUint32(40, pcm.length, true);
        out.set(pcm, 44);
        return out;
    }
    const dat = '2 00000000 00000250 Opening\n3 00000250 00000250\n43 00000600 00001000 Secret\n';

    it('reads cdaudio.dat as the patches did, a track with no end running to the next', () => {
        expect(parseCdAudioDat(dat)).toEqual([
            { track: 2, from: 0, to: 250 }, { track: 3, from: 250, to: 600 }, { track: 43, from: 600, to: 1000 },
        ]);
    });

    it('becomes a file per track, in place of the files of a game made for the original engine', () => {
        const files: MappedFile[] = [
            { path: 'games/g/music/cdaudio.wav', data: wav() },
            { path: 'games/g/audio/cdaudio.dat', data: encoder.encode(dat) },
            { path: 'games/g/music/43.ogg', data: new Uint8Array([1]) },
            { path: 'games/g/music/10.ogg', data: new Uint8Array([2]) },
        ];
        const { files: out } = splitCdAudio(files, 'g', true);
        const paths = out.map((f) => f.path).sort();
        expect(paths).toEqual(['games/g/music/10.ogg', 'games/g/music/2.wav', 'games/g/music/3.wav', 'games/g/music/43.wav']);
        const three = out.find((f) => f.path.endsWith('/3.wav'))!;
        expect(new DataView(three.data.buffer).getUint32(40, true)).toBe(350);
        expect(three.data[44]).toBe(250 % 251);
        // A game made for TRX played its own track files first.
        expect(splitCdAudio(files, 'g', false).files.map((f) => f.path)).toContain('games/g/music/43.ogg');
    });
});
