// Keeps the screen on while the app is in front. Phones dim and lock after a
// while without a touch, which happens during every FMV, and touching the
// screen to keep it awake skips the FMV.

type WakeLockSentinelLike = { released: boolean; addEventListener(type: 'release', listener: () => void): void };

export function keepScreenOn(): void {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } })
        .wakeLock;
    if (wakeLock === undefined) return;

    let held: WakeLockSentinelLike | null = null;
    let asking = false;
    const take = async () => {
        if (asking || document.visibilityState !== 'visible' || (held !== null && !held.released)) return;
        asking = true;
        try {
            held = await wakeLock.request('screen');
        } catch {
            // Refused, as in battery saver mode; the screen dims as usual.
        } finally {
            asking = false;
        }
    };

    // The browser lets go of the lock whenever the page is hidden, so it is
    // taken again on coming back. Some browsers grant it only after a gesture.
    document.addEventListener('visibilitychange', () => void take());
    window.addEventListener('pointerdown', () => void take());
    window.addEventListener('keydown', () => void take());
    void take();
}
