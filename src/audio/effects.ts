// The menu's sound effects: those of the game whose look the menus wear
// (Settings → Look), its own menu sounds, which the server reads out of
// the game (server/src/sounds.ts). They follow TRX's menus: the ring turns
// with its rotate sound, choosing makes its choose sound, going back its
// spin-out sound, a tab its passport page. Going from level to level among
// the custom levels is lighter: a moment of the passport's page, from where
// it starts to sound (well into the sample in II and III), equally loud in
// every game; going from button to button in a panel, such as the
// settings, makes the same sound. Tomb Raider III's ring
// slides on for most of a second, louder than the others: its turns are cut
// shorter and played softer.
//
// Quiet until the menu starts them, so the play page, which shares the
// input code, stays silent for the game's own sound.

import type { MenuSoundsManifest } from '../../shared/api.ts';
import type { MenuSound } from '../../shared/sounds.ts';
import type { Theme } from '../ui/gameArt/sheets';
import { useTheme } from '../ui/theme';
import { audioOutput } from './output';

export type Effect = 'browse' | 'turn' | 'press' | 'back' | 'tab';

interface Use {
    sound: MenuSound;
    gain: number;
    /** The longest it plays, in seconds; the whole sample if not given. */
    seconds?: number;
    /** Played from where the sample starts to sound, at this loudness (RMS, dB) whatever the game. */
    levelDb?: number;
}

function useOf(effect: Effect, look: Theme): Use {
    switch (effect) {
        case 'turn':
            return look === 'tr3' ? { sound: 'rotate', gain: 0.55, seconds: 0.32 } : { sound: 'rotate', gain: 1 };
        case 'browse':
            return { sound: 'passport', gain: 1, seconds: 0.14, levelDb: -30 };
        case 'press':
            return { sound: 'choose', gain: 1 };
        case 'back':
            return { sound: 'spinout', gain: 1 };
        case 'tab':
            return { sound: 'passport', gain: 1 };
    }
}

let enabled = false;
let manifest: Promise<MenuSoundsManifest | null> | null = null;
/** Decoded sounds, by address. */
const buffers = new Map<string, Promise<AudioBuffer | null>>();

/**
 * Where a sample starts to sound (a little before its first sample at a
 * third of its peak), and how loud it is, RMS in dB, over `seconds` from there.
 */
function onsetOf(buffer: AudioBuffer, seconds: number): { offset: number; db: number } {
    const samples = buffer.getChannelData(0);
    let peak = 0;
    for (const value of samples) peak = Math.max(peak, Math.abs(value));
    let first = 0;
    while (first < samples.length && Math.abs(samples[first]!) < peak / 3) first++;
    const start = Math.max(0, first - Math.round(buffer.sampleRate * 0.01));
    const end = Math.min(samples.length, start + Math.round(buffer.sampleRate * seconds));
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i]! ** 2;
    return { offset: start / buffer.sampleRate, db: 10 * Math.log10(sum / Math.max(1, end - start) + 1e-12) };
}

const onsets = new WeakMap<AudioBuffer, { offset: number; db: number }>();
/** The sound each effect last started, cut short when it starts again, as the games do. */
const playing = new Map<MenuSound, AudioBufferSourceNode>();
let lastAt = 0;

function loadManifest(): Promise<MenuSoundsManifest | null> {
    manifest ??= fetch('/sfx/manifest.json')
        .then((response) => (response.ok ? (response.json() as Promise<MenuSoundsManifest>) : null))
        .catch(() => null)
        .then((loaded) => {
            // Without it, ask again next time, once the connection may be back.
            if (loaded === null) manifest = null;
            return loaded;
        });
    return manifest;
}

function decode(url: string): Promise<AudioBuffer | null> {
    let buffer = buffers.get(url);
    if (buffer === undefined) {
        const output = audioOutput();
        buffer =
            output === null
                ? Promise.resolve(null)
                : fetch(url)
                      .then((response) => response.arrayBuffer())
                      .then((bytes) => output.context.decodeAudioData(bytes))
                      .catch(() => null);
        buffers.set(url, buffer);
    }
    return buffer;
}

/** Fetches and decodes the sounds of a look, ahead of their first use. */
async function prepare(look: Theme): Promise<void> {
    const sounds = (await loadManifest())?.looks[look];
    if (sounds !== undefined) for (const url of Object.values(sounds)) void decode(url);
}

/** The decoded sound, if it is ready; one still loading is skipped rather than played late. */
const ready = new Map<string, AudioBuffer | null>();

/** Plays an effect. Of effects within a few milliseconds of each other, such as a click and what it does, the first plays. */
export function playEffect(effect: Effect): void {
    if (!enabled) return;
    const output = audioOutput();
    if (output === null || output.context.state !== 'running') return;
    const now = performance.now();
    if (now - lastAt < 45) return;
    const look = useTheme.getState().theme;
    const { sound, gain: baseGain, seconds, levelDb } = useOf(effect, look);
    void loadManifest().then((loaded) => {
        const url = loaded?.looks[look]?.[sound];
        if (url === undefined) return;
        const buffer = ready.get(url);
        if (buffer === undefined) {
            void decode(url).then((decoded) => ready.set(url, decoded));
            return;
        }
        if (buffer === null) return;
        playing.get(sound)?.stop();
        const { context } = output;
        let offset = 0;
        let effectGain = baseGain;
        if (levelDb !== undefined) {
            let onset = onsets.get(buffer);
            if (onset === undefined) {
                onset = onsetOf(buffer, seconds ?? buffer.duration);
                onsets.set(buffer, onset);
            }
            offset = onset.offset;
            effectGain *= Math.min(3, Math.max(0.1, 10 ** ((levelDb - onset.db) / 20)));
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        const at = context.currentTime;
        gain.gain.setValueAtTime(effectGain, at);
        const cut = seconds !== undefined && buffer.duration - offset > seconds ? seconds : null;
        if (cut !== null) {
            // Cut short, with a quick fade so it does not click.
            const fade = Math.min(0.06, cut / 3);
            gain.gain.setValueAtTime(effectGain, at + cut - fade);
            gain.gain.linearRampToValueAtTime(0, at + cut);
        }
        source.connect(gain).connect(output.effects);
        source.onended = () => {
            gain.disconnect();
            if (playing.get(sound) === source) playing.delete(sound);
        };
        playing.set(sound, source);
        source.start(at, offset);
        if (cut !== null) source.stop(at + cut + 0.01);
    });
    lastAt = now;
}

const CLICKABLE = 'button, a[href], [role="radio"], .row, .level-card, .sheet-scrim, .details-scrim';
const GOES_BACK = '[data-action="back"], .sheet-scrim, .details-scrim';

/** A click's sound: tabs and the ring's arrows sound as they turn, not here. */
function onClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target.closest(CLICKABLE) : null;
    if (target === null || target.matches('[role="tab"], .ring-nav__button')) return;
    if (target instanceof HTMLButtonElement && target.disabled) return;
    playEffect(target.closest(GOES_BACK) !== null ? 'back' : 'press');
}

/** Loads the sounds of the look in use, and of each look picked later, and lets them play until the returned function is called. */
export function installEffects(): () => void {
    enabled = true;
    const track = (look: Theme) =>
        void prepare(look).then(async () => {
            const sounds = (await loadManifest())?.looks[look];
            for (const url of Object.values(sounds ?? {})) ready.set(url, await decode(url));
        });
    track(useTheme.getState().theme);
    const stopTracking = useTheme.subscribe((state) => track(state.theme));
    document.addEventListener('click', onClick, true);
    return () => {
        enabled = false;
        stopTracking();
        document.removeEventListener('click', onClick, true);
    };
}
