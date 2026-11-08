// Button prompts: the one way to act in the menus. A prompt names an action
// and shows the glyph of the device in hand, such as (A) on an Xbox pad,
// (✕) on a PlayStation one or Enter on a keyboard; pressing that button does
// it. With a mouse or a finger, the glyph goes and the prompt is a button.
// The glyphs are TRX's own, the ones the games show in their prompts.

import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { KEY_LABELS, useInputDevice, type MenuAction, type PadStyle } from '../input/controller';
import { SHEETS, type IconName } from './gameArt/sheets';
import { GameText } from './GameText';
import { useTheme } from './theme';

/** An action, or both horizontal directions at once, as "choose" hints show them. */
export type GlyphName = MenuAction | 'horizontal';

type PadAction = Exclude<MenuAction, 'left' | 'right' | 'up' | 'down'>;

/** A TRX icon, or a cap with a few letters on it where TRX has no icon. */
type Art = IconName | { cap: string };

const PAD: Record<PadStyle, Record<PadAction, Art>> = {
    xbox: {
        confirm: 'controller button a',
        back: 'controller button b',
        alternate: 'controller button x',
        extra: 'controller button y',
        previous: 'controller bumper left',
        next: 'controller bumper right',
        sectionPrevious: 'controller trigger left',
        sectionNext: 'controller trigger right',
        // TRX's START and BACK are as wide as words; the old marks fit a chip.
        menu: { cap: '≡' },
        view: { cap: '⧉' },
    },
    playstation: {
        confirm: 'controller button cross',
        back: 'controller button circle',
        alternate: 'controller button square',
        extra: 'controller button triangle',
        previous: 'controller button l1',
        next: 'controller button r1',
        sectionPrevious: 'controller button l2',
        sectionNext: 'controller button r2',
        menu: 'controller button options',
        view: 'controller button share',
    },
    // Nintendo prints its letters the other way round from where Xbox has them.
    nintendo: {
        confirm: 'controller button b',
        back: 'controller button a',
        alternate: 'controller button y',
        extra: 'controller button x',
        previous: { cap: 'L' },
        next: { cap: 'R' },
        sectionPrevious: { cap: 'ZL' },
        sectionNext: { cap: 'ZR' },
        menu: { cap: '+' },
        view: { cap: '−' },
    },
};

const ARROW_KEYS: Record<string, string> = { '←': 'left', '→': 'right', '↑': 'up', '↓': 'down', Enter: 'return', Esc: 'escape' };

/** The keycap of the key an action shows on a keyboard prompt. */
function keyArt(action: MenuAction): Art {
    const label = KEY_LABELS[action];
    const name = `keyboard ${ARROW_KEYS[label] ?? label.toLowerCase()}`;
    return name in SHEETS.tr1.icons ? (name as IconName) : { cap: label };
}

function GlyphArt({ art }: { art: Art }) {
    const theme = useTheme((state) => state.theme);
    if (typeof art !== 'string') return <span className="glyph glyph--cap">{art.cap}</span>;
    const [x, y, w, h] = SHEETS[theme].icons[art];
    const style = { '--x': x, '--y': y, '--w': w, '--h': h } as CSSProperties;
    return <i className={`glyph glyph--art glyph--${art.split(' ')[0]}`} style={style} />;
}

/** The glyph for an action on the device in hand; nothing for a mouse or a finger. */
export function Glyph({ name }: { name: GlyphName }) {
    const { device, pad } = useInputDevice();
    if (device === 'mouse' || device === 'touch') return null;
    let art: Art[];
    if (name === 'horizontal') {
        art = device === 'keyboard' ? [keyArt('left'), keyArt('right')] : ['controller dpad left', 'controller dpad right'];
    } else if (device === 'keyboard') {
        art = [keyArt(name)];
    } else if (name === 'left' || name === 'right' || name === 'up' || name === 'down') {
        art = [`controller dpad ${name}`];
    } else {
        art = [PAD[pad][name]];
    }
    return (
        <span className="glyphs" aria-hidden="true">
            {art.map((part, index) => (
                <GlyphArt key={index} art={part} />
            ))}
        </span>
    );
}

/** A prompt's label: in the game's lettering when it is plain text. */
function Label({ label }: { label: ReactNode }) {
    return <span className="prompt__label">{typeof label === 'string' ? <GameText text={label} /> : label}</span>;
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
    /**
     * With a mouse or a finger, where room is short, only its icon shows (the
     * styles say where); its name stays as a tooltip and for screen readers.
     */
    iconic?: boolean;
}

export function Prompt({ action, label, onPress, global, disabled, variant, icon, className, title, iconic }: PromptProps) {
    const device = useInputDevice((state) => state.device);
    const pointer = device === 'mouse' || device === 'touch';
    const classes = ['prompt', variant ? `prompt--${variant}` : '', iconic ? 'prompt--iconic' : '', className ?? ''].filter(Boolean).join(' ');
    if (onPress === undefined) {
        if (pointer) return null;
        return (
            <span className={`${classes} prompt--hint`}>
                <Glyph name={action} />
                <Label label={label} />
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
            title={title ?? (iconic && pointer && typeof label === 'string' ? label : undefined)}
            onClick={click}
        >
            {pointer ? icon : <Glyph name={action} />}
            <Label label={label} />
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
            <Label label={label} />
        </span>
    );
}

/** A row of prompts along the bottom of a screen or panel. */
export function PromptBar({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={`prompt-bar ${className ?? ''}`}>{children}</div>;
}
