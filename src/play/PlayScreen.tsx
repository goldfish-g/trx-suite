import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { checkBrowserSupport, runSession, type SessionStage } from '../engine/session';
import { getProfile } from '../profiles/store';
import { formatBytes } from '../ui/format';
import { ProgressBar } from '../ui/ProgressBar';

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

    // Any key or gamepad button starts the game, as a tap does.
    const pass = state.kind === 'gate' ? state.pass : null;
    useEffect(() => {
        if (pass === null) return;
        const onKey = () => pass();
        let frame = requestAnimationFrame(function poll() {
            const pressed = navigator
                .getGamepads?.()
                .some((pad) => pad?.buttons.some((button) => button.pressed));
            if (pressed) pass();
            else frame = requestAnimationFrame(poll);
        });
        window.addEventListener('keydown', onKey, { once: true });
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('keydown', onKey);
        };
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
            <Overlay state={state} notice={notice} />
        </div>
    );
}

function Overlay({ state, notice }: { state: ScreenState; notice: string | null }) {
    switch (state.kind) {
        case 'running':
            return null;
        case 'gate':
            return (
                <button
                    className="play__overlay play__gate"
                    autoFocus
                    onClick={() => {
                        if (isTouchDevice()) void enterFullscreen();
                        state.pass();
                    }}
                >
                    <span className="play__gate-title">Tap to start</span>
                    <span className="play__gate-hint">or press any key or button</span>
                </button>
            );
        case 'error':
            return (
                <div className="play__overlay">
                    <div className="play__panel">
                        <h1 className="play__heading">The game could not start</h1>
                        <p className="play__error">{state.message}</p>
                        <div className="play__actions">
                            <button className="button" onClick={() => location.reload()}>
                                Try again
                            </button>
                            <button className="button button--primary" onClick={leave}>
                                Back to the menu
                            </button>
                        </div>
                    </div>
                </div>
            );
        default: {
            const { heading, fraction, detail } = describeStage(state);
            return (
                <div className="play__overlay">
                    <div className="play__panel">
                        <h1 className="play__heading">{heading}</h1>
                        <ProgressBar fraction={fraction} label={notice ?? detail} />
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
