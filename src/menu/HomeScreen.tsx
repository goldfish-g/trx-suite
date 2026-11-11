// The home screen: a level flying by behind a ring of the games. Turn the
// ring with the d-pad, the bumpers, arrows, a swipe or the wheel; (A) does
// the game's main thing, such as Play or Download, and (X) opens its details.

import { useEffect, useMemo, useRef, useState } from 'react';
import { refreshAccount, useAccount } from '../account/store';
import { nextTheme, playEffect, showTheme, startMenuAudio } from '../audio';
import { startCloudSync } from '../cloud/sync';
import { FlybyLayer } from '../flyby/FlybyLayer';
import { loadPreparedLevel } from '../flyby/load';
import { plannedRoutes } from '../flyby/planned';
import { flybyCandidates, rememberFlyby } from '../flyby/pick';
import { resumeInterruptedImports, retryImport, useImports } from '../gamedata/imports';
import { pushLayer } from '../input/controller';
import { refreshLibrary, useLibrary } from '../library/store';
import { applyUpdate, useInstall } from '../pwa/install';
import { cameFromGame } from '../play/pages';
import { Stage } from '../stage/Stage';
import { ChevronLeft, ChevronRight, GearIcon, LockIcon, UpdateIcon, UserIcon } from '../ui/icons';
import { MoveHint, Prompt, PromptBar } from '../ui/Prompt';
import { describeProgress } from '../library/describe';
import { ProgressBar } from '../ui/ProgressBar';
import { GameText } from '../ui/GameText';
import { BrandLogo } from '../ui/BrandLogo';
import { formatBytes } from '../ui/format';
import { isLockedLook, itemStatus, RING_ITEMS, type ItemStatus } from './items';
import { createArtifact, type Artifact } from './models';
import { createGameArtifact } from './models/game';
import { RingLayer } from './RingLayer';
import { loadRingModels } from './ringModels';
import { AccountSheet } from './sheets/AccountSheet';
import { GameSheet } from './sheets/GameSheet';
import { SettingsSheet } from './sheets/SettingsSheet';
import { describeError, downloadGame, playGame } from './actions';
import { reducedMotion } from './motion';
import { CustomLevels } from '../custom/CustomLevels';
import { StartScreen } from './StartScreen';
import { useTopbarFit } from './topbarFit';

type SheetState =
    | { kind: 'game'; key: string }
    | { kind: 'custom' }
    | { kind: 'account' }
    | { kind: 'settings' }
    | null;

const SELECTED_KEY = 'trx-suite:selected';

function initialSelection(): number {
    try {
        const key = localStorage.getItem(SELECTED_KEY);
        const index = RING_ITEMS.findIndex((item) => item.key === key);
        return index >= 0 ? index : 0;
    } catch {
        return 0;
    }
}

let resumed = false;

export function HomeScreen() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const badgesRef = useRef<HTMLDivElement>(null);
    const uiRef = useRef<HTMLDivElement>(null);
    const topbarRef = useRef<HTMLElement>(null);
    const ringRef = useRef<RingLayer | null>(null);
    const stageRef = useRef<Stage | null>(null);
    const [selected, setSelected] = useState(initialSelection);
    const [sheet, setSheet] = useState<SheetState>(null);
    const [caption, setCaption] = useState<string | null>(null);
    const [flybyNonce, setFlybyNonce] = useState(0);
    const [webglError, setWebglError] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // The credits come first as the app starts, not on the way back from a game.
    const [starting, setStarting] = useState(() => !cameFromGame());

    const { gamedata } = useLibrary();
    const catalog = useAccount((state) => state.catalog);
    const progress = useImports((state) => state.progress);
    const updateReady = useInstall((state) => state.updateReady);
    useTopbarFit(topbarRef, updateReady ? 'update' : '');

    const statuses = useMemo(
        () => RING_ITEMS.map((item) => itemStatus(item, gamedata, catalog, progress)),
        [gamedata, catalog, progress],
    );
    const statusesRef = useRef(statuses);
    statusesRef.current = statuses;

    useEffect(() => {
        void refreshLibrary();
        void refreshAccount();
        if (!resumed) {
            resumed = true;
            void resumeInterruptedImports();
        }
        // Saves and custom levels in step with the cloud, now and as they change.
        startCloudSync();
        document.title = 'tombs.nexus';
    }, []);

    // The theme of the game flying by, and the menu's sound effects.
    useEffect(() => startMenuAudio(), []);

    // The stage and the ring live as long as the screen.
    useEffect(() => {
        const canvas = canvasRef.current!;
        let stage: Stage;
        try {
            stage = new Stage(canvas);
        } catch (error) {
            console.error('[stage] WebGL is not available:', error);
            setWebglError(true);
            return;
        }
        const ring = new RingLayer(
            RING_ITEMS.map((_, index) => ({ locked: isLockedLook(statusesRef.current[index]!) })),
            selected,
            reducedMotion(),
        );
        stage.foreground = ring;
        stageRef.current = stage;
        ringRef.current = ring;

        // Each game's own object when the server has one, else the ring's own.
        let disposed = false;
        void loadRingModels().then((models) =>
            Promise.all(
                RING_ITEMS.map(async (item, index) => {
                    const file = models.get(item.key);
                    let artifact: Artifact | null = null;
                    if (file !== undefined) {
                        artifact = await createGameArtifact(file, item.look).catch((error: unknown) => {
                            console.warn(`[ring] ${item.key}:`, error);
                            return null;
                        });
                    }
                    artifact ??= createArtifact(item.artifact);
                    if (disposed) artifact.dispose();
                    else ring.setArtifact(index, artifact);
                }),
            ),
        );

        // Badges ride along with the artifacts they belong to: a game still
        // downloading turns a wheel. A locked one says so by its stone look alone.
        stage.onFrame = (viewport) => {
            const badges = badgesRef.current;
            if (badges === null) return;
            const front = ring.frontIndex;
            [...badges.children].forEach((element, index) => {
                const badge = element as HTMLElement;
                const spot = ring.screenPosition(index, viewport);
                const status = statusesRef.current[index];
                // The front artifact's state is spelled out under it already.
                if (index === front || spot === null || status === undefined || status.kind !== 'importing') {
                    badge.style.opacity = '0';
                    return;
                }
                badge.style.opacity = '1';
                badge.style.transform = `translate(${spot.x}px, ${spot.y + spot.size * 0.55}px) translate(-50%, -50%)`;
            });
        };
        stage.start();

        const onVisibility = () => (document.hidden ? stage.stop() : stage.start());
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            disposed = true;
            document.removeEventListener('visibilitychange', onVisibility);
            stage.dispose();
            stageRef.current = null;
            ringRef.current = null;
        };
        // The ring is built once; selection and locks are pushed into it below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // A level to fly through: a new one each visit, or on request.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const candidates = await flybyCandidates();
            for (const candidate of candidates.slice(0, 8)) {
                try {
                    const choice = await candidate.load();
                    if (choice === null || cancelled) continue;
                    // Routes planned ahead for this very file, when it is one of the official games' own.
                    const planned = await plannedRoutes(choice.mod, choice.fileName, choice.bytes.length).catch(() => null);
                    if (cancelled) return;
                    // Some levels have nothing worth flying through (all dark, cramped or open to the void).
                    if (planned !== null && planned.length === 0) continue;
                    // A level of another game is coming: the music fades out while the level loads.
                    // Not before: a level passed over must not stop the music of the one still showing.
                    nextTheme(choice.theme);
                    const prepared = await loadPreparedLevel(choice.bytes, choice.fileName, undefined, planned);
                    if (cancelled || stageRef.current === null) return;
                    if (prepared.routes.length === 0) continue;
                    stageRef.current.setBackground(new FlybyLayer(prepared, { reducedMotion: reducedMotion() }));
                    setCaption(choice.caption);
                    showTheme(choice.theme);
                    rememberFlyby(choice.key);
                    return;
                } catch (error) {
                    console.warn(`[flyby] ${candidate.key} could not be shown:`, error);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [flybyNonce]);

    useEffect(() => {
        statuses.forEach((status, index) => ringRef.current?.setLocked(index, isLockedLook(status)));
    }, [statuses]);

    // The custom levels screen and the start screen show the level flying by through them, without the ring.
    const customOpen = sheet?.kind === 'custom';
    useEffect(() => {
        if (stageRef.current !== null) stageRef.current.showForeground = !customOpen && !starting;
    }, [customOpen, starting]);

    // Each turn of the ring knocks, however it was turned.
    const shownSelection = useRef(selected);
    useEffect(() => {
        if (shownSelection.current === selected) return;
        shownSelection.current = selected;
        playEffect('turn');
    }, [selected]);

    useEffect(() => {
        try {
            localStorage.setItem(SELECTED_KEY, RING_ITEMS[selected]!.key);
        } catch {
            // Not remembered.
        }
    }, [selected]);

    const open = (index: number) => {
        const item = RING_ITEMS[index]!;
        setSheet(item.game === null ? { kind: 'custom' } : { kind: 'game', key: item.key });
    };

    const turn = (direction: number) => {
        const ring = ringRef.current;
        if (ring === null) return;
        setSelected(ring.step(direction));
    };

    // The game's main thing, what (A) does.
    const act = async (index: number) => {
        const ringItem = RING_ITEMS[index]!;
        const itemStatus = statusesRef.current[index]!;
        setProblem(null);
        switch (itemStatus.kind) {
            case 'installed':
                setBusy(true);
                try {
                    await playGame(itemStatus.record, ringItem.game!);
                } catch (error) {
                    setProblem(describeError(error));
                    setBusy(false);
                }
                return;
            case 'available':
                await downloadGame(itemStatus.entry).catch((error: unknown) => setProblem(describeError(error)));
                return;
            case 'failed':
                await retryImport(itemStatus.record.id).catch((error: unknown) => setProblem(describeError(error)));
                return;
            case 'locked':
                setSheet({ kind: 'account' });
                return;
            default:
                open(index);
        }
    };

    // The ring turns on the d-pad and the bumpers; the prompts answer the rest.
    // Not before the start screen is gone: its layer must stay on top.
    useEffect(() => {
        if (starting) return undefined;
        return pushLayer({
            root: () => uiRef.current,
            keepFocus: false,
            onAction: (action) => {
                switch (action) {
                    case 'left':
                    case 'previous':
                        turn(-1);
                        return true;
                    case 'right':
                    case 'next':
                        turn(1);
                        return true;
                    case 'up':
                    case 'down':
                        return true;
                    default:
                        return false;
                }
            },
        });
        // turn() reads only refs, so the first one serves.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [starting]);

    // Dragging, flicking and tapping the ring.
    useEffect(() => {
        const canvas = canvasRef.current!;
        let start: { x: number; y: number; time: number; id: number } | null = null;
        let dragging = false;
        // Whether the press now ending turned the ring, rather than tapping it.
        let dragged = false;
        let lastX = 0;
        let lastTime = 0;
        let velocity = 0;
        const slotWidth = () => Math.max(120, canvas.clientWidth / (canvas.clientWidth < canvas.clientHeight ? 2.2 : 5));

        const down = (event: PointerEvent) => {
            if (event.button !== 0) return;
            start = { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId };
            dragging = false;
            dragged = false;
            lastX = event.clientX;
            lastTime = start.time;
            velocity = 0;
        };
        const move = (event: PointerEvent) => {
            if (start === null || event.pointerId !== start.id) return;
            const dx = event.clientX - start.x;
            if (!dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
                dragging = true;
                dragged = true;
                canvas.setPointerCapture(event.pointerId);
            }
            if (!dragging) return;
            const now = performance.now();
            if (now > lastTime) velocity = (-(event.clientX - lastX) / slotWidth() / (now - lastTime)) * 1000;
            lastX = event.clientX;
            lastTime = now;
            ringRef.current?.drag(-dx / slotWidth());
        };
        const up = (event: PointerEvent) => {
            if (start === null || event.pointerId !== start.id) return;
            const ring = ringRef.current;
            if (ring !== null && dragging) setSelected(ring.release(velocity));
            start = null;
            dragging = false;
        };
        // A tap answers the click that ends it, not the finger lifting: after
        // a finger lifts, the browser clicks whatever is then under it, which
        // would be what the tap opened, such as a level in Browse.
        const tap = (event: MouseEvent) => {
            const ring = ringRef.current;
            if (ring === null || dragged) return;
            const rect = canvas.getBoundingClientRect();
            const hit = ring.pick(
                ((event.clientX - rect.left) / rect.width) * 2 - 1,
                -((event.clientY - rect.top) / rect.height) * 2 + 1,
            );
            if (hit === null) return;
            if (hit === ring.frontIndex) open(hit);
            else {
                ring.select(hit);
                setSelected(hit);
            }
        };
        let wheelAt = 0;
        const wheel = (event: WheelEvent) => {
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (Math.abs(delta) < 4) return;
            event.preventDefault();
            const now = performance.now();
            if (now - wheelAt < 160) return;
            wheelAt = now;
            turn(delta > 0 ? 1 : -1);
        };
        canvas.addEventListener('pointerdown', down);
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', up);
        canvas.addEventListener('click', tap);
        canvas.addEventListener('wheel', wheel, { passive: false });
        return () => {
            canvas.removeEventListener('pointerdown', down);
            canvas.removeEventListener('pointermove', move);
            canvas.removeEventListener('pointerup', up);
            canvas.removeEventListener('pointercancel', up);
            canvas.removeEventListener('click', tap);
            canvas.removeEventListener('wheel', wheel);
        };
    }, []);

    const item = RING_ITEMS[selected]!;
    const status = statuses[selected]!;

    return (
        <main className={`home ${customOpen ? 'home--custom' : ''} ${starting ? 'home--starting' : ''}`}>
            <canvas ref={canvasRef} className="home__stage" aria-hidden="true" />
            <div className="home__shade" aria-hidden="true" />
            {webglError ? (
                <p className="home__webgl">This browser cannot draw 3D graphics (WebGL 2), which the games need.</p>
            ) : null}

            <div className="home__ui" ref={uiRef} inert={sheet !== null || starting}>
            <header className="topbar" ref={topbarRef}>
                <div className="brand">
                    <BrandLogo className="brand__logo" />
                </div>
                <div className="topbar__actions">
                    {updateReady ? (
                        <Prompt action="view" label="Restart to update" variant="chip" className="prompt--accent" global icon={<UpdateIcon />} onPress={applyUpdate} />
                    ) : null}
                    <AccountPrompt onPress={() => setSheet({ kind: 'account' })} />
                    <Prompt action="menu" label="Settings" variant="chip" global icon={<GearIcon />} onPress={() => setSheet({ kind: 'settings' })} />
                </div>
            </header>

            <div className="badges" ref={badgesRef} aria-hidden="true">
                {RING_ITEMS.map((ringItem, index) => (
                    <span key={ringItem.key} className="badge">
                        {statuses[index]?.kind === 'importing' ? <span className="badge__spinner" /> : null}
                    </span>
                ))}
            </div>

            <div className="ring-nav">
                <button className="ring-nav__button" onClick={() => turn(-1)} aria-label="Previous game" tabIndex={-1}>
                    <ChevronLeft />
                </button>
                <button className="ring-nav__button" onClick={() => turn(1)} aria-label="Next game" tabIndex={-1}>
                    <ChevronRight />
                </button>
            </div>

            <section className="spotlight" aria-live="polite">
                <p className="spotlight__eyebrow">{item.tagline}</p>
                <h1 className="spotlight__title">
                    <GameText text={item.title} />
                </h1>
                <Spotlight
                    status={status}
                    busy={busy}
                    problem={problem}
                    onPrimary={() => void act(selected)}
                    onDetails={item.game !== null ? () => open(selected) : undefined}
                />
            </section>

            {/* The ring for screen readers and keyboards without arrows. */}
            <nav className="sr-only" aria-label="Games">
                <ul>
                    {RING_ITEMS.map((ringItem, index) => (
                        <li key={ringItem.key}>
                            <button
                                onClick={() => {
                                    ringRef.current?.select(index);
                                    setSelected(index);
                                    open(index);
                                }}
                            >
                                {ringItem.title}: {statusLine(statuses[index]!)}
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>

            <footer className="hints">
                <PromptBar>
                    <MoveHint name="horizontal" label="Choose" />
                </PromptBar>
                {caption !== null ? (
                    <button className="hints__caption" onClick={() => setFlybyNonce((n) => n + 1)} title="Fly through another level">
                        {caption}
                    </button>
                ) : null}
            </footer>
            </div>

            {starting ? <StartScreen onContinue={() => setStarting(false)} /> : null}
            {sheet?.kind === 'game' ? (
                <GameSheet
                    item={RING_ITEMS.find((candidate) => candidate.key === sheet.key)!}
                    status={statuses[RING_ITEMS.findIndex((candidate) => candidate.key === sheet.key)]!}
                    onClose={() => setSheet(null)}
                    onSignIn={() => setSheet({ kind: 'account' })}
                />
            ) : null}
            {customOpen ? <CustomLevels onClose={() => setSheet(null)} /> : null}
            {sheet?.kind === 'account' ? <AccountSheet onClose={() => setSheet(null)} /> : null}
            {sheet?.kind === 'settings' ? (
                <SettingsSheet
                    onClose={() => setSheet(null)}
                    onNewFlyby={() => {
                        setSheet(null);
                        setFlybyNonce((n) => n + 1);
                    }}
                />
            ) : null}
        </main>
    );
}

export function statusLine(status: ItemStatus): string {
    switch (status.kind) {
        case 'installed':
            return 'Ready to play';
        case 'importing':
            return status.progress === undefined ? 'Waiting to continue…' : describeProgress(status.progress).label;
        case 'failed':
            return status.record.error ?? 'The download failed.';
        case 'available':
            return status.entry.access === 'free'
                ? `Free download · ${formatBytes(status.entry.sizeBytes)}`
                : `Yours to download · ${formatBytes(status.entry.sizeBytes)}`;
        case 'locked':
            return 'Sign in with Steam to unlock';
        case 'own-copy':
            return 'Add the files from your own copy';
        case 'custom':
            return status.count === 0 ? 'Add levels from the community' : `${status.count} level${status.count === 1 ? '' : 's'} in your library`;
    }
}

function primaryLabel(status: ItemStatus): string {
    switch (status.kind) {
        case 'installed':
            return 'Play';
        case 'importing':
            return 'Details';
        case 'failed':
            return 'Try again';
        case 'available':
            return 'Download';
        case 'locked':
            return 'Unlock';
        case 'own-copy':
            return 'Add files';
        case 'custom':
            return 'Open';
    }
}

interface SpotlightProps {
    status: ItemStatus;
    busy: boolean;
    problem: string | null;
    onPrimary(): void;
    /** Official games have details: profiles, files, the own-copy picker. */
    onDetails?: () => void;
}

function Spotlight({ status, busy, problem, onPrimary, onDetails }: SpotlightProps) {
    const importing = status.kind === 'importing' && status.progress !== undefined ? describeProgress(status.progress) : null;
    return (
        <>
            {importing !== null ? (
                <div className="spotlight__progress">
                    <ProgressBar fraction={importing.fraction} label={importing.label} />
                </div>
            ) : (
                <p className={`spotlight__status spotlight__status--${status.kind}`}>
                    {status.kind === 'locked' ? <LockIcon /> : null}
                    <GameText text={statusLine(status)} />
                </p>
            )}
            {problem !== null ? <p className="spotlight__problem">{problem}</p> : null}
            <div className="spotlight__prompts">
                <Prompt action="confirm" label={primaryLabel(status)} variant="primary" global disabled={busy} onPress={onPrimary} />
                {onDetails !== undefined && status.kind !== 'importing' && status.kind !== 'own-copy' ? (
                    <Prompt action="alternate" label="Details" global onPress={onDetails} />
                ) : null}
            </div>
        </>
    );
}

function AccountPrompt({ onPress }: { onPress(): void }) {
    const me = useAccount((state) => state.me);
    const accounts = me?.accounts ?? [];
    const label = accounts.length === 0 ? 'Sign in' : accounts.map((account) => account.name).join(' · ');
    return <Prompt action="extra" label={label} variant="chip" className="topbar__account" global icon={<UserIcon />} onPress={onPress} />;
}
