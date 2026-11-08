// The main theme of each official game, for the menu to play while one of
// its levels flies by, and where to find it among a game's files. Shared by
// the page, which plays it from the player's own copy, and the server,
// which offers it with the levels it gives everyone.
//
// The tracks are the ones TRX's own gameflows play on the title screens,
// except The Last Revelation's: its title screen plays an ambient loop
// (track 104, "A4 Weird1"), and its main theme is track 39 ("TR4 Title").
// An expansion plays its base game's theme, the same track in its files,
// so going between the two keeps the music playing.

export interface MainTheme {
    /** The same for games that play the same piece. */
    key: string;
    track: number;
}

export const MAIN_THEMES: Readonly<Record<string, MainTheme>> = {
    tr1: { key: 'tr1', track: 2 },
    'tr1-ub': { key: 'tr1', track: 2 },
    tr2: { key: 'tr2', track: 60 },
    'tr2-gm': { key: 'tr2', track: 60 },
    tr3: { key: 'tr3', track: 5 },
    'tr3-la': { key: 'tr3', track: 5 },
    tr4: { key: 'tr4', track: 39 },
};

/** A track's file: a file of its own, or an entry of Tomb Raider III's cdaudio.wad. */
export interface ThemeFile {
    path: string;
    /** The track's place in cdaudio.wad, which holds them all. */
    wadEntry?: number;
}

/** The formats the games keep music in, the one browsers play most widely first. */
const EXTENSIONS = ['mp3', 'flac', 'ogg', 'wav'];

export const AUDIO_TYPES: Readonly<Record<string, string>> = {
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
};

/**
 * Finds a track among a game's files: music/track02.flac (Tomb Raider),
 * music/Track60.ogg or music/60.mp3 (II), audio/039_TR4_Title_Q10.wav (The
 * Last Revelation) or an entry of audio/cdaudio.wad (III).
 */
export function findThemeFile(paths: Iterable<string>, track: number): ThemeFile | null {
    let best: { path: string; rank: number } | null = null;
    let wad: string | null = null;
    for (const path of paths) {
        const lower = path.toLowerCase();
        if (!/(^|\/)(music|audio)\//.test(lower)) continue;
        const name = lower.slice(lower.lastIndexOf('/') + 1);
        if (name === 'cdaudio.wad') {
            wad ??= path;
            continue;
        }
        const dot = name.lastIndexOf('.');
        if (dot <= 0) continue;
        const rank = EXTENSIONS.indexOf(name.slice(dot + 1));
        if (rank < 0) continue;
        const stem = name.slice(0, dot);
        const number = /^(?:track)?0*(\d+)$/.exec(stem)?.[1] ?? /^0*(\d+)_/.exec(stem)?.[1];
        if (number === undefined || Number(number) !== track) continue;
        if (best === null || rank < best.rank) best = { path, rank };
    }
    if (best !== null) return { path: best.path };
    return wad !== null ? { path: wad, wadEntry: track } : null;
}

/** The file type of a theme file, from its name. */
export function themeType(path: string): string {
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    return AUDIO_TYPES[extension] ?? (extension === 'wad' ? 'audio/wav' : 'application/octet-stream');
}

/**
 * cdaudio.wad starts with a table of 130 entries, one per track: a name of
 * 260 bytes, then the size and offset of its WAV file, little-endian.
 */
export const WAD_TABLE_ENTRIES = 130;
export const WAD_ENTRY_BYTES = 268;
export const WAD_TABLE_BYTES = WAD_TABLE_ENTRIES * WAD_ENTRY_BYTES;

export function wadEntry(table: Uint8Array, index: number): { offset: number; size: number } | null {
    if (index < 0 || index >= WAD_TABLE_ENTRIES || table.length < (index + 1) * WAD_ENTRY_BYTES) return null;
    const view = new DataView(table.buffer, table.byteOffset + index * WAD_ENTRY_BYTES, WAD_ENTRY_BYTES);
    const size = view.getUint32(260, true);
    const offset = view.getUint32(264, true);
    return size > 0 ? { offset, size } : null;
}
