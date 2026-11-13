// The game's own settings start from the device the player picked the game
// up with. TRX shows the buttons of one device in its prompts, the one its
// Controls page last chose, and draws its touch controls while they are on.
// Before the game reads its settings, from cfg/TR<n>X.json5 in the profile's
// storage, the prompts take the device the player started with: a pad, the
// keyboard (or a mouse), or a finger, which alone brings the touch controls.

import type { InputDevice } from '../input/controller';
import type { EngineFs } from './types';

/** What the game's input settings say: its input.backend and input.enable_touch_controls. */
export interface StartInput {
    backend: 'keyboard' | 'controller' | 'touch';
    touchControls: boolean;
}

export function startInputFor(device: InputDevice): StartInput {
    switch (device) {
        case 'gamepad':
            return { backend: 'controller', touchControls: false };
        case 'touch':
            return { backend: 'touch', touchControls: true };
        default:
            return { backend: 'keyboard', touchControls: false };
    }
}

/** The languages a game's strings come in, from the names of its strings files: strings-de.json5 is German. */
export function languagesIn(names: readonly string[]): string[] {
    const codes = new Set<string>();
    for (const name of names) {
        const match = /^(?:base_)?strings(?:-([a-z0-9-]+))?\.json5$/i.exec(name);
        if (match) codes.add((match[1] ?? 'en').toLowerCase());
    }
    return [...codes];
}

const baseOf = (code: string) => code.toLowerCase().split('-')[0]!;

/**
 * The language TRX picks for a player's first game, as it does: the first of
 * their languages it has exactly, else one it has without a region, else one
 * of another region of it. Null when it has none of them.
 */
export function firstRunLanguage(preferred: readonly string[], available: readonly string[]): string | null {
    const passes: ((code: string, wanted: string) => boolean)[] = [
        (code, wanted) => code.toLowerCase() === wanted.toLowerCase(),
        (code, wanted) => !code.includes('-') && baseOf(code) === baseOf(wanted),
        (code, wanted) => baseOf(code) === baseOf(wanted),
    ];
    for (const accepts of passes) {
        for (const wanted of preferred) {
            if (wanted === '') continue;
            const code = available.find((candidate) => accepts(candidate, wanted));
            if (code !== undefined) return code;
        }
    }
    return null;
}

/**
 * Sets a top-level key in the file as the game writes it, two spaces in, and
 * leaves every other line as it was.
 */
function setTopLevel(text: string, key: string, value: string): string {
    const line = new RegExp(`^  "${key}"\\s*:.*?(,?)[ \\t]*$`, 'm');
    if (line.test(text)) return text.replace(line, (_whole, comma: string) => `  "${key}": ${value}${comma}`);
    if (/^\{\s*\}\s*$/.test(text)) return `{\n  "${key}": ${value}\n}`;
    return text.replace(/^\{[ \t]*\r?\n?/, (opening) => `{\n  "${key}": ${value},${opening.endsWith('\n') ? '\n' : ''}`);
}

/**
 * The settings file with the input the player starts with, or null to leave
 * it as it is: a file that does not parse is the game's to deal with. With no
 * file yet, the game would pick the player's language itself on its first
 * run; a file written for it takes that first run away, so it carries the
 * language the game would have picked.
 */
export function withStartInput(text: string | null, input: StartInput, language: string | null): string | null {
    if (text === null) {
        const settings = { ...(language === null ? {} : { language }), backend: input.backend, enable_touch_controls: input.touchControls };
        return JSON.stringify(settings, null, 2);
    }
    let settings: unknown;
    try {
        settings = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return null;
    const current = settings as Record<string, unknown>;
    if (current.backend === input.backend && current.enable_touch_controls === input.touchControls) return null;
    const edited = setTopLevel(setTopLevel(text, 'backend', JSON.stringify(input.backend)), 'enable_touch_controls', String(input.touchControls));
    try {
        const check = JSON.parse(edited) as Record<string, unknown>;
        if (check.backend === input.backend && check.enable_touch_controls === input.touchControls) return edited;
    } catch {
        // Written whole below instead.
    }
    return JSON.stringify({ ...current, backend: input.backend, enable_touch_controls: input.touchControls }, null, 2);
}

// A converted custom level can come with settings of its own, the ones its
// builder played it with (the converter keeps them as
// games/<mod>/starting_settings.json5): how it draws, its bars and menus, its
// sound. Playing the builder's archive, the engine would find them on its
// first run. Here they go over the player's settings once for each version
// of them, so a profile made before the level brought them gets them too,
// and whatever the player changes afterwards stays.

/** A short, stable name for a version of a game's starting settings. */
export function settingsVersion(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The settings file with a game's starting settings laid over it, or null
 * to leave it as it is: a file or starting settings that do not parse. With
 * no file yet, it starts with the language the game would have picked.
 */
export function withStartingSettings(text: string | null, starting: string, language: string | null): string | null {
    let laid: unknown;
    let current: unknown;
    try {
        laid = JSON.parse(starting);
        current = text === null ? (language === null ? {} : { language }) : JSON.parse(text);
    } catch {
        return null;
    }
    const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
    if (!isObject(laid) || !isObject(current)) return null;
    return JSON.stringify({ ...current, ...laid }, null, 2);
}

export interface StartSettings {
    /** The profile's storage for the mod, holding cfg/. */
    storagePath: string;
    /** The game's engine number, which names its settings file. */
    engine: number;
    /** The directories whose strings files say which languages the game has. */
    stringsDirs: readonly string[];
    /** Where the game keeps the settings it came with, if it has any. */
    startingSettingsPath?: string;
    device: InputDevice;
    /** The player's languages, most wanted first, as the browser lists them. */
    languages: readonly string[];
}

/**
 * Puts the settings the game came with, once, and the player's starting
 * device in the game's settings, before the game reads them.
 */
export function prepareStartSettings(fs: EngineFs, options: StartSettings): void {
    const path = `${options.storagePath}/cfg/TR${options.engine}X.json5`;
    const decoder = new TextDecoder();
    const exists = fs.analyzePath(path).exists;
    let text = exists ? decoder.decode(fs.readFile(path)) : null;
    let language: string | null = null;
    if (text === null) {
        const names = options.stringsDirs.flatMap((dir) => (fs.analyzePath(dir).exists ? fs.readdir(dir) : []));
        language = firstRunLanguage(options.languages, languagesIn(names));
    }

    // Which version of the game's starting settings this profile last took.
    const markPath = `${options.storagePath}/cfg/starting_settings.version`;
    let mark: string | null = null;
    const starting = options.startingSettingsPath !== undefined && fs.analyzePath(options.startingSettingsPath).exists
        ? decoder.decode(fs.readFile(options.startingSettingsPath))
        : null;
    let changed = false;
    if (starting !== null) {
        const version = settingsVersion(starting);
        const taken = fs.analyzePath(markPath).exists ? decoder.decode(fs.readFile(markPath)).trim() : null;
        if (taken !== version) {
            const laid = withStartingSettings(text, starting, language);
            if (laid !== null) {
                text = laid;
                mark = version;
                changed = true;
            }
        }
    }

    const next = withStartInput(text, startInputFor(options.device), language);
    if (next === null && !changed) return;
    fs.mkdirTree(`${options.storagePath}/cfg`);
    fs.writeFile(path, new TextEncoder().encode(next ?? text!));
    if (mark !== null) fs.writeFile(markPath, new TextEncoder().encode(mark));
}
