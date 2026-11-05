// Moves focus to the control that lies in a direction from the focused one,
// so arrow keys and a gamepad's d-pad walk any dialog's buttons the way
// they look on screen.

export type Direction = 'left' | 'right' | 'up' | 'down';

const FOCUSABLE =
    'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
    const fromX = from.left + from.width / 2;
    const fromY = from.top + from.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
        if (candidate === current) continue;
        const rect = candidate.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const dx = x - fromX;
        const dy = y - fromY;
        // How far along the direction, and how far off to the side.
        let along: number;
        let across: number;
        switch (direction) {
            case 'left':
                along = -dx;
                across = Math.abs(dy);
                break;
            case 'right':
                along = dx;
                across = Math.abs(dy);
                break;
            case 'up':
                along = -dy;
                across = Math.abs(dx);
                break;
            case 'down':
                along = dy;
                across = Math.abs(dx);
                break;
        }
        if (along <= 1) continue;
        const score = along + across * 2.5;
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    if (best === null) return false;
    best.focus();
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
}
