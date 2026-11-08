// A panel that slides over the menu: from the right on wide screens, from
// the bottom on phones. The d-pad and arrow keys walk its controls, (A)
// presses the focused one, and (B) goes back; its prompts sit along the
// bottom. With a mouse or a finger, Back is a button up in the panel's
// corner, and the bottom row shows only for prompts of the panel's own.

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { pushLayer, useInputDevice } from '../input/controller';
import { focusFirst } from '../input/spatial';
import { GameText } from './GameText';
import { Prompt, PromptBar } from './Prompt';

interface Props {
    title: string;
    eyebrow?: string;
    onClose(): void;
    children: ReactNode;
    /** Wider content, such as lists of levels. */
    wide?: boolean;
    /** Prompts of the panel's own, beside Back. */
    prompts?: ReactNode;
}

export function Sheet({ title, eyebrow, onClose, children, wide, prompts }: Props) {
    const panel = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    const pointer = useInputDevice((state) => state.device === 'mouse' || state.device === 'touch');

    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        // Wait a frame so the panel's content has rendered.
        const frame = requestAnimationFrame(() => focusFirst(panel.current));
        // Going from button to button makes the light sound of going from level to level.
        const pop = pushLayer({ root: () => panel.current, onBack: () => closeRef.current(), moveSound: 'browse' });
        return () => {
            cancelAnimationFrame(frame);
            pop();
            previous?.focus({ preventScroll: true });
        };
    }, []);

    // Keeps Tab inside the panel.
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Tab' || panel.current === null) return;
        const items = [...panel.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]')].filter(
            (element) => !element.hasAttribute('disabled') && element.tabIndex >= 0,
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (first === undefined || last === undefined) return;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    return (
        <div className="sheet-layer">
            <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
            <div
                ref={panel}
                className={`sheet ${wide ? 'sheet--wide' : ''}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onKeyDown={onKeyDown}
            >
                <header className="sheet__header">
                    <div className="sheet__titles">
                        {eyebrow ? <p className="sheet__eyebrow">{eyebrow}</p> : null}
                        <h2 className={`sheet__title ${title.length > 16 ? 'sheet__title--long' : ''}`} id={titleId}>
                            <GameText text={title} />
                        </h2>
                    </div>
                    {pointer ? <Prompt action="back" label="Back" global onPress={onClose} className="sheet__back" /> : null}
                </header>
                <div className="sheet__body">{children}</div>
                {!pointer || prompts !== undefined ? (
                    <PromptBar className="sheet__prompts">
                        <Prompt action="confirm" label="Select" />
                        {prompts}
                        {pointer ? null : <Prompt action="back" label="Back" global onPress={onClose} className="prompt-bar__end" />}
                    </PromptBar>
                ) : null}
            </div>
        </div>
    );
}
