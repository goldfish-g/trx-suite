// Custom levels, over the level flying by: the ones in the library
// (Installed) and the ones on TRCustoms (Browse), each by the game they were
// made for. The triggers switch between Installed and Browse, the bumpers
// between Tomb Raider I, II and III; a click or a tap on a tab does too.
// Levels are cards: (A) opens one, or plays one already installed.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { CustomLevelGame, CustomLevelSort, CustomLevelSummary } from '../../shared/api.ts';
import type { GameDataRecord } from '../gamedata/types';
import { useImports } from '../gamedata/imports';
import { ENGINE_NAMES, type EngineNumber } from '../games/catalog';
import { pushLayer, useInputDevice } from '../input/controller';
import { focusables } from '../input/spatial';
import { useLibrary } from '../library/store';
import { GameText } from '../ui/GameText';
import { PlusIcon, SearchIcon } from '../ui/icons';
import { Glyph, MoveHint, Prompt, PromptBar } from '../ui/Prompt';
import { AddLevelSheet } from './AddLevelSheet';
import { browseKey, hasMore, loadMore, SORTS, useBrowse, type BrowseQuery } from './browse';
import { gameTitle, keepFocus } from './labels';
import { BrowseCard, InstalledCard } from './LevelCard';
import { installedCopy, LevelDetails } from './LevelDetails';

type Section = 'installed' | 'browse';
type Opened = { kind: 'remote'; level: CustomLevelSummary } | { kind: 'installed'; recordId: string };

const BROWSE_GAMES: readonly CustomLevelGame[] = [1, 2, 3];
const SECTION_KEY = 'trx-suite:custom-section';
const GAME_KEY = 'trx-suite:custom-game';
const SORT_KEY = 'trx-suite:custom-sort';

function remembered<T extends string | number>(key: string, allowed: readonly T[], fallback: T): T {
    try {
        const value = localStorage.getItem(key);
        return allowed.find((candidate) => String(candidate) === value) ?? fallback;
    } catch {
        return fallback;
    }
}

function remember(key: string, value: string | number): void {
    try {
        localStorage.setItem(key, String(value));
    } catch {
        // Forgotten next time.
    }
}

/** Whether a gamepad or keyboard drives the menus, which then always show a focus. */
function drivenByButtons(): boolean {
    const device = useInputDevice.getState().device;
    return device === 'gamepad' || device === 'keyboard';
}

export function CustomLevels({ onClose }: { onClose(): void }) {
    const root = useRef<HTMLDivElement>(null);
    const body = useRef<HTMLDivElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const { gamedata, levelInfo, profiles } = useLibrary();
    // A mouse or a finger has the search box and the Add button in view already.
    const buttons = useInputDevice((state) => state.device === 'gamepad' || state.device === 'keyboard');
    const progress = useImports((state) => state.progress);

    const installed = useMemo(() => gamedata.filter((record) => record.layout !== 'game'), [gamedata]);
    // A tab for TR4 too, once the library holds a level for it.
    const installedGames = useMemo<EngineNumber[]>(
        () => (installed.some((record) => record.engine === 4) ? [1, 2, 3, 4] : [1, 2, 3]),
        [installed],
    );

    const [section, setSection] = useState<Section>(() =>
        remembered<Section>(SECTION_KEY, ['installed', 'browse'], installed.length > 0 ? 'installed' : 'browse'),
    );
    const [game, setGame] = useState<EngineNumber>(() => remembered<EngineNumber>(GAME_KEY, [1, 2, 3, 4], 1));
    const [sort, setSort] = useState<CustomLevelSort>(() => remembered<CustomLevelSort>(SORT_KEY, ['newest', 'rating', 'downloads', 'name'], 'newest'));
    const [typed, setTyped] = useState('');
    const [query, setQuery] = useState('');
    const [opened, setOpened] = useState<Opened | null>(null);
    const [adding, setAdding] = useState(false);

    const games: readonly EngineNumber[] = section === 'browse' ? BROWSE_GAMES : installedGames;
    const shownGame: EngineNumber = games.includes(game) ? game : 1;

    useEffect(() => remember(SECTION_KEY, section), [section]);
    useEffect(() => remember(GAME_KEY, game), [game]);
    useEffect(() => remember(SORT_KEY, sort), [sort]);

    // Typing settles into a search after a moment's pause.
    useEffect(() => {
        const timer = setTimeout(() => setQuery(typed.trim()), 450);
        return () => clearTimeout(timer);
    }, [typed]);

    const stepGame = (step: number) => {
        const index = games.indexOf(shownGame);
        setGame(games[(index + step + games.length) % games.length]!);
    };

    const sortRef = useRef(sort);
    sortRef.current = sort;
    const cycleSort = () => {
        const index = SORTS.findIndex((entry) => entry.sort === sortRef.current);
        setSort(SORTS[(index + 1) % SORTS.length]!.sort);
    };

    // The screen is a layer over the home screen; its panels are layers over it.
    const actions = useRef({ stepGame, setSection, onClose });
    actions.current = { stepGame, setSection, onClose };
    useEffect(
        () =>
            pushLayer({
                root: () => root.current,
                onAction: (action) => {
                    switch (action) {
                        case 'sectionPrevious':
                            actions.current.setSection('installed');
                            return true;
                        case 'sectionNext':
                            actions.current.setSection('browse');
                            return true;
                        case 'previous':
                            actions.current.stepGame(-1);
                            return true;
                        case 'next':
                            actions.current.stepGame(1);
                            return true;
                        case 'back':
                            // Back leaves the search box before it leaves the screen.
                            if (document.activeElement === search.current) {
                                search.current?.blur();
                                focusFirstCard();
                                return true;
                            }
                            return false;
                        default:
                            return false;
                    }
                },
                onBack: () => actions.current.onClose(),
            }),
        [],
    );

    const focusFirstCard = () => {
        const container = body.current;
        if (container === null) return;
        const first = focusables(container)[0];
        first?.focus({ preventScroll: true });
    };

    // A new tab starts at its top, with its first card in focus for a gamepad.
    useEffect(() => {
        body.current?.scrollTo({ top: 0 });
        if (!drivenByButtons()) return;
        const frame = requestAnimationFrame(() => requestAnimationFrame(focusFirstCard));
        return () => cancelAnimationFrame(frame);
    }, [section, shownGame, sort, query]);

    const browseQuery: BrowseQuery | null = section === 'browse' && shownGame !== 4 ? { game: shownGame, sort, search: query } : null;

    const closeDetails = () => {
        const back = opened;
        setOpened(null);
        // The card the details came from takes the focus back.
        requestAnimationFrame(() => {
            const selector =
                back?.kind === 'remote' ? `[data-level="${back.level.id}"]` : back?.kind === 'installed' ? `[data-record="${back.recordId}"]` : null;
            const card = selector === null ? null : root.current?.querySelector<HTMLElement>(selector);
            if (card !== null && card !== undefined) card.focus({ preventScroll: true });
            else if (drivenByButtons()) focusFirstCard();
        });
    };

    return (
        <>
        <div className={`custom ${opened !== null ? 'custom--covered' : ''}`} ref={root} role="dialog" aria-modal="true" aria-label="Custom levels" inert={opened !== null || adding}>
            <header className="custom__header">
                <div className="custom__tabs custom__tabs--sections" role="tablist" aria-label="Section">
                    <Glyph name="sectionPrevious" />
                    <SectionTab label="Installed" count={installed.length} on={section === 'installed'} onPick={() => setSection('installed')} />
                    <SectionTab label="Browse" on={section === 'browse'} onPick={() => setSection('browse')} />
                    <Glyph name="sectionNext" />
                </div>
                <div className="custom__toolbar">
                    <div className="custom__tabs custom__tabs--games" role="tablist" aria-label="Game">
                        <Glyph name="previous" />
                        {games.map((candidate) => (
                            <button
                                key={candidate}
                                type="button"
                                role="tab"
                                tabIndex={-1}
                                onMouseDown={keepFocus}
                                aria-selected={candidate === shownGame}
                                title={gameTitle(candidate)}
                                className={`game-tab ${candidate === shownGame ? 'game-tab--on' : ''}`}
                                onClick={() => setGame(candidate)}
                            >
                                <GameText text={ENGINE_NAMES[candidate]} />
                                {section === 'installed' ? (
                                    <span className="game-tab__count">{installed.filter((record) => record.engine === candidate).length}</span>
                                ) : null}
                            </button>
                        ))}
                        <Glyph name="next" />
                    </div>
                    {section === 'browse' ? (
                        <div className="custom__tools">
                            <label className="custom__search">
                                <SearchIcon />
                                <input
                                    ref={search}
                                    type="search"
                                    // (Y) goes here; the d-pad walks the levels.
                                    tabIndex={-1}
                                    className="custom__search-input"
                                    placeholder={`Search ${ENGINE_NAMES[shownGame]} levels or authors`}
                                    value={typed}
                                    onChange={(event) => setTyped(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            setQuery(typed.trim());
                                            event.currentTarget.blur();
                                            requestAnimationFrame(focusFirstCard);
                                        }
                                    }}
                                    aria-label="Search TRCustoms"
                                    enterKeyHint="search"
                                />
                            </label>
                            <div className="choices custom__sorts" role="radiogroup" aria-label="Order">
                                {SORTS.map((entry) => (
                                    <button
                                        key={entry.sort}
                                        type="button"
                                        role="radio"
                                        tabIndex={-1}
                                        onMouseDown={keepFocus}
                                        aria-checked={entry.sort === sort}
                                        className={`choice ${entry.sort === sort ? 'choice--on' : ''}`}
                                        onClick={() => setSort(entry.sort)}
                                    >
                                        {entry.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="custom__tools">
                            <button type="button" className="button custom__add" tabIndex={-1} onMouseDown={keepFocus} onClick={() => setAdding(true)}>
                                <PlusIcon />
                                <GameText text="Add from files" />
                            </button>
                        </div>
                    )}
                </div>
            </header>

            <div className="custom__body" ref={body}>
                {browseQuery !== null ? (
                    <BrowseGrid
                        query={browseQuery}
                        scroller={body}
                        gamedata={gamedata}
                        onOpen={(level) => setOpened({ kind: 'remote', level })}
                        onClearSearch={() => {
                            setTyped('');
                            setQuery('');
                        }}
                    />
                ) : (
                    <InstalledGrid
                        records={installed.filter((record) => record.engine === shownGame).reverse()}
                        game={shownGame}
                        onOpen={(record) => setOpened({ kind: 'installed', recordId: record.id })}
                        onBrowse={() => setSection('browse')}
                        onAdd={() => setAdding(true)}
                        levelInfo={levelInfo}
                        progress={progress}
                        lastPlayed={(record) =>
                            profiles.filter((profile) => profile.gamedataId === record.id).map((profile) => profile.lastPlayedAt).find((when) => when !== null) ?? null
                        }
                    />
                )}
            </div>

            <PromptBar className="custom__prompts">
                <MoveHint name="horizontal" label="Choose" />
                {section === 'browse' ? (
                    <>
                        <Prompt action="confirm" label="Details" />
                        <Prompt action="alternate" label={`Order: ${SORTS.find((entry) => entry.sort === sort)?.label ?? ''}`} global onPress={cycleSort} />
                        {buttons ? <Prompt action="extra" label="Search" global onPress={() => search.current?.focus()} /> : null}
                    </>
                ) : (
                    buttons ? <Prompt action="menu" label="Add from files" global onPress={() => setAdding(true)} /> : null
                )}
                <Prompt action="back" label="Back" global onPress={onClose} className="prompt-bar__end" />
            </PromptBar>
        </div>

            {opened !== null ? (
                <LevelDetails
                    summary={opened.kind === 'remote' ? opened.level : undefined}
                    recordId={opened.kind === 'installed' ? opened.recordId : undefined}
                    onClose={closeDetails}
                />
            ) : null}
            {adding ? (
                <AddLevelSheet
                    onClose={() => setAdding(false)}
                    onAdded={(record) => {
                        setAdding(false);
                        setSection('installed');
                        setGame(record.engine);
                    }}
                />
            ) : null}
        </>
    );
}

function SectionTab({ label, count, on, onPick }: { label: string; count?: number; on: boolean; onPick(): void }) {
    return (
        <button type="button" role="tab" tabIndex={-1} onMouseDown={keepFocus} aria-selected={on} className={`section-tab ${on ? 'section-tab--on' : ''}`} onClick={onPick}>
            <GameText text={label} />
            {count !== undefined && count > 0 ? <span className="section-tab__count">{count}</span> : null}
        </button>
    );
}

interface BrowseGridProps {
    query: BrowseQuery;
    scroller: RefObject<HTMLDivElement | null>;
    gamedata: readonly GameDataRecord[];
    onOpen(level: CustomLevelSummary): void;
    onClearSearch(): void;
}

function BrowseGrid({ query, scroller, gamedata, onOpen, onClearSearch }: BrowseGridProps) {
    const key = browseKey(query);
    const list = useBrowse((state) => state.lists[key]);
    const progress = useImports((state) => state.progress);
    const sentinel = useRef<HTMLLIElement>(null);
    const queryRef = useRef(query);
    queryRef.current = query;

    // The first page, and the next whenever the end of the list comes into view.
    useEffect(() => {
        void loadMore(queryRef.current);
    }, [key]);
    useEffect(() => {
        const target = sentinel.current;
        if (target === null) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) void loadMore(queryRef.current);
            },
            { root: scroller.current, rootMargin: '0px 0px 600px 0px' },
        );
        observer.observe(target);
        return () => observer.disconnect();
    }, [key, scroller, list?.levels.length]);

    const levels = list?.levels ?? [];
    const more = list === undefined || hasMore(list);

    // Results that replace the cards in focus, as a new search's do, hand a
    // gamepad or keyboard the first of them, so (A) never presses nothing.
    const arrived = levels.length > 0;
    useEffect(() => {
        const container = scroller.current;
        if (!arrived || container === null || !drivenByButtons()) return;
        const screen = container.closest('.custom');
        const active = document.activeElement;
        if (screen !== null && active instanceof HTMLElement && active !== document.body && screen.contains(active)) return;
        focusables(container)[0]?.focus({ preventScroll: true });
    }, [arrived, key, scroller]);
    return (
        <>
            {list?.total !== null && list?.total !== undefined && list.total > 0 ? (
                <p className="custom__count">
                    {list.total.toLocaleString()} {query.search !== '' ? `levels match “${query.search}”` : `${ENGINE_NAMES[query.game]} levels on TRCustoms`}
                </p>
            ) : null}
            <ul className="level-grid">
                {levels.map((level) => {
                    const copy = installedCopy(gamedata, level.id);
                    return <BrowseCard key={level.id} level={level} installed={copy} progress={copy === undefined ? undefined : progress[copy.id]} onOpen={onOpen} />;
                })}
                {more && list?.error == null ? (
                    <li ref={sentinel} className="level-grid__more" aria-live="polite">
                        <span className="level-grid__spinner" />
                        Loading levels…
                    </li>
                ) : null}
            </ul>
            {list?.error != null ? (
                <div className="custom__empty">
                    <p className="notice notice--error">{list.error}</p>
                    <button type="button" className="button" onClick={() => void loadMore(query)}>
                        <GameText text="Try again" />
                    </button>
                </div>
            ) : null}
            {list !== undefined && !list.loading && list.error === null && levels.length === 0 ? (
                <div className="custom__empty">
                    <p className="sheet__text">{query.search !== '' ? `No ${ENGINE_NAMES[query.game]} level matches “${query.search}”.` : 'TRCustoms lists no levels here yet.'}</p>
                    {query.search !== '' ? (
                        <button type="button" className="button" onClick={onClearSearch}>
                            <GameText text="Clear the search" />
                        </button>
                    ) : null}
                </div>
            ) : null}
        </>
    );
}

interface InstalledGridProps {
    records: GameDataRecord[];
    game: EngineNumber;
    levelInfo: ReturnType<typeof useLibrary.getState>['levelInfo'];
    progress: ReturnType<typeof useImports.getState>['progress'];
    lastPlayed(record: GameDataRecord): string | null;
    onOpen(record: GameDataRecord): void;
    onBrowse(): void;
    onAdd(): void;
}

function InstalledGrid({ records, game, levelInfo, progress, lastPlayed, onOpen, onBrowse, onAdd }: InstalledGridProps) {
    if (records.length === 0) {
        return (
            <div className="custom__empty">
                <p className="sheet__text">No {gameTitle(game)} levels in your library yet. Thousands are made by the community.</p>
                <div className="sheet__actions">
                    {game !== 4 ? (
                        <button type="button" className="button button--primary" onClick={onBrowse}>
                            <GameText text="Browse TRCustoms" />
                        </button>
                    ) : null}
                    <button type="button" className="button" onClick={onAdd}>
                        <GameText text="Add from files" />
                    </button>
                </div>
            </div>
        );
    }
    return (
        <ul className="level-grid">
            {records.map((record) => (
                <InstalledCard
                    key={record.id}
                    record={record}
                    info={levelInfo[record.id]}
                    progress={progress[record.id]}
                    lastPlayed={lastPlayed(record)}
                    onDetails={() => onOpen(record)}
                />
            ))}
        </ul>
    );
}
