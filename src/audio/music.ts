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

import { pcmWav } from './wav';
import { audible, audioOutput, onWake } from './output';
import type { MenuTheme } from './themes';

const FADE_SECONDS = 1.6;

interface Player {
    element: HTMLAudioElement;
    gain: GainNode;
}

let player: Player | null = null;
/** The theme the element holds, and its file's address. */
let current: { key: string; url: string } | null = null;
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
    const gain = output.context.createGain();
    output.context.createMediaElementSource(element).connect(gain).connect(output.music);
    player = { element, gain };
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
    current = { key: '', url: playing.url };
    const { gain } = player;
    const now = output.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
    fading = new Promise<void>((resolve) => setTimeout(resolve, FADE_SECONDS * 1000)).then(() => {
        if (current?.url === playing.url) silence();
    });
}

function start(key: string, blob: Blob): void {
    const playing = getPlayer();
    if (playing === null) return;
    silence();
    const output = audioOutput()!;
    playing.gain.gain.cancelScheduledValues(output.context.currentTime);
    playing.gain.gain.value = 1;
    const url = URL.createObjectURL(blob);
    playing.element.src = url;
    current = { key, url };
    resume();
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
    return () => {
        stopWaking();
        document.removeEventListener('visibilitychange', visibility);
        silence();
        wanted = null;
    };
}

/** A tenth of a second of silence. */
const SILENCE = URL.createObjectURL(new Blob([pcmWav(new Int16Array(2205), 1, 22050)], { type: 'audio/wav' }));
