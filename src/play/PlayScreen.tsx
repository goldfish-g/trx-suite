import { useEffect, useRef, useState, type RefObject } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { checkBrowserSupport, runSession, type SessionStage } from '../engine/session';
import { KEYS, pushLayer } from '../input/controller';
import { getProfile } from '../profiles/store';
import { formatBytes } from '../ui/format';
import { GameText } from '../ui/GameText';
import { ProgressBar } from '../ui/ProgressBar';
import { Prompt, PromptBar } from '../ui/Prompt';

type ScreenState = SessionStage | { kind: 'loading' } | { kind: 'error'; message: string };

const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches;

/** Fills the screen on phones and tablets, sideways when the device allows. */
async function enterFullscreen(): Promise<void> {
    try {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> }).lock?.('landscape');
    } catch {
        // The game plays the same in a window.
    }
}

function leave(): void {
    location.assign('/');
}

/** Starts the game from the gate, full screen on a phone. */
function start(pass: () => void): void {
    if (isTouchDevice()) void enterFullscreen();
    pass();
}

export function PlayScreen() {
    const { profileId } = useParams<{ profileId: string }>();
    // Another game the player switched to in the engine, which this page plays instead of the profile's own.
    const mod = useSearchParams()[0].get('mod') ?? undefined;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [state, setState] = useState<ScreenState>({ kind: 'loading' });
    const [notice, setNotice] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        const fail = (message: string) => {
            if (!controller.signal.aborted) setState({ kind: 'error', message });
        };
        (async () => {
            const unsupported = checkBrowserSupport();
            if (unsupported !== null) return fail(unsupported);
            const profile = profileId === undefined ? undefined : await getProfile(profileId);
            if (profile === undefined) return fail('This profile does not exist any more.');
            document.title = `${profile.name} · TRX`;
            await runSession({
                profile,
                mod,
                canvas: canvasRef.current!,
                signal: controller.signal,
                onStage: (stage) => {
                    setNotice(null);
                    setState(stage);
                },
                // A page of its own for each game, as for each session.
                onSwitchMod: (next) =>
                    location.replace(next === profile.mod ? `/play/${profile.id}` : `/play/${profile.id}?mod=${encodeURIComponent(next)}`),
                onRetry: ({ waitMs, reason }) =>
                    setNotice(`Connection lost (${reason}). Trying again in ${Math.ceil(waitMs / 1000)} s…`),
            });
            leave();
        })().catch((error: unknown) => {
            if (controller.signal.aborted) return;
            console.error(error);
            fail(error instanceof Error ? error.message : String(error));
        });
        return () => controller.abort();
    }, [profileId, mod]);

    // The engine hears keys only while the canvas has focus, which nothing
    // gives it once the start button goes. Focus it whenever the game runs,
    // and take it back if a key lands anywhere else.
    const running = state.kind === 'running';
    useEffect(() => {
        if (!running) return;
        const canvas = canvasRef.current!;
        const focus = () => {
            if (document.activeElement !== canvas) canvas.focus({ preventScroll: true });
        };
        focus();
        window.addEventListener('keydown', focus, true);
        window.addEventListener('focus', focus);
        return () => {
            window.removeEventListener('keydown', focus, true);
            window.removeEventListener('focus', focus);
        };
    }, [running]);

    // Until the game runs, the overlay is a layer of prompts: (A) starts, (B)
    // goes back to the menu. Once it runs, every key and button is the engine's.
    const overlayRef = useRef<HTMLDivElement>(null);
    const pass = state.kind === 'gate' ? state.pass : null;
    useEffect(() => {
        if (running) return;
        return pushLayer({
            root: () => overlayRef.current,
            keepFocus: false,
            onAction: (action) => {
                if (action === 'back') {
                    leave();
                    return true;
                }
                // Any button starts the game, as a tap does.
                if (pass !== null) {
                    start(pass);
                    return true;
                }
                return false;
            },
        });
    }, [running, pass]);
    // Keys that are no menu action start it too.
    useEffect(() => {
        if (pass === null) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key] !== undefined) return;
            start(pass);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [pass]);

    return (
        <div className="play">
            <canvas
                ref={canvasRef}
                id="canvas"
                className="play__canvas"
                tabIndex={-1}
                onContextMenu={(event) => event.preventDefault()}
            />
            <Overlay state={state} notice={notice} rootRef={overlayRef} />
        </div>
    );
}

function Overlay({ state, notice, rootRef }: { state: ScreenState; notice: string | null; rootRef: RefObject<HTMLDivElement | null> }) {
    switch (state.kind) {
        case 'running':
            return null;
        case 'gate':
            return (
                <div className="play__overlay play__gate" ref={rootRef} onClick={() => start(state.pass)}>
                    <div className="play__panel">
                        <GameText text="Ready" className="play__gate-title" />
                        <PromptBar className="play__prompts">
                            <Prompt action="confirm" label="Start" variant="primary" global onPress={() => start(state.pass)} />
                            <Prompt action="back" label="Back to the menu" global onPress={leave} />
                        </PromptBar>
                    </div>
                </div>
            );
        case 'error':
            return (
                <div className="play__overlay" ref={rootRef}>
                    <div className="play__panel">
                        <h1 className="play__heading">
                            <GameText text="The game could not start" />
                        </h1>
                        <p className="play__error">{state.message}</p>
                        <PromptBar className="play__prompts">
                            <Prompt action="confirm" label="Try again" variant="primary" global onPress={() => location.reload()} />
                            <Prompt action="back" label="Back to the menu" global onPress={leave} />
                        </PromptBar>
                    </div>
                </div>
            );
        default: {
            const { heading, fraction, detail } = describeStage(state);
            return (
                <div className="play__overlay" ref={rootRef}>
                    <div className="play__panel">
                        <h1 className="play__heading">
                            <GameText text={heading} />
                        </h1>
                        <ProgressBar fraction={fraction} label={notice ?? detail} />
                        <PromptBar className="play__prompts">
                            <Prompt action="back" label="Back to the menu" global onPress={leave} />
                        </PromptBar>
                    </div>
                </div>
            );
        }
    }
}

function describeStage(state: SessionStage | { kind: 'loading' }): {
    heading: string;
    fraction: number | null;
    detail?: string;
} {
    switch (state.kind) {
        case 'engine':
            return {
                heading: 'Downloading the engine',
                fraction: state.total ? state.received / state.total : null,
                detail:
                    state.total !== null
                        ? `${formatBytes(state.received)} of ${formatBytes(state.total)}`
                        : formatBytes(state.received),
            };
        case 'starting':
            return { heading: 'Starting the engine', fraction: null };
        case 'files':
            return {
                heading: 'Loading the game',
                fraction: state.total > 0 ? state.done / state.total : null,
                detail: `${formatBytes(state.done)} of ${formatBytes(state.total)}`,
            };
        default:
            return { heading: 'Opening the profile', fraction: null };
    }
}
