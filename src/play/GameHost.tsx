// Plays a game in a frame over the app's page (/play/<profile>), in place of
// the menu, which unmounts and lets go of its 3D scene, sound and memory.
// The page itself stays, so downloads carry on while the game plays; their
// unpacking and the cloud sync wait until it is over (lib/gameOpen.ts).
// Leaving the game removes the frame, and with it the engine.

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { cloudSyncSettled } from '../cloud/sync';
import { resumeInterruptedImports } from '../gamedata/imports';
import { pushLayer } from '../input/controller';
import { gameOpened } from '../lib/gameOpen';
import { closeGame, noteGameShown, offerGameHost, switchGame } from './pages';

/** How long a game waits for a cloud sync under way, which could write its saves as it reads them. */
const SYNC_WAIT_MS = 15_000;

export function GameHost() {
    const { pathname, search } = useLocation();
    const src = pathname + search;
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [ready, setReady] = useState(false);
    noteGameShown();

    // From here until the frame goes, unpacking and cloud syncs wait.
    useEffect(() => {
        const close = gameOpened();
        let cancelled = false;
        void Promise.race([cloudSyncSettled(), new Promise((resolve) => setTimeout(resolve, SYNC_WAIT_MS))]).then(() => {
            if (!cancelled) setReady(true);
        });
        // A page opened straight into a game carries on with the downloads too.
        void resumeInterruptedImports();
        return () => {
            cancelled = true;
            close();
        };
    }, []);

    // The menu's input listens on, as it does in every page; the game's frame
    // has its own. Nothing here may act on a button meant for the game.
    useEffect(() => pushLayer({ root: () => null, keepFocus: false, onAction: () => true }), []);

    useEffect(() => {
        document.title = 'Tombs Nexus';
        let filled = false;
        let closing = false;
        const stop = offerGameHost({
            // Once: a game may ask again on its way out.
            close: () => {
                if (closing) return;
                closing = true;
                closeGame();
            },
            switchTo: switchGame,
            setTitle: (title) => {
                document.title = title;
            },
            enterFullscreen: async () => {
                if (document.fullscreenElement === null) {
                    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
                    filled = true;
                }
                try {
                    await (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> }).lock?.('landscape');
                } catch {
                    // Not on this device; the game plays the way the screen is held.
                }
            },
        });
        return () => {
            stop();
            // Back in the menu as it was before the game: the page that held
            // the game used to go with it, and full screen with that.
            if (filled && document.fullscreenElement !== null) {
                (screen.orientation as ScreenOrientation & { unlock?(): void }).unlock?.();
                void document.exitFullscreen().catch(() => {});
            }
        };
    }, []);

    // Keys and buttons go to the focused page: the game's.
    useEffect(() => {
        if (!ready) return;
        const focus = () => {
            const frame = frameRef.current;
            if (frame === null || document.activeElement === frame) return;
            frame.focus();
            frame.contentWindow?.focus();
        };
        focus();
        window.addEventListener('focus', focus);
        return () => window.removeEventListener('focus', focus);
    }, [ready, src]);

    if (!ready) return <div className="game-frame" />;
    return (
        <iframe
            // A game picked in the engine plays in a fresh frame, with a fresh engine.
            key={src}
            ref={frameRef}
            className="game-frame"
            src={src}
            title="Game"
            allow="fullscreen; gamepad; autoplay; screen-wake-lock; cross-origin-isolated"
            onLoad={() => {
                frameRef.current?.focus();
                frameRef.current?.contentWindow?.focus();
            }}
        />
    );
}
