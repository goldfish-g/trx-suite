// One stream of menu actions from every input device: keyboard, gamepads,
// mouse and touch. Screens listen for actions instead of keys, so a
// gamepad, a keyboard and a remote all drive the same menus. It also
// remembers which kind of device the player used last, for the hints.

import { create } from 'zustand';

export type MenuAction = 'left' | 'right' | 'up' | 'down' | 'confirm' | 'back' | 'menu' | 'alternate' | 'previous' | 'next';

export type InputDevice = 'keyboard' | 'gamepad' | 'mouse' | 'touch';

interface InputState {
    device: InputDevice;
}

/** The kind of device the player used last. */
export const useInputDevice = create<InputState>(() => ({
    device: matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse',
}));

function noteDevice(device: InputDevice): void {
    if (useInputDevice.getState().device !== device) useInputDevice.setState({ device });
}

type Listener = (action: MenuAction, event: { repeat: boolean; device: InputDevice }) => boolean | void;

// Listeners stack: the newest (the open dialog) hears actions first and may
// claim them by returning true.
const listeners: Listener[] = [];

export function onMenuAction(listener: Listener): () => void {
    listeners.push(listener);
    return () => {
        const index = listeners.lastIndexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
    };
}

function dispatch(action: MenuAction, repeat: boolean, device: InputDevice): boolean {
    for (let i = listeners.length - 1; i >= 0; i--) {
        if (listeners[i]!(action, { repeat, device }) === true) return true;
    }
    return false;
}

const KEYS: Record<string, MenuAction> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    Enter: 'confirm',
    ' ': 'confirm',
    Escape: 'back',
    Backspace: 'back',
    PageUp: 'previous',
    PageDown: 'next',
};

function isTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
    return target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit'].includes(target.type);
}

function onKeyDown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    noteDevice('keyboard');
    const action = KEYS[event.key];
    if (action === undefined) return;
    // Text fields keep their keys, apart from Escape.
    if (isTyping(event.target) && action !== 'back') return;
    if (isTyping(event.target) && event.key === 'Backspace') return;
    // Buttons answer Enter and Space themselves; let them, unless a listener wants it.
    const onButton = event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement;
    if (action === 'confirm' && onButton) return;
    if (dispatch(action, event.repeat, 'keyboard')) event.preventDefault();
}

// ------------------------------------------------------------- gamepads

/** Standard-mapping button numbers. */
const PAD_BUTTONS: [number, MenuAction][] = [
    [0, 'confirm'], // A / Cross
    [1, 'back'], // B / Circle
    [2, 'alternate'], // X / Square
    [3, 'menu'], // Y / Triangle
    [4, 'previous'], // left bumper
    [5, 'next'], // right bumper
    [9, 'menu'], // Start / Options
    [12, 'up'],
    [13, 'down'],
    [14, 'left'],
    [15, 'right'],
];

const REPEAT_DELAY_MS = 420;
const REPEAT_EVERY_MS = 130;
const held = new Map<string, { since: number; last: number }>();

function padPressed(pad: Gamepad): Set<MenuAction> {
    const pressed = new Set<MenuAction>();
    for (const [index, action] of PAD_BUTTONS) {
        if (pad.buttons[index]?.pressed) pressed.add(action);
    }
    const [x = 0, y = 0] = pad.axes;
    if (x < -0.55) pressed.add('left');
    if (x > 0.55) pressed.add('right');
    if (y < -0.55) pressed.add('up');
    if (y > 0.55) pressed.add('down');
    return pressed;
}

const REPEATING = new Set<MenuAction>(['left', 'right', 'up', 'down']);

function pollGamepads(now: number): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pressedNow = new Set<string>();
    for (const pad of pads) {
        if (pad === null || !pad.connected) continue;
        for (const action of padPressed(pad)) {
            const key = `${pad.index}:${action}`;
            pressedNow.add(key);
            const state = held.get(key);
            if (state === undefined) {
                held.set(key, { since: now, last: now });
                noteDevice('gamepad');
                // Unclaimed, A presses the focused button, as Enter would.
                if (!dispatch(action, false, 'gamepad') && action === 'confirm') clickFocused();
            } else if (REPEATING.has(action) && now - state.since > REPEAT_DELAY_MS && now - state.last > REPEAT_EVERY_MS) {
                state.last = now;
                dispatch(action, true, 'gamepad');
            }
        }
    }
    for (const key of held.keys()) if (!pressedNow.has(key)) held.delete(key);
}

let lastConfirmClick = 0;

/**
 * A gamepad has no Enter key: when nobody claimed its confirm button, it
 * presses the focused control.
 */
function clickFocused(): void {
    queueMicrotask(() => {
        const now = performance.now();
        if (now - lastConfirmClick < 50) return;
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body && active.matches('button, a[href], [role="button"], input[type="checkbox"]')) {
            lastConfirmClick = now;
            active.click();
        }
    });
}

let polling: ReturnType<typeof setInterval> | null = null;

/**
 * Reads the pads on a timer rather than once a frame: a heavy frame on a
 * slow phone must not swallow a quick tap of a button.
 */
function startPolling(): void {
    if (polling !== null) return;
    polling = setInterval(() => {
        const anyPad = (navigator.getGamepads?.() ?? []).some((pad) => pad !== null);
        if (!anyPad && polling !== null) {
            clearInterval(polling);
            polling = null;
            return;
        }
        pollGamepads(performance.now());
    }, 16);
}

// ------------------------------------------------------------- setup

let installed = false;

/** Starts listening to the devices, once per page. */
export function installInput(): void {
    if (installed) return;
    installed = true;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', (event) => noteDevice(event.pointerType === 'touch' ? 'touch' : 'mouse'), {
        capture: true,
        passive: true,
    });
    window.addEventListener('wheel', () => noteDevice('mouse'), { capture: true, passive: true });
    window.addEventListener('gamepadconnected', startPolling);
    // Some browsers report pads only after a button press, without the event.
    startPolling();
}

/** Lets a dialog's own buttons fire the actions too, e.g. on-screen hints. */
export function triggerMenuAction(action: MenuAction): void {
    dispatch(action, false, useInputDevice.getState().device);
}
