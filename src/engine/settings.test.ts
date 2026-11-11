import { describe, expect, it } from 'vitest';
import { firstRunLanguage, languagesIn, startInputFor, withStartInput } from './settings';

// A settings file as TRX writes it: two spaces in, keys in its own order.
const WRITTEN = `{
  "config_version": 2,
  "language": "de",
  "brightness": 1.0,
  "backend": "keyboard",
  "enable_touch_controls": true,
  "keyboard_layout": 0
}`;

describe('the device a game starts with', () => {
    it('picks the prompts, and brings the touch controls for a finger alone', () => {
        expect(startInputFor('gamepad')).toEqual({ backend: 'controller', touchControls: false });
        expect(startInputFor('touch')).toEqual({ backend: 'touch', touchControls: true });
        expect(startInputFor('keyboard')).toEqual({ backend: 'keyboard', touchControls: false });
        expect(startInputFor('mouse')).toEqual({ backend: 'keyboard', touchControls: false });
    });

    it('changes those two settings and leaves every other line as the game wrote it', () => {
        const next = withStartInput(WRITTEN, startInputFor('gamepad'), null)!;
        expect(next).toBe(WRITTEN.replace('"backend": "keyboard"', '"backend": "controller"').replace('"enable_touch_controls": true', '"enable_touch_controls": false'));
        // 1.0 stays 1.0, which JSON.stringify would have made 1.
        expect(next).toContain('"brightness": 1.0,');
    });

    it('adds them to a file that lacks them', () => {
        const next = withStartInput('{\n  "language": "fr"\n}', startInputFor('touch'), null)!;
        expect(JSON.parse(next)).toEqual({ language: 'fr', backend: 'touch', enable_touch_controls: true });
    });

    it('leaves alone a file that already says so, or that does not parse', () => {
        expect(withStartInput(WRITTEN, { backend: 'keyboard', touchControls: true }, null)).toBeNull();
        expect(withStartInput('{ broken', startInputFor('gamepad'), null)).toBeNull();
    });

    it('writes a first file with the language the game would have picked on its first run', () => {
        expect(JSON.parse(withStartInput(null, startInputFor('gamepad'), 'de')!)).toEqual({ language: 'de', backend: 'controller', enable_touch_controls: false });
        expect(JSON.parse(withStartInput(null, startInputFor('keyboard'), null)!)).toEqual({ backend: 'keyboard', enable_touch_controls: false });
    });
});

describe('the language of a first run', () => {
    const available = languagesIn(['base_strings.json5', 'base_strings-de.json5', 'base_strings-en-gb.json5', 'strings-pl.json5', 'gameflow.json5', 'base_strings-de.json5']);

    it('comes in the languages the strings files are in', () => {
        expect(available.sort()).toEqual(['de', 'en', 'en-gb', 'pl']);
    });

    it('is picked as TRX picks it', () => {
        expect(firstRunLanguage(['de-DE', 'en-US'], available)).toBe('de');
        expect(firstRunLanguage(['en-GB'], available)).toBe('en-gb');
        expect(firstRunLanguage(['en-US'], available)).toBe('en');
        // A language it lacks gives way to the next one the player reads.
        expect(firstRunLanguage(['pt-BR', 'pl'], available)).toBe('pl');
        // Only a region it has: another region of the language.
        expect(firstRunLanguage(['en-AU'], ['en-gb'])).toBe('en-gb');
        expect(firstRunLanguage(['pt-BR'], available)).toBeNull();
    });
});
