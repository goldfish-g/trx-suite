// The menu's sound: the theme of the game flying by, and its effects.

import { installEffects } from './effects';
import { nextTheme, installMusic, showTheme } from './music';
import { installAudioWake } from './output';

export { nextTheme, showTheme };
export { playEffect } from './effects';
export type { MenuTheme } from './themes';

/** Starts the menu's sound until the returned function is called. */
export function startMenuAudio(): () => void {
    const stops = [installAudioWake(), installMusic(), installEffects()];
    return () => stops.forEach((stop) => stop());
}
