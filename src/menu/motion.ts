// Whether to keep movement down: the system setting, unless the player chose
// otherwise in the settings.

const KEY = 'trx-suite:reduced-motion';

export function reducedMotionChoice(): 'system' | 'on' | 'off' {
    try {
        const value = localStorage.getItem(KEY);
        return value === 'on' || value === 'off' ? value : 'system';
    } catch {
        return 'system';
    }
}

export function setReducedMotionChoice(choice: 'system' | 'on' | 'off'): void {
    try {
        if (choice === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, choice);
    } catch {
        // Not remembered.
    }
}

export function reducedMotion(): boolean {
    const choice = reducedMotionChoice();
    if (choice !== 'system') return choice === 'on';
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
