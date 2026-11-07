import { describe, expect, it } from 'vitest';
import { KEY_LABELS, KEYS, padStyleOf } from './controller';
import { stepScore } from './spatial';

const box = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });

describe('stepping the focus', () => {
    // A narrow button above a wide row, with another narrow button below the row.
    const play = box(0, 0, 180, 50);
    const row = box(0, 80, 400, 60);
    const newProfile = box(0, 160, 150, 40);

    it('goes down to the wide row right under a narrow button, not past it', () => {
        expect(stepScore(play, row, 'down')!).toBeLessThan(stepScore(play, newProfile, 'down')!);
    });

    it('prefers what lines up over what is merely near', () => {
        const below = box(0, 100, 100, 40);
        const offToTheSide = box(300, 70, 100, 40);
        expect(stepScore(play, below, 'down')!).toBeLessThan(stepScore(play, offToTheSide, 'down')!);
    });

    it('never steps the wrong way', () => {
        expect(stepScore(row, play, 'down')).toBeNull();
        expect(stepScore(play, row, 'up')).toBeNull();
        expect(stepScore(box(200, 0, 50, 50), box(0, 0, 50, 50), 'right')).toBeNull();
    });

    it('does not step sideways from a wide button to one above it', () => {
        const wide = box(0, 100, 300, 44);
        const above = box(200, 40, 60, 40);
        expect(stepScore(wide, above, 'right')).toBeNull();
        expect(stepScore(wide, above, 'up')).not.toBeNull();
    });

    it('walks a row of buttons left and right', () => {
        const a = box(0, 0, 80, 40);
        const b = box(90, 0, 80, 40);
        const c = box(180, 0, 80, 40);
        expect(stepScore(a, b, 'right')!).toBeLessThan(stepScore(a, c, 'right')!);
        expect(stepScore(c, b, 'left')!).toBeLessThan(stepScore(c, a, 'left')!);
    });
});

describe('gamepads', () => {
    it('wear the glyphs of their maker', () => {
        expect(padStyleOf('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
        expect(padStyleOf('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
        expect(padStyleOf('054c-09cc-Wireless Controller')).toBe('playstation');
        expect(padStyleOf('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('nintendo');
        expect(padStyleOf('8BitDo SN30 Pro (Vendor: 2dc8)')).toBe('xbox');
    });
});

describe('keys', () => {
    it('show on every prompt the key that does it', () => {
        for (const [key, action] of Object.entries(KEYS)) {
            if (key.length === 1 && key !== ' ') expect(KEY_LABELS[action].toLowerCase()).toBe(key);
        }
        expect(KEYS.Enter).toBe('confirm');
        expect(KEYS.Escape).toBe('back');
    });
});
