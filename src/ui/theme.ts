// The menus' look: the menus of Tomb Raider, II or III, as the player picks
// in the settings. It sets html[data-theme], which the styles dress by, and
// the font sheet the game's lettering is drawn from.

import { create } from 'zustand';
import type { Theme } from './gameArt/sheets';

export const THEMES: readonly { theme: Theme; label: string }[] = [
    { theme: 'tr1', label: 'Tomb Raider' },
    { theme: 'tr2', label: 'Tomb Raider II' },
    { theme: 'tr3', label: 'Tomb Raider III' },
];

const KEY = 'trx-suite:theme';

function remembered(): Theme {
    try {
        const value = localStorage.getItem(KEY);
        return THEMES.some((entry) => entry.theme === value) ? (value as Theme) : 'tr1';
    } catch {
        return 'tr1';
    }
}

export const useTheme = create<{ theme: Theme }>(() => ({ theme: remembered() }));

export function setTheme(theme: Theme): void {
    try {
        localStorage.setItem(KEY, theme);
    } catch {
        // Not remembered.
    }
    useTheme.setState({ theme });
}

/** Keeps html[data-theme] on the player's choice. */
export function applyTheme(): void {
    const root = document.documentElement;
    root.dataset.theme = useTheme.getState().theme;
    useTheme.subscribe((state) => {
        root.dataset.theme = state.theme;
    });
}
