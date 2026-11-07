// One stream of menu actions from every input device: gamepads first, then
// the keyboard, the mouse and touch. The menus are built for a gamepad: every
// action is a button prompt on screen, such as "(A) Play". A prompt shows the
// glyph of the device in hand, and with a mouse or a finger it is simply a
// button to click or tap.
//
// Screens stack as layers; the topmost one hears every action, so nothing
// leaks to the screen underneath. An action goes, in order, to:
//   1. the layer's own handler, such as the ring turning on left and right;
//   2. the prompt for it in the focused row (an element marked data-scope),
//      such as "(X) Rename" on a profile;
//   3. the layer's own prompt for it (marked data-global), such as "(B) Back";
//   4. the default: directions move the focus the way the screen looks,
//      confirm presses the focused control, and back closes the layer.

import { create } from 'zustand';
import { focusables, moveFocus } from './spatial';

export type MenuAction =
    | 'left'
    | 'right'
    | 'up'
    | 'down'
    /** A, Enter: the focused control, or the screen's main action. */
    | 'confirm'
    /** B, Escape. */
    | 'back'
    /** X, F. */
    | 'alternate'
    /** Y, R. */
    | 'extra'
    /** Start, M. */
    | 'menu'
    /** View / Select, V. */
    | 'view'
    /** Left bumper, Q. */
    | 'previous'
    /** Right bumper, E. */
    | 'next';

export type InputDevice = 'keyboard' | 'gamepad' | 'mouse' | 'touch';

/** Which face-button glyphs a gamepad wears. */
export type PadStyle = 'xbox' | 'playstation' | 'nintendo';

interface InputState {
    device: InputDevice;
    pad: PadStyle;
}

const REMEMBERED = 'trx-suite:input';
const DEVICES: readonly InputDevice[] = ['keyboard', 'gamepad', 'mouse', 'touch'];
const PADS: readonly PadStyle[] = ['xbox', 'playstation', 'nintendo'];

/**
 * The device used last, remembered across pages: a game started with a
 * gamepad shows gamepad prompts on its start screen before any button.
 */
function initialState(): InputState {
    const pointer: InputDevice = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
    try {
        const [device, pad] = (sessionStorage.getItem(REMEMBERED) ?? '').split(':');
        return {
            device: DEVICES.includes(device as InputDevice) ? (device as InputDevice) : pointer,
            pad: PADS.includes(pad as PadStyle) ? (pad as PadStyle) : 'xbox',
        };
    } catch {
        return { device: pointer, pad: 'xbox' };
    }
}

/** The kind of device the player used last, which the prompts follow. */
export const useInputDevice = create<InputState>(initialState);

function noteDevice(device: InputDevice, pad?: PadStyle): void {
    const state = useInputDevice.getState();
    if (state.device === device && (pad === undefined || state.pad === pad)) return;
    useInputDevice.setState(pad === undefined ? { device } : { device, pad });
}

/** Tells a pad's glyphs from its id, as browsers report it. */
export function padStyleOf(id: string): PadStyle {
    if (/054c|playstation|dualsense|dualshock|wireless controller/i.test(id)) return 'playstation';
    if (/057e|nintendo|pro controller|joy-con/i.test(id)) return 'nintendo';
    return 'xbox';
}

// ------------------------------------------------------------- layers

export interface Layer {
    /** The element holding the layer's controls. */
    root(): HTMLElement | null;
    /** Sees each action first; returns true to keep it. */
    onAction?(action: MenuAction, repeat: boolean): boolean;
    /** Back, when no prompt claims it. */
    onBack?(): void;
    /**
     * Whether a gamepad or keyboard should always have something focused in
     * the layer. Off for screens driven by prompts alone, like the ring.
     */
    keepFocus?: boolean;
}

const layers: Layer[] = [];

/** Puts a layer on top until the returned function takes it off. */
export function pushLayer(layer: Layer): () => void {
    layers.push(layer);
    return () => {
        const index = layers.lastIndexOf(layer);
        if (index >= 0) layers.splice(index, 1);
    };
}

const DIRECTIONS = new Set<MenuAction>(['left', 'right', 'up', 'down']);

function promptFor(container: Element, action: MenuAction, selector = ''): HTMLElement | null {
    if (container.matches(`[data-action="${action}"]${selector}`)) return container as HTMLElement;
    return container.querySelector<HTMLElement>(`[data-action="${action}"]${selector}:not(:disabled)`);
}

function press(element: HTMLElement): boolean {
    if (element instanceof HTMLButtonElement && element.disabled) return false;
    element.click();
    return true;
}

/**
 * After an action, such as deleting the focused row, the focus may be gone
 * from the layer; a gamepad or keyboard then gets it back on the first control.
 */
function refocusLater(layer: Layer): void {
    requestAnimationFrame(() =>
        requestAnimationFrame(() => {
            const device = useInputDevice.getState().device;
            if (layers[layers.length - 1] === layer && (device === 'gamepad' || device === 'keyboard')) focusSomething();
        }),
    );
}

/** Hands an action to the topmost layer; returns whether there was one. */
export function dispatch(action: MenuAction, repeat = false): boolean {
    const layer = layers[layers.length - 1];
    if (layer === undefined) return false;
    const handled = route(layer, action, repeat);
    if (!DIRECTIONS.has(action)) refocusLater(layer);
    return handled;
}

function route(layer: Layer, action: MenuAction, repeat: boolean): boolean {
    if (layer.onAction?.(action, repeat) === true) return true;
    const root = layer.root();
    if (root === null) return true;

    if (DIRECTIONS.has(action)) {
        if (layer.keepFocus !== false) moveFocus(root, action as 'left' | 'right' | 'up' | 'down');
        return true;
    }
    if (repeat) return true;

    const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
    const scope = focused?.closest<HTMLElement>('[data-scope]');
    if (scope !== null && scope !== undefined && root.contains(scope)) {
        const prompt = promptFor(scope, action);
        if (prompt !== null) return press(prompt) || true;
    }
    const global = promptFor(root, action, '[data-global]');
    if (global !== null) return press(global) || true;

    if (action === 'confirm' && focused !== null && focused.matches('button, a[href], [role="button"], input[type="checkbox"]')) {
        press(focused);
    } else if (action === 'back') {
        layer.onBack?.();
    }
    return true;
}

/** Whether the top layer keeps a focus and has none right now. */
function needsFocus(): boolean {
    const layer = layers[layers.length - 1];
    if (layer === undefined || layer.keepFocus === false) return false;
    const root = layer.root();
    return root !== null && !(document.activeElement instanceof HTMLElement && root.contains(document.activeElement));
}

/** Focuses the layer's first control, when a gamepad or keyboard arrives and nothing has focus. */
function focusSomething(): void {
    const layer = layers[layers.length - 1];
    if (layer === undefined || layer.keepFocus === false) return;
    const root = layer.root();
    if (root === null) return;
    if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) return;
    const preferred = root.querySelector<HTMLElement>('[data-autofocus]');
    (preferred ?? focusables(root)[0])?.focus({ preventScroll: true });
}

// ------------------------------------------------------------- keyboard

export const KEYS: Record<string, MenuAction> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    Enter: 'confirm',
    ' ': 'confirm',
    Escape: 'back',
    Backspace: 'back',
    f: 'alternate',
    r: 'extra',
    m: 'menu',
    v: 'view',
    q: 'previous',
    e: 'next',
    PageUp: 'previous',
    PageDown: 'next',
};

/** The key each action shows on a keyboard prompt. */
export const KEY_LABELS: Record<MenuAction, string> = {
    left: '←',
    right: '→',
    up: '↑',
    down: '↓',
    confirm: 'Enter',
    back: 'Esc',
    alternate: 'F',
    extra: 'R',
    menu: 'M',
    view: 'V',
    previous: 'Q',
    next: 'E',
};

function isTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
    return target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit'].includes(target.type);
}

function onKeyDown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const action = KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (action === undefined) return;
    // Text fields keep their keys, apart from Escape and Enter.
    if (isTyping(event.target) && event.key !== 'Escape' && event.key !== 'Enter') return;
    const wasKeyboard = useInputDevice.getState().device === 'keyboard';
    noteDevice('keyboard');
    if (layers.length === 0) return;
    // The first key only shows where the focus is.
    if (!wasKeyboard && DIRECTIONS.has(action) && needsFocus()) {
        focusSomething();
        event.preventDefault();
        return;
    }
    // A focused button answers Enter and Space itself.
    if (action === 'confirm' && (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement)) return;
    if (dispatch(action, event.repeat)) event.preventDefault();
}

// ------------------------------------------------------------- gamepads

/** Standard-mapping button numbers. */
const PAD_BUTTONS: [number, MenuAction][] = [
    [0, 'confirm'], // A / Cross / B on Nintendo
    [1, 'back'], // B / Circle / A on Nintendo
    [2, 'alternate'], // X / Square / Y on Nintendo
    [3, 'extra'], // Y / Triangle / X on Nintendo
    [4, 'previous'], // left bumper
    [5, 'next'], // right bumper
    [8, 'view'], // View / Create / −
    [9, 'menu'], // Start / Options / +
    [12, 'up'],
    [13, 'down'],
    [14, 'left'],
    [15, 'right'],
];

const REPEAT_DELAY_MS = 380;
const REPEAT_EVERY_MS = 110;
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
                const wasPad = useInputDevice.getState().device === 'gamepad';
                noteDevice('gamepad', padStyleOf(pad.id));
                // The first press only shows where the focus is, unless it is a face button.
                if (!wasPad && DIRECTIONS.has(action) && needsFocus()) focusSomething();
                else dispatch(action, false);
            } else if (DIRECTIONS.has(action) && now - state.since > REPEAT_DELAY_MS && now - state.last > REPEAT_EVERY_MS) {
                state.last = now;
                dispatch(action, true);
            }
        }
    }
    for (const key of held.keys()) if (!pressedNow.has(key)) held.delete(key);
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
    const root = document.documentElement;
    root.dataset.input = useInputDevice.getState().device;
    root.dataset.pad = useInputDevice.getState().pad;
    useInputDevice.subscribe((state) => {
        root.dataset.input = state.device;
        root.dataset.pad = state.pad;
        try {
            sessionStorage.setItem(REMEMBERED, `${state.device}:${state.pad}`);
        } catch {
            // Forgotten on the next page, which then waits for a press.
        }
    });
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
