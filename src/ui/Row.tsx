// A row of a list, such as a profile: one stop for the d-pad, whose actions
// are its own prompts, "(A) Play (X) Rename (Y) Delete". With a gamepad or a
// keyboard the prompts show while the row has focus; with a mouse or a finger
// they are buttons on the row, and tapping the row itself does its (A) action.

import type { MouseEvent, ReactNode } from 'react';

interface RowProps {
    children: ReactNode;
    /** Its prompts, of the row variant. */
    prompts?: ReactNode;
    autoFocus?: boolean;
    className?: string;
    label?: string;
}

export function Row({ children, prompts, autoFocus, className, label }: RowProps) {
    const click = (event: MouseEvent<HTMLLIElement>) => {
        if (event.target instanceof Element && event.target.closest('button, a, input, select, label')) return;
        event.currentTarget.querySelector<HTMLElement>('[data-action="confirm"]:not(:disabled)')?.click();
    };
    return (
        <li
            className={`row ${className ?? ''}`}
            tabIndex={0}
            data-scope=""
            data-autofocus={autoFocus ? '' : undefined}
            aria-label={label}
            onClick={click}
        >
            <div className="row__main">{children}</div>
            {prompts !== undefined ? <div className="row__prompts">{prompts}</div> : null}
        </li>
    );
}
