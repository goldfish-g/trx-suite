// The sounds of each game's own menus, which the app's menus make in the
// look of that game (Settings → Look): the ids of their samples in each
// game (TRX's data/<game>/catalog_samples.csv), and what each is for, as
// TRX's own menus use them (its ui/flat_menu/sound.lua and ui/ring).

export type MenuSound = 'rotate' | 'choose' | 'spinout' | 'passport';

export const MENU_SOUND_IDS: Readonly<Record<'tr1' | 'tr2' | 'tr3', Readonly<Record<MenuSound, number>>>> = {
    tr1: { rotate: 108, choose: 111, spinout: 112, passport: 115 },
    tr2: { rotate: 108, choose: 111, spinout: 112, passport: 115 },
    tr3: { rotate: 108, choose: 109, spinout: 112, passport: 115 },
};

/** Where each game's title level and sounds are, by game, in its own files or an expansion's. */
export const MENU_SOUND_SOURCES: Readonly<Record<'tr1' | 'tr2' | 'tr3', readonly string[]>> = {
    tr1: ['tr1', 'tr1-ub'],
    tr2: ['tr2', 'tr2-gm'],
    tr3: ['tr3', 'tr3-la'],
};
