// Custom levels, over the level flying by: the ones in the library
// (Library), with those the cloud lists from other devices to download
// again, and the ones on TRCustoms (Browse), each by the game they were
// made for. The triggers switch between Library and Browse, the bumpers
// between Tomb Raider I, II and III; a click or a tap on a tab does too.
// Levels are cards: (A) opens one, or plays one already installed.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { CustomLevelGame, CustomLevelSort, CustomLevelSummary } from '../../shared/api.ts';
import type { CloudIndex, CloudLevel } from '../../shared/cloud.ts';
import type { GameDataRecord } from '../gamedata/types';
import { useImports } from '../gamedata/imports';
import { ENGINE_NAMES, type EngineNumber } from '../games/catalog';
import { playEffect } from '../audio/effects';
import { pushLayer, useInputDevice } from '../input/controller';
import { focusables } from '../input/spatial';
import { useLibrary } from '../library/store';
import { GameText } from '../ui/GameText';
import { BackIcon, PlusIcon, SearchIcon, SortIcon } from '../ui/icons';
import { Glyph, MoveHint, Prompt, PromptBar } from '../ui/Prompt';
import { AddLevelSheet } from './AddLevelSheet';
import { browseKey, hasMore, loadMore, SORTS, useBrowse, type BrowseQuery } from './browse';
import { gameTitle, keepFocus } from './labels';
import { BrowseCard, CloudCard, InstalledCard } from './LevelCard';
import { installedCopy, LevelDetails } from './LevelDetails';
import { PoweredBy } from './PoweredBy';
import { useCloud } from '../cloud/sync';
import { cloudLevelOf, cloudOnlyLevels, cloudProfilesOf } from '../cloud/view';

type Section = 'installed' | 'browse';
type Opened = { kind: 'remote'; level: CustomLevelSummary } | { kind: 'installed'; recordId: string } | { kind: 'cloud'; mod: string };

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
    // Levels added on another device, which the cloud lists for downloading here.
    const cloudIndex = useCloud((state) => state.index);
    const cloudOnly = useMemo(() => cloudOnlyLevels(cloudIndex, gamedata), [cloudIndex, gamedata]);
    // A tab for TR4 too, once the library holds a level for it.
    const installedGames = useMemo<EngineNumber[]>(
        () => (installed.some((record) => record.engine === 4) || cloudOnly.some((level) => level.engine === 4) ? [1, 2, 3, 4] : [1, 2, 3]),
        [installed, cloudOnly],
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
    // A tab turns over like a page, by trigger, bumper, click or tap.
    const shownTab = useRef(`${section}:${shownGame}`);
    useEffect(() => {
        const tab = `${section}:${shownGame}`;
        if (shownTab.current === tab) return;
        shownTab.current = tab;
        playEffect('tab');
    }, [section, shownGame]);
    // A new order sounds however it was picked: a click, (X) or F.
    const shownSort = useRef(sort);
    useEffect(() => {
        if (shownSort.current === sort) return;
        shownSort.current = sort;
        playEffect('press');
    }, [sort]);
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
    const actions = useRef({ stepGame, setSection, onClose, cycleSort, section });
    actions.current = { stepGame, setSection, onClose, cycleSort, section };
    useEffect(
        () =>
            pushLayer({
                root: () => root.current,
                // Going from level to level is light, not the sound of an item opening.
                moveSound: 'browse',
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
                        // On TRCustoms, (X) orders the levels and (Y) searches them, as
                        // the glyphs beside the order and the search box show. The
                        // library's cards have (X) and (Y) prompts of their own.
                        case 'alternate':
                            if (actions.current.section !== 'browse') return false;
                            actions.current.cycleSort();
                            return true;
                        case 'extra':
                            if (actions.current.section !== 'browse') return false;
                            search.current?.focus();
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

    const sortLabel = SORTS.find((entry) => entry.sort === sort)?.label ?? '';
    const browseTotal = useBrowse((state) => (section === 'browse' && shownGame !== 4 ? state.lists[browseKey({ game: shownGame, sort, search: '' })]?.total : null));
    const searchHint = `Search ${browseTotal !== null && browseTotal !== undefined ? `${browseTotal.toLocaleString()} ` : ''}levels`;

    const browseQuery: BrowseQuery | null = section === 'browse' && shownGame !== 4 ? { game: shownGame, sort, search: query } : null;

    const closeDetails = () => {
        const back = opened;
        setOpened(null);
        // The card the details came from takes the focus back.
        requestAnimationFrame(() => {
            const selector =
                back?.kind === 'remote'
                    ? `[data-level="${back.level.id}"]`
                    : back?.kind === 'installed'
                      ? `[data-record="${back.recordId}"]`
                      : back?.kind === 'cloud'
                        ? `[data-record="cloud:${back.mod}"]`
                        : null;
            const card = selector === null ? null : root.current?.querySelector<HTMLElement>(selector);
            if (card !== null && card !== undefined) card.focus({ preventScroll: true });
            else if (drivenByButtons()) focusFirstCard();
        });
    };

    return (
        <>
        <div className={`custom ${opened !== null ? 'custom--covered' : ''}`} ref={root} role="dialog" aria-modal="true" aria-label="Custom levels" inert={opened !== null || adding}>
            <header className="custom__header">
                {section === 'browse' ? <PoweredBy place="bar" /> : null}
                <div className="custom__tabs custom__tabs--sections" role="tablist" aria-label="Section">
                    <Glyph name="sectionPrevious" />
                    <SectionTab label="Library" on={section === 'installed'} onPick={() => setSection('installed')} />
                    <SectionTab label="Browse" on={section === 'browse'} onPick={() => setSection('browse')} />
                    <Glyph name="sectionNext" />
                </div>
                {buttons ? null : <Prompt action="back" label="Back" global icon={<BackIcon />} onPress={onClose} className="custom__back" />}
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
                                    placeholder={searchHint}
                                    value={typed}
                                    onChange={(event) => setTyped(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            setQuery(typed.trim());
                                            event.currentTarget.blur();
                                            requestAnimationFrame(focusFirstCard);
                                        }
                                    }}
                                    aria-label="Search TRCustoms by name or author"
                                    title="Search by name or author"
                                    enterKeyHint="search"
                                />
                                <Glyph name="extra" />
                            </label>
                            <div className="custom__sort">
                            <Glyph name="alternate" />
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
                            <button type="button" className="choice choice--on custom__order" tabIndex={-1} onMouseDown={keepFocus} onClick={cycleSort} title="Order">
                                <SortIcon />
                                <span className="custom__order-name">Order</span>
                                {sortLabel}
                            </button>
                            </div>
                        </div>
                    ) : (
                        <div className="custom__tools">
                            <Prompt action="menu" label="Add from files" global icon={<PlusIcon />} onPress={() => setAdding(true)} className="custom__add" />
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
                        cloudLevels={cloudOnly.filter((level) => level.engine === shownGame)}
                        cloudIndex={cloudIndex}
                        game={shownGame}
                        onOpen={(record) => setOpened({ kind: 'installed', recordId: record.id })}
                        onOpenCloud={(level) => setOpened({ kind: 'cloud', mod: level.mod })}
                        onBrowse={() => setSection('browse')}
                        onAdd={() => setAdding(true)}
                        levelInfo={levelInfo}
                        progress={progress}
                        lastPlayed={(record) =>
                            profiles.filter((profile) => profile.gamedataId === record.id).map((profile) => profile.lastPlayedAt).find((when) => when !== null) ?? null
                        }
                        profilesOf={(record) => profiles.filter((profile) => profile.gamedataId === record.id).length}
                    />
                )}
            </div>

            {buttons ? (
                <PromptBar className="custom__prompts">
                    <MoveHint name="horizontal" label="Choose" />
                    {section === 'browse' ? <Prompt action="confirm" label="Details" /> : null}
                    <Prompt action="back" label="Back" global onPress={onClose} className="prompt-bar__end" />
                </PromptBar>
            ) : null}
        </div>

            {opened !== null ? (
                <LevelDetails
                    summary={opened.kind === 'remote' ? opened.level : undefined}
                    recordId={opened.kind === 'installed' ? opened.recordId : undefined}
                    cloudMod={opened.kind === 'cloud' ? opened.mod : undefined}
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

function SectionTab({ label, on, onPick }: { label: string; on: boolean; onPick(): void }) {
    return (
        <button type="button" role="tab" tabIndex={-1} onMouseDown={keepFocus} aria-selected={on} className={`section-tab ${on ? 'section-tab--on' : ''}`} onClick={onPick}>
            <GameText text={label} />
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
            <PoweredBy place="list" />
            {/* How many levels TRCustoms has is said in the search box; a search says how many it found. */}
            {query.search !== '' && list?.total !== null && list?.total !== undefined && list.total > 0 ? (
                <p className="custom__count">
                    {list.total.toLocaleString()} {list.total === 1 ? 'level matches' : 'levels match'} “{query.search}”
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
    /** Levels the cloud lists that this device has not got. */
    cloudLevels: CloudLevel[];
    cloudIndex: CloudIndex | null;
    game: EngineNumber;
    levelInfo: ReturnType<typeof useLibrary.getState>['levelInfo'];
    progress: ReturnType<typeof useImports.getState>['progress'];
    lastPlayed(record: GameDataRecord): string | null;
    profilesOf(record: GameDataRecord): number;
    onOpen(record: GameDataRecord): void;
    onOpenCloud(level: CloudLevel): void;
    onBrowse(): void;
    onAdd(): void;
}

function InstalledGrid({ records, cloudLevels, cloudIndex, game, levelInfo, progress, lastPlayed, profilesOf, onOpen, onOpenCloud, onBrowse, onAdd }: InstalledGridProps) {
    if (records.length === 0 && cloudLevels.length === 0) {
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
        <>
            {records.length > 0 ? (
                <ul className="level-grid">
                    {records.map((record) => (
                        <InstalledCard
                            key={record.id}
                            record={record}
                            info={levelInfo[record.id]}
                            progress={progress[record.id]}
                            lastPlayed={lastPlayed(record)}
                            inCloud={cloudLevelOf(cloudIndex, record) !== undefined}
                            profiles={profilesOf(record)}
                            onDetails={() => onOpen(record)}
                        />
                    ))}
                </ul>
            ) : null}
            {cloudLevels.length > 0 ? (
                <>
                    <h3 className="custom__subhead">
                        <GameText text="In your cloud" />
                        <span className="custom__subnote">Added on another device. Download one to play it here; its saves come with it.</span>
                    </h3>
                    <ul className="level-grid">
                        {cloudLevels.map((level) => {
                            const profiles = cloudProfilesOf(cloudIndex, level.mod);
                            const played = profiles.map((profile) => profile.lastPlayedAt).filter((when): when is string => when !== null).sort().at(-1) ?? null;
                            return (
                                <CloudCard
                                    key={level.mod}
                                    level={level}
                                    profiles={profiles.length}
                                    lastPlayed={played}
                                    onDetails={() => onOpenCloud(level)}
                                    onAddFiles={onAdd}
                                />
                            );
                        })}
                    </ul>
                </>
            ) : null}
        </>
    );
}
