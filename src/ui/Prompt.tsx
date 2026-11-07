// Button prompts: the one way to act in the menus. A prompt names an action
// and shows the glyph of the device in hand, such as (A) on an Xbox pad,
// (✕) on a PlayStation one or Enter on a keyboard; pressing that button does
// it. With a mouse or a finger, the glyph goes and the prompt is a button.

import type { MouseEvent, ReactNode } from 'react';
import { KEY_LABELS, useInputDevice, type MenuAction, type PadStyle } from '../input/controller';

/** An action, or both horizontal directions at once, as "choose" hints show them. */
export type GlyphName = MenuAction | 'horizontal';

const FACE: Record<'confirm' | 'back' | 'alternate' | 'extra', number> = { confirm: 0, back: 1, alternate: 2, extra: 3 };

/** Xbox letters and colours, by standard button number. */
const XBOX = [
    { text: 'A', color: '#7ccf5a' },
    { text: 'B', color: '#ef6b5c' },
    { text: 'X', color: '#5ea2ef' },
    { text: 'Y', color: '#f2cc4b' },
];

/** Nintendo prints its letters the other way round from where Xbox has them. */
const NINTENDO = ['B', 'A', 'Y', 'X'];

const PLAYSTATION_COLORS = ['#8fb4ef', '#ef7f7f', '#e39ad3', '#5fd1b0'];

function PlayStationShape({ index }: { index: number }) {
    switch (index) {
        case 0:
            return <path d="M8.5 8.5l7 7m0-7l-7 7" />;
        case 1:
            return <circle cx="12" cy="12" r="4.2" />;
        case 2:
            return <rect x="8" y="8" width="8" height="8" rx="0.6" />;
        default:
            return <path d="M12 7.6l4.6 8H7.4z" />;
    }
}

function FaceButton({ index, pad }: { index: number; pad: PadStyle }) {
    if (pad === 'playstation') {
        return (
            <svg className="glyph glyph--face" viewBox="0 0 24 24" aria-hidden="true" style={{ color: PLAYSTATION_COLORS[index] }}>
                <circle className="glyph__disc" cx="12" cy="12" r="11" />
                <g className="glyph__mark">
                    <PlayStationShape index={index} />
                </g>
            </svg>
        );
    }
    const xbox = XBOX[index]!;
    const text = pad === 'nintendo' ? NINTENDO[index]! : xbox.text;
    return (
        <svg
            className="glyph glyph--face"
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{ color: pad === 'nintendo' ? 'var(--ink)' : xbox.color }}
        >
            <circle className="glyph__disc" cx="12" cy="12" r="11" />
            <text x="12" y="16.4" textAnchor="middle" className="glyph__letter">
                {text}
            </text>
        </svg>
    );
}

const SHOULDERS: Record<PadStyle, [string, string]> = {
    xbox: ['LB', 'RB'],
    playstation: ['L1', 'R1'],
    nintendo: ['L', 'R'],
};

const START: Record<PadStyle, string> = { xbox: '≡', playstation: 'Options', nintendo: '+' };

/** The small button left of the face buttons: two windows on Xbox. */
function ViewButton({ pad }: { pad: PadStyle }) {
    if (pad === 'playstation') return <span className="glyph glyph--pill">Create</span>;
    if (pad === 'nintendo') return <span className="glyph glyph--pill">−</span>;
    return (
        <span className="glyph glyph--pill" aria-hidden="true">
            <svg className="glyph__view" viewBox="0 0 16 12">
                <rect x="1" y="1" width="9" height="7" rx="1" />
                <rect x="6" y="4" width="9" height="7" rx="1" />
            </svg>
        </span>
    );
}

function DPad({ lit }: { lit: 'left' | 'right' | 'up' | 'down' | 'horizontal' }) {
    const on = (side: string) => (lit === side || (lit === 'horizontal' && (side === 'left' || side === 'right')) ? 'glyph__lit' : '');
    return (
        <svg className="glyph glyph--dpad" viewBox="0 0 24 24" aria-hidden="true">
            <path className={on('up')} d="M9.5 2.5h5v6l-2.5 2.5-2.5-2.5z" />
            <path className={on('down')} d="M9.5 21.5h5v-6l-2.5-2.5-2.5 2.5z" />
            <path className={on('left')} d="M2.5 9.5v5h6l2.5-2.5-2.5-2.5z" />
            <path className={on('right')} d="M21.5 9.5v5h-6l-2.5-2.5 2.5-2.5z" />
        </svg>
    );
}

/** The glyph for an action on the device in hand; nothing for a mouse or a finger. */
export function Glyph({ name }: { name: GlyphName }) {
    const { device, pad } = useInputDevice();
    if (device === 'mouse' || device === 'touch') return null;
    if (device === 'keyboard') {
        const text = name === 'horizontal' ? '← →' : KEY_LABELS[name];
        return <kbd className="glyph glyph--key">{text}</kbd>;
    }
    if (name === 'horizontal' || name === 'left' || name === 'right' || name === 'up' || name === 'down') return <DPad lit={name} />;
    if (name === 'previous' || name === 'next') {
        return <span className="glyph glyph--pill">{SHOULDERS[pad][name === 'previous' ? 0 : 1]}</span>;
    }
    if (name === 'menu') return <span className="glyph glyph--pill">{START[pad]}</span>;
    if (name === 'view') return <ViewButton pad={pad} />;
    return <FaceButton index={FACE[name]} pad={pad} />;
}

interface PromptProps {
    action: MenuAction;
    label: ReactNode;
    /** Without it the prompt is only a hint, which a mouse or a finger has no use for. */
    onPress?(): void;
    /** Answers its button anywhere on the screen, not just in the focused row. */
    global?: boolean;
    disabled?: boolean;
    /** primary: the screen's main action; chip: up in a corner; row: inside a list row. */
    variant?: 'primary' | 'chip' | 'row' | 'quiet' | 'danger';
    /** Shown in place of the glyph for a mouse or a finger, such as a gear for Settings. */
    icon?: ReactNode;
    className?: string;
    title?: string;
}

export function Prompt({ action, label, onPress, global, disabled, variant, icon, className, title }: PromptProps) {
    const device = useInputDevice((state) => state.device);
    const pointer = device === 'mouse' || device === 'touch';
    const classes = ['prompt', variant ? `prompt--${variant}` : '', className ?? ''].filter(Boolean).join(' ');
    if (onPress === undefined) {
        if (pointer) return null;
        return (
            <span className={`${classes} prompt--hint`}>
                <Glyph name={action} />
                <span className="prompt__label">{label}</span>
            </span>
        );
    }
    const click = (event: MouseEvent<HTMLButtonElement>) => {
        // A prompt inside a row acts on the row, not as a click on the row
        // itself, and leaves the focus on the row, which outlasts the prompt.
        event.stopPropagation();
        event.currentTarget.closest<HTMLElement>('[data-scope]')?.focus({ preventScroll: true });
        onPress();
    };
    return (
        <button
            type="button"
            className={classes}
            data-action={action}
            data-global={global ? '' : undefined}
            disabled={disabled}
            tabIndex={-1}
            title={title}
            onClick={click}
        >
            {pointer ? icon : <Glyph name={action} />}
            <span className="prompt__label">{label}</span>
        </button>
    );
}

/** A hint for moving about, such as "(◀▶) Choose", for a gamepad or keyboard only. */
export function MoveHint({ name, label }: { name: GlyphName; label: string }) {
    const device = useInputDevice((state) => state.device);
    if (device === 'mouse' || device === 'touch') return null;
    return (
        <span className="prompt prompt--hint">
            <Glyph name={name} />
            <span className="prompt__label">{label}</span>
        </span>
    );
}

/** A row of prompts along the bottom of a screen or panel. */
export function PromptBar({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={`prompt-bar ${className ?? ''}`}>{children}</div>;
}
