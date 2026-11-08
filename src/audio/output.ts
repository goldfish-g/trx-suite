// Where the menu's sound goes: one audio context, a bus for the music and
// one for the sound effects, each at the volume picked in the settings.
//
// Browsers keep a page quiet until the player first taps, clicks or presses
// a key in it (an installed app may play at once). The context is made when
// the menu opens and woken by that first touch, in the touch's own event,
// where the browser allows it. A gamepad's buttons do not count.

import { create } from 'zustand';

export type VolumeLevel = 'off' | 'low' | 'medium' | 'high';

export const VOLUME_LEVELS: readonly { level: VolumeLevel; label: string }[] = [
    { level: 'off', label: 'Off' },
    { level: 'low', label: 'Low' },
    { level: 'medium', label: 'Medium' },
    { level: 'high', label: 'High' },
];

/** The games' music is mastered loud; the menu keeps it behind the effects. */
const MUSIC_GAIN: Record<VolumeLevel, number> = { off: 0, low: 0.15, medium: 0.35, high: 0.7 };
const EFFECTS_GAIN: Record<VolumeLevel, number> = { off: 0, low: 0.3, medium: 0.6, high: 1 };

const MUSIC_KEY = 'trx-suite:music-volume';
const EFFECTS_KEY = 'trx-suite:effects-volume';

function remembered(key: string): VolumeLevel {
    try {
        const value = localStorage.getItem(key);
        return VOLUME_LEVELS.some((entry) => entry.level === value) ? (value as VolumeLevel) : 'medium';
    } catch {
        return 'medium';
    }
}

export const useSoundSettings = create<{ music: VolumeLevel; effects: VolumeLevel }>(() => ({
    music: remembered(MUSIC_KEY),
    effects: remembered(EFFECTS_KEY),
}));

function keep(key: string, level: VolumeLevel): void {
    try {
        localStorage.setItem(key, level);
    } catch {
        // Not remembered.
    }
}

export function setMusicVolume(level: VolumeLevel): void {
    keep(MUSIC_KEY, level);
    useSoundSettings.setState({ music: level });
}

export function setEffectsVolume(level: VolumeLevel): void {
    keep(EFFECTS_KEY, level);
    useSoundSettings.setState({ effects: level });
}

interface Output {
    context: AudioContext;
    music: GainNode;
    effects: GainNode;
}

let output: Output | null = null;
const wakers = new Set<() => void>();

/** The context and its buses, made on first use. */
export function audioOutput(): Output | null {
    if (output !== null) return output;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Context === undefined) return null;
    const context = new Context();
    const music = context.createGain();
    const effects = context.createGain();
    music.connect(context.destination);
    effects.connect(context.destination);
    output = { context, music, effects };
    const apply = ({ music: musicLevel, effects: effectsLevel }: { music: VolumeLevel; effects: VolumeLevel }) => {
        music.gain.value = MUSIC_GAIN[musicLevel];
        effects.gain.value = EFFECTS_GAIN[effectsLevel];
    };
    apply(useSoundSettings.getState());
    useSoundSettings.subscribe(apply);
    return output;
}

/** Whether sound reaches the speakers now. */
export function audible(): boolean {
    return output?.context.state === 'running' && !document.hidden;
}

/**
 * Runs `wake` inside the first tap, click or key press, when the browser
 * lets the page start sound; and again whenever the page comes back into
 * view. Returns a function that stops it.
 */
export function onWake(wake: () => void): () => void {
    wakers.add(wake);
    return () => wakers.delete(wake);
}

/** Wakes the context in the events that may start sound, and lets it sleep while the page is hidden. */
export function installAudioWake(): () => void {
    const wake = () => {
        const current = audioOutput();
        if (current === null || document.hidden) return;
        if (current.context.state !== 'running') void current.context.resume().catch(() => undefined);
        for (const waker of wakers) waker();
    };
    const visibility = () => {
        const current = output;
        if (current === null) return;
        if (document.hidden) void current.context.suspend().catch(() => undefined);
        else wake();
    };
    const events = ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const;
    for (const event of events) window.addEventListener(event, wake, { capture: true, passive: true });
    document.addEventListener('visibilitychange', visibility);
    return () => {
        for (const event of events) window.removeEventListener(event, wake, { capture: true });
        document.removeEventListener('visibilitychange', visibility);
    };
}
