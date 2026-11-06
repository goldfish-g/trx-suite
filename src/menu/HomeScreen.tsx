// The home screen: a level flying by behind a ring of the games. Choose a
// game with arrows, a d-pad, a swipe, the wheel or a click, then confirm to
// open it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { refreshAccount, useAccount } from '../account/store';
import { FlybyLayer } from '../flyby/FlybyLayer';
import { loadPreparedLevel } from '../flyby/load';
import { flybyCandidates, rememberFlyby } from '../flyby/pick';
import { resumeInterruptedImports, useImports } from '../gamedata/imports';
import { onMenuAction, useInputDevice } from '../input/controller';
import { moveFocus } from '../input/spatial';
import { refreshLibrary, useLibrary } from '../library/store';
import { applyUpdate, useInstall } from '../pwa/install';
import { Stage } from '../stage/Stage';
import { ChevronLeft, ChevronRight, GearIcon, LockIcon, UserIcon } from '../ui/icons';
import { describeProgress } from '../library/describe';
import { ProgressBar } from '../ui/ProgressBar';
import { formatBytes } from '../ui/format';
import { isLockedLook, itemStatus, RING_ITEMS, type ItemStatus, type RingItem } from './items';
import { createArtifact, type Artifact } from './models';
import { createGameArtifact } from './models/game';
import { RingLayer } from './RingLayer';
import { loadRingModels } from './ringModels';
import { AccountSheet } from './sheets/AccountSheet';
import { CustomSheet } from './sheets/CustomSheet';
import { GameSheet } from './sheets/GameSheet';
import { SettingsSheet } from './sheets/SettingsSheet';
import { reducedMotion } from './motion';

type SheetState =
    | { kind: 'game'; key: string }
    | { kind: 'custom' }
    | { kind: 'account' }
    | { kind: 'settings' }
    | null;

const SELECTED_KEY = 'trx-web:selected';

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
    const topbarRef = useRef<HTMLElement>(null);
    const ringRef = useRef<RingLayer | null>(null);
    const stageRef = useRef<Stage | null>(null);
    const [selected, setSelected] = useState(initialSelection);
    const [sheet, setSheet] = useState<SheetState>(null);
    const [caption, setCaption] = useState<string | null>(null);
    const [flybyNonce, setFlybyNonce] = useState(0);
    const [webglError, setWebglError] = useState(false);

    const { gamedata } = useLibrary();
    const catalog = useAccount((state) => state.catalog);
    const progress = useImports((state) => state.progress);
    const device = useInputDevice((state) => state.device);
    const updateReady = useInstall((state) => state.updateReady);

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
        document.title = 'TRX';
    }, []);

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

        // Badges ride along with the artifacts they belong to.
        stage.onFrame = (viewport) => {
            const badges = badgesRef.current;
            if (badges === null) return;
            const front = ring.frontIndex;
            [...badges.children].forEach((element, index) => {
                const badge = element as HTMLElement;
                const spot = ring.screenPosition(index, viewport);
                const status = statusesRef.current[index];
                // The front artifact's state is spelled out under it already.
                if (index === front || spot === null || status === undefined || !(isLockedLook(status) || status.kind === 'importing')) {
                    badge.style.opacity = '0';
                    return;
                }
                badge.style.opacity = '1';
                badge.style.transform = `translate(${spot.x}px, ${spot.y + spot.size * 0.8}px) translate(-50%, -50%)`;
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
            for (const candidate of candidates.slice(0, 4)) {
                try {
                    const choice = await candidate.load();
                    if (choice === null || cancelled) continue;
                    const prepared = await loadPreparedLevel(choice.bytes, choice.fileName);
                    if (cancelled || stageRef.current === null) return;
                    stageRef.current.setBackground(new FlybyLayer(prepared, { reducedMotion: reducedMotion() }));
                    setCaption(choice.caption);
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

    // Menu actions while no sheet is open.
    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    useEffect(
        () =>
            onMenuAction((action) => {
                const topbar = topbarRef.current;
                const inTopbar = topbar !== null && topbar.contains(document.activeElement);
                if (inTopbar) {
                    if (action === 'left' || action === 'right') {
                        moveFocus(topbar, action);
                        return true;
                    }
                    if (action === 'down' || action === 'back') {
                        (document.activeElement as HTMLElement | null)?.blur();
                        return true;
                    }
                    return false;
                }
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
                        topbar?.querySelector<HTMLElement>('button')?.focus();
                        return true;
                    case 'confirm':
                        open(selectedRef.current);
                        return true;
                    case 'menu':
                        setSheet({ kind: 'settings' });
                        return true;
                    case 'alternate':
                        setSheet({ kind: 'account' });
                        return true;
                    default:
                        return false;
                }
            }),
        [],
    );

    // Dragging, flicking and tapping the ring.
    useEffect(() => {
        const canvas = canvasRef.current!;
        let start: { x: number; y: number; time: number; id: number } | null = null;
        let dragging = false;
        let lastX = 0;
        let lastTime = 0;
        let velocity = 0;
        const slotWidth = () => Math.max(120, canvas.clientWidth / (canvas.clientWidth < canvas.clientHeight ? 2.2 : 5));

        const down = (event: PointerEvent) => {
            if (event.button !== 0) return;
            start = { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId };
            dragging = false;
            lastX = event.clientX;
            lastTime = start.time;
            velocity = 0;
        };
        const move = (event: PointerEvent) => {
            if (start === null || event.pointerId !== start.id) return;
            const dx = event.clientX - start.x;
            if (!dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
                dragging = true;
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
            if (ring !== null && dragging) {
                setSelected(ring.release(velocity));
            } else if (ring !== null) {
                const rect = canvas.getBoundingClientRect();
                const hit = ring.pick(
                    ((event.clientX - rect.left) / rect.width) * 2 - 1,
                    -((event.clientY - rect.top) / rect.height) * 2 + 1,
                );
                if (hit !== null) {
                    if (hit === ring.frontIndex) open(hit);
                    else {
                        ring.select(hit);
                        setSelected(hit);
                    }
                }
            }
            start = null;
            dragging = false;
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
        canvas.addEventListener('wheel', wheel, { passive: false });
        return () => {
            canvas.removeEventListener('pointerdown', down);
            canvas.removeEventListener('pointermove', move);
            canvas.removeEventListener('pointerup', up);
            canvas.removeEventListener('pointercancel', up);
            canvas.removeEventListener('wheel', wheel);
        };
    }, []);

    const item = RING_ITEMS[selected]!;
    const status = statuses[selected]!;

    return (
        <main className="home">
            <canvas ref={canvasRef} className="home__stage" aria-hidden="true" />
            <div className="home__shade" aria-hidden="true" />
            {webglError ? (
                <p className="home__webgl">This browser cannot draw 3D graphics (WebGL 2), which the games need.</p>
            ) : null}

            <div className="home__ui" inert={sheet !== null}>
            <header className="topbar" ref={topbarRef}>
                <div className="brand" aria-label="TRX">
                    <span className="brand__mark">TRX</span>
                    <span className="brand__line">Tomb Raider, in your browser</span>
                </div>
                <div className="topbar__actions">
                    {updateReady ? (
                        <button className="chip chip--accent" onClick={applyUpdate}>
                            Update ready · Restart
                        </button>
                    ) : null}
                    <AccountChip onClick={() => setSheet({ kind: 'account' })} />
                    <button className="icon-button" onClick={() => setSheet({ kind: 'settings' })} aria-label="Settings">
                        <GearIcon />
                    </button>
                </div>
            </header>

            <div className="badges" ref={badgesRef} aria-hidden="true">
                {RING_ITEMS.map((ringItem, index) => (
                    <span key={ringItem.key} className="badge">
                        {statuses[index]?.kind === 'importing' ? <span className="badge__spinner" /> : <LockIcon />}
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
                <h1 className="spotlight__title">{item.title}</h1>
                <Spotlight item={item} status={status} onOpen={() => open(selected)} />
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
                <Hints device={device} />
                {caption !== null ? (
                    <button className="hints__caption" onClick={() => setFlybyNonce((n) => n + 1)} title="Fly through another level">
                        {caption}
                    </button>
                ) : null}
            </footer>
            </div>

            {sheet?.kind === 'game' ? (
                <GameSheet
                    item={RING_ITEMS.find((candidate) => candidate.key === sheet.key)!}
                    status={statuses[RING_ITEMS.findIndex((candidate) => candidate.key === sheet.key)]!}
                    onClose={() => setSheet(null)}
                    onSignIn={() => setSheet({ kind: 'account' })}
                />
            ) : null}
            {sheet?.kind === 'custom' ? <CustomSheet onClose={() => setSheet(null)} /> : null}
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
            return 'Sign in with Steam or GOG to unlock';
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
            return 'Fix';
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

function Spotlight({ item, status, onOpen }: { item: RingItem; status: ItemStatus; onOpen(): void }) {
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
                    {statusLine(status)}
                </p>
            )}
            <button className="button button--primary button--large" onClick={onOpen} aria-label={`${primaryLabel(status)}: ${item.title}`}>
                {primaryLabel(status)}
            </button>
        </>
    );
}

function AccountChip({ onClick }: { onClick(): void }) {
    const me = useAccount((state) => state.me);
    const accounts = me?.accounts ?? [];
    const label = accounts.length === 0 ? 'Sign in' : accounts.map((account) => account.name).join(' · ');
    return (
        <button className="chip" onClick={onClick}>
            <UserIcon />
            <span className="chip__label">{label}</span>
        </button>
    );
}

function Key({ children }: { children: string }) {
    return <kbd className="key">{children}</kbd>;
}

function Hints({ device }: { device: string }) {
    if (device === 'gamepad') {
        return (
            <p className="hints__list">
                <span><Key>◀ ▶</Key> Choose</span>
                <span><Key>A</Key> Open</span>
                <span><Key>X</Key> Account</span>
                <span><Key>Y</Key> Settings</span>
            </p>
        );
    }
    if (device === 'keyboard') {
        return (
            <p className="hints__list">
                <span><Key>← →</Key> Choose</span>
                <span><Key>Enter</Key> Open</span>
                <span><Key>↑</Key> Menu</span>
            </p>
        );
    }
    if (device === 'touch') {
        return (
            <p className="hints__list">
                <span>Swipe to choose</span>
                <span>Tap to open</span>
            </p>
        );
    }
    return (
        <p className="hints__list">
            <span>Scroll or click to choose</span>
            <span>Click the artifact to open</span>
        </p>
    );
}
