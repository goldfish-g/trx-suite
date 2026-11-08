// The menus' look: the menus of Tomb Raider, II or III, as the player picks
// in the settings. It sets html[data-theme], which the styles dress by, and
// the font sheet the game's lettering is drawn from. The pick follows the
// player to their other devices through the cloud: the latest pick wins.

import { create } from 'zustand';
import { requestCloudSync } from '../lib/changes';
import type { Theme } from './gameArt/sheets';

export const THEMES: readonly { theme: Theme; label: string }[] = [
    { theme: 'tr1', label: 'Tomb Raider' },
    { theme: 'tr2', label: 'Tomb Raider II' },
    { theme: 'tr3', label: 'Tomb Raider III' },
];

const KEY = 'trx-suite:theme';
/** When the player picked it, here or on another device; unset until they do. */
const PICKED_KEY = 'trx-suite:theme-picked';

function isTheme(value: unknown): value is Theme {
    return THEMES.some((entry) => entry.theme === value);
}

function remembered(): Theme {
    try {
        const value = localStorage.getItem(KEY);
        return isTheme(value) ? value : 'tr1';
    } catch {
        return 'tr1';
    }
}

export const useTheme = create<{ theme: Theme }>(() => ({ theme: remembered() }));

function keep(theme: Theme, pickedAt: string): void {
    try {
        localStorage.setItem(KEY, theme);
        localStorage.setItem(PICKED_KEY, pickedAt);
    } catch {
        // Not remembered.
    }
    useTheme.setState({ theme });
}

/** The player picks a look. */
export function setTheme(theme: Theme): void {
    keep(theme, new Date().toISOString());
    requestCloudSync();
}

/** The look as picked, and when; pickedAt is null if the player never picked one here. */
export function themePick(): { theme: Theme; pickedAt: string | null } {
    let pickedAt: string | null = null;
    try {
        pickedAt = localStorage.getItem(PICKED_KEY);
    } catch {
        // Never picked, as far as this device knows.
    }
    return { theme: useTheme.getState().theme, pickedAt };
}

/** Takes a look the player picked on another device, if it is one this app has. */
export function adoptTheme(theme: string, pickedAt: string): void {
    if (isTheme(theme)) keep(theme, pickedAt);
}

/** Keeps html[data-theme] on the player's choice. */
export function applyTheme(): void {
    const root = document.documentElement;
    root.dataset.theme = useTheme.getState().theme;
    useTheme.subscribe((state) => {
        root.dataset.theme = state.theme;
    });
}
