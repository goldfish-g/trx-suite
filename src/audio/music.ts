// The menu's music: the main theme of the game whose level flies by,
// looping. When the next level comes from a game with another theme, the
// music fades out while that level loads, and the new theme starts, at
// once, when the level shows. Between two levels of games that share a
// theme (an expansion and its game) it plays on.
//
// One audio element plays every theme in turn: Safari lets a page start an
// element by itself only once the player has started that element, so the
// first tap or key press starts it, with a moment of silence if no theme
// has loaded yet.
//
// Chrome on Android sometimes leaves the element playing with nothing
// reaching the speakers, and tapping does not wake it: the element says it
// plays, so there is nothing to start again. Loading the theme afresh, as
// going to another game's level does, brings it back. So the music listens
// to itself, and a theme that stays silent while it should be heard is
// loaded again.

import { pcmWav } from './wav';
import { audible, audioOutput, onWake } from './output';
import type { MenuTheme } from './themes';

const FADE_SECONDS = 1.6;
/** Quieter than this is silence. */
const SILENT_PEAK = 1e-4;
/**
 * How long a theme may be silent while it plays before it is taken to be
 * stuck: just started, it sounds within a third of a second (the rest is
 * for a busy phone to get going); once heard, the longest silence is
 * where Tomb Raider II's theme loops, 3.5 seconds.
 */
const STUCK_BEFORE_HEARD_MS = 2500;
const STUCK_AFTER_HEARD_MS = 5000;
/** Times in a row a silent theme is loaded again, before the music stops trying. */
const MAX_RELOADS = 3;
const LISTEN_EVERY_MS = 250;

interface Player {
    element: HTMLAudioElement;
    /** What the element sends on, for the music to listen to itself. */
    analyser: AnalyserNode;
    samples: Float32Array<ArrayBuffer>;
    gain: GainNode;
}

let player: Player | null = null;
/** The theme the element holds, its file, and that file's address. */
let current: { key: string; blob: Blob; url: string } | null = null;
/** Since when the theme has been silent while it should be heard, whether it has been heard since it started, and how often it has been loaded again. */
const listening = { quietSince: 0, heard: false, reloads: 0 };
/** The theme of the level on screen, which should be playing. */
let wanted: MenuTheme | null = null;
/** Ends when the music that was playing has faded out. */
let fading: Promise<void> = Promise.resolve();
let primed = false;
/** Loads under way or done, by theme, for the last two themes asked for. */
const loads = new Map<string, Promise<Blob | null>>();

function getPlayer(): Player | null {
    if (player !== null) return player;
    const output = audioOutput();
    if (output === null) return null;
    const element = new Audio();
    element.loop = true;
    const analyser = output.context.createAnalyser();
    analyser.fftSize = 2048;
    const gain = output.context.createGain();
    output.context.createMediaElementSource(element).connect(analyser).connect(gain).connect(output.music);
    player = { element, analyser, samples: new Float32Array(analyser.fftSize), gain };
    return player;
}

function load(theme: MenuTheme): Promise<Blob | null> {
    let loading = loads.get(theme.key);
    if (loading === undefined) {
        loading = theme.load().catch((error: unknown) => {
            console.warn(`[music] the ${theme.key} theme could not be played:`, error);
            return null;
        });
        loads.set(theme.key, loading);
        while (loads.size > 2) loads.delete(loads.keys().next().value!);
    }
    return loading;
}

function silence(): void {
    if (player !== null) {
        player.element.pause();
        player.element.removeAttribute('src');
        player.element.load();
    }
    if (current !== null) URL.revokeObjectURL(current.url);
    current = null;
}

function fadeOut(): void {
    const playing = current;
    // Nothing playing, or already on its way out.
    if (playing === null || playing.key === '' || player === null) return;
    const output = audioOutput();
    if (output === null || !audible() || player.element.paused) {
        silence();
        return;
    }
    // From now on the element plays nothing anyone asked for.
    current = { ...playing, key: '' };
    const { gain } = player;
    const now = output.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
    fading = new Promise<void>((resolve) => setTimeout(resolve, FADE_SECONDS * 1000)).then(() => {
        if (current?.url === playing.url) silence();
    });
}

/** Plays a theme from its start, or from `at` seconds into it. */
function start(key: string, blob: Blob, at = 0): void {
    const playing = getPlayer();
    if (playing === null) return;
    silence();
    const output = audioOutput()!;
    playing.gain.gain.cancelScheduledValues(output.context.currentTime);
    playing.gain.gain.value = 1;
    const url = URL.createObjectURL(blob);
    playing.element.src = url;
    if (at > 0) playing.element.currentTime = at;
    current = { key, blob, url };
    listening.quietSince = performance.now();
    listening.heard = false;
    resume();
}

/** Loads the theme again if it plays but nothing is heard (see the top of this file). */
function listen(): void {
    const now = performance.now();
    const playing = player;
    if (playing === null || current === null || current.key === '' || playing.element.paused || !audible()) {
        // Silent on purpose, or for want of a tap: nothing to fix.
        listening.quietSince = now;
        return;
    }
    playing.analyser.getFloatTimeDomainData(playing.samples);
    let peak = 0;
    for (const sample of playing.samples) peak = Math.max(peak, Math.abs(sample));
    if (peak >= SILENT_PEAK) {
        listening.quietSince = now;
        listening.heard = true;
        listening.reloads = 0;
        return;
    }
    const limit = listening.heard ? STUCK_AFTER_HEARD_MS : STUCK_BEFORE_HEARD_MS;
    if (now - listening.quietSince < limit || listening.reloads >= MAX_RELOADS) return;
    listening.reloads++;
    console.warn(`[music] the ${current.key} theme plays but nothing is heard: loading it again`);
    // Where it was if it had been heard, else from the start, which nobody heard.
    start(current.key, current.blob, listening.heard ? playing.element.currentTime : 0);
}

/** Plays what should be playing, if the page may make sound now. */
function resume(): void {
    const playing = getPlayer();
    if (playing === null || document.hidden) return;
    if (current === null) {
        // Nothing to play yet: start the element on silence, so it may start the theme by itself later.
        if (!primed) {
            primed = true;
            playing.element.src = SILENCE;
            playing.element.play().then(
                () => {
                    if (current === null) playing.element.pause();
                },
                () => (primed = false),
            );
        }
        return;
    }
    if (current.key === '' || !playing.element.paused) return;
    playing.element.play().catch(() => {
        // Not allowed yet: the first tap or key press tries again.
    });
}

async function playWanted(): Promise<void> {
    const theme = wanted;
    if (theme === null) return;
    const blob = await load(theme);
    // The music that was playing goes out first.
    await fading;
    if (wanted !== theme || blob === null || current?.key === theme.key) return;
    listening.reloads = 0;
    start(theme.key, blob);
}

/** The level coming next is from this game: other music fades out while it loads. */
export function nextTheme(theme: MenuTheme | null): void {
    if (current !== null && current.key !== theme?.key) fadeOut();
    if (theme !== null) void load(theme);
}

/** This game's level is on screen: its theme plays, unless it already does. */
export function showTheme(theme: MenuTheme | null): void {
    wanted = theme;
    if (theme === null) {
        fadeOut();
        return;
    }
    if (current?.key === theme.key) {
        resume();
        return;
    }
    void playWanted();
}

/** Starts the music when the browser allows it, and pauses it with the page. */
export function installMusic(): () => void {
    const stopWaking = onWake(resume);
    const visibility = () => {
        if (document.hidden) player?.element.pause();
    };
    document.addEventListener('visibilitychange', visibility);
    const listener = setInterval(listen, LISTEN_EVERY_MS);
    return () => {
        stopWaking();
        clearInterval(listener);
        document.removeEventListener('visibilitychange', visibility);
        silence();
        wanted = null;
    };
}

/** A tenth of a second of silence. */
const SILENCE = URL.createObjectURL(new Blob([pcmWav(new Int16Array(2205), 1, 22050)], { type: 'audio/wav' }));
