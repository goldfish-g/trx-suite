// Moves focus to the control that lies in a direction from the focused one,
// so arrow keys and a gamepad's d-pad walk any dialog's buttons the way
// they look on screen.

export type Direction = 'left' | 'right' | 'up' | 'down';

// Prompts are left out (tabindex -1): their own button presses them, so the
// d-pad walks only what they act on.
const FOCUSABLE = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]',
]
    .map((selector) => `${selector}:not([tabindex="-1"])`)
    .join(', ');

function isVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
}

export function focusables(container: ParentNode): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isVisible);
}

/** Focuses the first control in a container, or its marked default. */
export function focusFirst(container: HTMLElement | null): void {
    if (container === null) return;
    const preferred = container.querySelector<HTMLElement>('[data-autofocus]');
    const target = preferred !== null && isVisible(preferred) ? preferred : focusables(container)[0];
    target?.focus({ preventScroll: false });
}

interface Box {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/** How far boxes may overlap and still count as lying beyond one another. */
const SLACK = 4;

/** The gap between two spans, or 0 where they overlap. */
function gap(a0: number, a1: number, b0: number, b1: number): number {
    return Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));
}

/**
 * How good a step from one box to another is, lower being better, or null
 * when the other box does not lie that way: wholly beyond the edge the step
 * leaves by, give or take a few pixels, so a wide button never steps sideways
 * to a neighbour above or below it. Distances run between edges, so
 * a wide row right under a narrow button is the next stop down from it.
 */
export function stepScore(from: Box, to: Box, direction: Direction): number | null {
    const fromX = (from.left + from.right) / 2;
    const fromY = (from.top + from.bottom) / 2;
    const toX = (to.left + to.right) / 2;
    const toY = (to.top + to.bottom) / 2;
    let along: number;
    let across: number;
    let centres: number;
    switch (direction) {
        case 'left':
            if (to.right > from.left + SLACK) return null;
            along = Math.max(0, from.left - to.right);
            across = gap(from.top, from.bottom, to.top, to.bottom);
            centres = Math.abs(toY - fromY);
            break;
        case 'right':
            if (to.left < from.right - SLACK) return null;
            along = Math.max(0, to.left - from.right);
            across = gap(from.top, from.bottom, to.top, to.bottom);
            centres = Math.abs(toY - fromY);
            break;
        case 'up':
            if (to.bottom > from.top + SLACK) return null;
            along = Math.max(0, from.top - to.bottom);
            across = gap(from.left, from.right, to.left, to.right);
            centres = Math.abs(toX - fromX);
            break;
        case 'down':
            if (to.top < from.bottom - SLACK) return null;
            along = Math.max(0, to.top - from.bottom);
            across = gap(from.left, from.right, to.left, to.right);
            centres = Math.abs(toX - fromX);
            break;
    }
    return along + across * 3 + centres * 0.01;
}

/** Moves focus one step; returns whether it moved. */
export function moveFocus(container: HTMLElement, direction: Direction): boolean {
    const candidates = focusables(container);
    if (candidates.length === 0) return false;
    const current = document.activeElement instanceof HTMLElement && container.contains(document.activeElement)
        ? document.activeElement
        : null;
    if (current === null) {
        candidates[0]!.focus();
        return true;
    }
    const from = current.getBoundingClientRect();
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
        if (candidate === current || candidate.contains(current) || current.contains(candidate)) continue;
        const score = stepScore(from, candidate.getBoundingClientRect(), direction);
        if (score !== null && score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    if (best === null) return false;
    best.focus();
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
}
