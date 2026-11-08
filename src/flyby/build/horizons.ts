// TR4 draws a sky only over the levels its script says to, tinted per
// level. These are the script's settings, as TRX's TR4 gameflow gives them
// (setup_horizon, layer 0): levels missing here have no sky.

export interface Horizon {
    /** The cloud layer's tint, where 1 leaves the sky texture as it is. */
    tint: readonly [number, number, number];
}

const COLOURS: Record<string, string> = {
    'alexhub.tr4': '#808080',
    'alexhub2.tr4': '#808080',
    'ang_race.tr4': '#A0A0C0',
    'angkor1.tr4': '#A0A0C0',
    'bikebit.tr4': '#384808',
    'citnew.tr4': '#384808',
    'cortyard.tr4': '#384808',
    'hall.tr4': '#806040',
    'highstrt.tr4': '#384808',
    'jeepchas.tr4': '#C080C0',
    'jeepchs2.tr4': '#FF8070',
    'joby1a.tr4': '#401008',
    'joby3a.tr4': '#401008',
    'joby3b.tr4': '#401008',
    'joby4a.tr4': '#401008',
    'joby4b.tr4': '#401008',
    'joby4c.tr4': '#401008',
    'joby5a.tr4': '#401008',
    'karnak1.tr4': '#806040',
    'lake.tr4': '#806040',
    'lowstrt.tr4': '#384808',
    'nutrench.tr4': '#384808',
    'title.tr4': '#808080',
    'train.tr4': '#C0A0C0',
};

/** The sky a TR4 level shows, by its file name, or null for none. */
export function tr4Horizon(fileName: string): Horizon | null {
    const colour = COLOURS[fileName.toLowerCase()];
    if (colour === undefined) return null;
    const value = Number.parseInt(colour.slice(1), 16);
    // The script's colours count 128 as full strength.
    return { tint: [((value >> 16) & 0xff) / 128, ((value >> 8) & 0xff) / 128, (value & 0xff) / 128] };
}
