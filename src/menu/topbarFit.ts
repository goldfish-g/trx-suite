// The home screen's bar keeps all its buttons on the screen. Where they do
// not fit beside the brand with their names, Settings and the update show
// only their icons; where even that is too wide, the account too. Which
// names give way depends on the window, the player's names, the device in
// hand and the look's lettering, so the bar measures itself rather than
// going by the window's width. The styles hide the names by data-fit.

import { useLayoutEffect, type RefObject } from 'react';

/** From every name shown to none: each step gives up more of them. */
const STEPS = [null, 'icons', 'all-icons'] as const;

/** Whether the buttons end inside the bar, the account's name with all its words. */
function fits(bar: HTMLElement, actions: HTMLElement): boolean {
    const end = bar.getBoundingClientRect().right - parseFloat(getComputedStyle(bar).paddingRight);
    if (actions.getBoundingClientRect().right > end + 0.5) return false;
    // A name short of room wraps its last words out of sight before the
    // buttons overflow. Names too long for the account's widest chip always
    // do, which says nothing about the room.
    const account = actions.querySelector<HTMLElement>('.topbar__account');
    const words = account?.querySelectorAll<HTMLElement>('.gt__word') ?? [];
    const first = words[0];
    const last = words[words.length - 1];
    if (!account || !first || !last || last.getBoundingClientRect().top - first.getBoundingClientRect().top < 1) return true;
    return account.getBoundingClientRect().width >= parseFloat(getComputedStyle(account).maxWidth) - 1;
}

function fit(bar: HTMLElement, actions: HTMLElement): void {
    for (const step of STEPS) {
        if (step === null) delete bar.dataset.fit;
        else bar.dataset.fit = step;
        if (fits(bar, actions)) return;
    }
}

/**
 * Fits the bar now, before it shows, and again whenever its size or its
 * buttons' size changes. `buttons` names the buttons it has, so that one
 * coming or going is fitted before it shows too.
 */
export function useTopbarFit(barRef: RefObject<HTMLElement | null>, buttons: string): void {
    useLayoutEffect(() => {
        const bar = barRef.current;
        const actions = bar?.querySelector<HTMLElement>('.topbar__actions');
        if (!bar || !actions) return;
        fit(bar, actions);
        // A frame later: fitting in the observer itself would resize what it
        // observes while it reports, which the browser takes for a loop.
        let frame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => fit(bar, actions));
        });
        observer.observe(bar);
        observer.observe(actions);
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [barRef, buttons]);
}
