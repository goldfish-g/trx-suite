// A panel that slides over the menu: from the right on wide screens, from
// the bottom on phones. Arrow keys and a d-pad walk its controls; Escape or
// B closes it.

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { onMenuAction } from '../input/controller';
import { focusFirst, moveFocus } from '../input/spatial';

interface Props {
    title: string;
    eyebrow?: string;
    onClose(): void;
    children: ReactNode;
    /** Wider content, such as lists of levels. */
    wide?: boolean;
}

export function Sheet({ title, eyebrow, onClose, children, wide }: Props) {
    const panel = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        // Wait a frame so the panel's content has rendered.
        const frame = requestAnimationFrame(() => focusFirst(panel.current));
        const stop = onMenuAction((action) => {
            const container = panel.current;
            if (container === null) return false;
            switch (action) {
                case 'back':
                    closeRef.current();
                    return true;
                case 'left':
                case 'right':
                case 'up':
                case 'down':
                    moveFocus(container, action);
                    return true;
                default:
                    // Everything else stays with the sheet, so the ring behind never moves.
                    return action !== 'confirm';
            }
        });
        return () => {
            cancelAnimationFrame(frame);
            stop();
            previous?.focus({ preventScroll: true });
        };
    }, []);

    // Keeps Tab inside the panel.
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Tab' || panel.current === null) return;
        const items = [...panel.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')].filter(
            (element) => !element.hasAttribute('disabled'),
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
                    <div>
                        {eyebrow ? <p className="sheet__eyebrow">{eyebrow}</p> : null}
                        <h2 className="sheet__title" id={titleId}>
                            {title}
                        </h2>
                    </div>
                    <button className="icon-button" onClick={onClose} aria-label="Close">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </header>
                <div className="sheet__body">{children}</div>
            </div>
        </div>
    );
}
