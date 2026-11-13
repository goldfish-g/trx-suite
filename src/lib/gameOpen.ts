// Whether a game is playing in this page, in its frame over the menu (see
// play/GameHost.tsx). Work that would take the game's main thread or write
// under it waits until the game is over: unpacking and converting what was
// downloaded, and cloud syncs. Downloads themselves carry on.

const target = new EventTarget();
let open = 0;

/** Marks a game as playing, until the returned function is called. */
export function gameOpened(): () => void {
    open++;
    let closed = false;
    return () => {
        if (closed) return;
        closed = true;
        open--;
        if (open === 0) target.dispatchEvent(new Event('closed'));
    };
}

export function isGameOpen(): boolean {
    return open > 0;
}

/** Calls listener each time the last game closes, until the returned function is called. */
export function onGameClosed(listener: () => void): () => void {
    target.addEventListener('closed', listener);
    return () => target.removeEventListener('closed', listener);
}

/** Resolves once no game is playing, at once when none is. */
export function whenNoGame(signal?: AbortSignal): Promise<void> {
    if (open === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const done = () => {
            stop();
            signal?.removeEventListener('abort', aborted);
            resolve();
        };
        const aborted = () => {
            stop();
            reject(signal!.reason);
        };
        const stop = onGameClosed(done);
        signal?.addEventListener('abort', aborted, { once: true });
    });
}
