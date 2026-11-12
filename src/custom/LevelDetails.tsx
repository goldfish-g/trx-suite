// A custom level up close: its screenshots, what TRCustoms says about it,
// and what can be done with it: download it, play it, or delete it. The
// d-pad's left and right, or the bumpers, page through the screenshots; up
// and down scroll the description.

import { useEffect, useRef, useState } from 'react';
import type { CustomLevelDetails, CustomLevelSummary } from '../../shared/api.ts';
import { baseModOf } from '../engine/files';
import { cancelRedownload, retryImport, useImports } from '../gamedata/imports';
import type { GameDataRecord } from '../gamedata/types';
import { playEffect } from '../audio/effects';
import { pushLayer } from '../input/controller';
import { describeProgress, describeSource } from '../library/describe';
import { useLibrary } from '../library/store';
import { formatBytes } from '../ui/format';
import { GameText } from '../ui/GameText';
import { BackIcon, ChevronLeft, ChevronRight, DownloadIcon, ExternalIcon, PlayIcon, ProfilesIcon, TrashIcon } from '../ui/icons';
import { ProgressBar } from '../ui/ProgressBar';
import { Prompt, PromptBar } from '../ui/Prompt';
import { useAccount } from '../account/store';
import { cloudLevelFor, deleteFromCloud, useCloud } from '../cloud/sync';
import { cloudLevelOf, cloudProfilesOf } from '../cloud/view';
import { installFromCloud, installFromTrcustoms, playCustomLevel, redownloadCustomLevel, removeCustomLevel } from './actions';
import { CONVERTER_VERSION } from './convert';
import { fetchLevelDetails } from './api';
import { Description } from './Description';
import { Shot, useObjectUrl } from './LevelCard';
import { ProfilesSheet } from './ProfilesSheet';
import { authorsLine, gameTitle, keepFocus, lengthLabel, loneLevelNotice, ratingTone } from './labels';

interface Props {
    /** A level from TRCustoms, as a list showed it. */
    summary?: CustomLevelSummary;
    /** Or a level in the library, by its game data id. */
    recordId?: string;
    /** Or a level the cloud lists, added on another device, by its mod. */
    cloudMod?: string;
    onClose(): void;
}

/** The library's copy of a TRCustoms level, the newest when there are several. */
export function installedCopy(gamedata: readonly GameDataRecord[], levelId: number): GameDataRecord | undefined {
    return gamedata.filter((record) => record.source.kind === 'trcustoms' && record.source.levelId === levelId).at(-1);
}

export function LevelDetails({ summary: given, recordId, cloudMod, onClose }: Props) {
    const panel = useRef<HTMLDivElement>(null);
    const info = useRef<HTMLDivElement>(null);
    const main = useRef<HTMLDivElement>(null);
    const { gamedata, levelInfo } = useLibrary();
    const progress = useImports((state) => state.progress);
    const cloudIndex = useCloud((state) => state.index);
    const online = useAccount((state) => state.online);

    // A level from the cloud shows what the cloud kept of it, until it is downloaded.
    const cloudEntry = cloudMod !== undefined ? cloudIndex?.levels.find((level) => level.mod === cloudMod) : undefined;
    const summary = given ?? cloudEntry?.summary;
    const record =
        recordId !== undefined
            ? gamedata.find((candidate) => candidate.id === recordId)
            : summary !== undefined
              ? installedCopy(gamedata, summary.id)
              : cloudMod !== undefined
                ? gamedata.find((candidate) => candidate.layout !== 'game' && candidate.mod === cloudMod)
                : undefined;
    const listed = cloudEntry ?? (record !== undefined ? cloudLevelOf(cloudIndex, record) : summary !== undefined ? cloudLevelFor(summary.id) : undefined);
    const cloudProfiles = listed === undefined ? 0 : cloudProfilesOf(cloudIndex, listed.mod).length;
    const stored = record === undefined ? undefined : levelInfo[record.id];
    const levelId = summary?.id ?? (record?.source.kind === 'trcustoms' ? record.source.levelId : listed?.source.kind === 'trcustoms' ? listed.source.levelId : null);

    const [fetched, setFetched] = useState<CustomLevelDetails | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [confirm, setConfirm] = useState(false);
    const [confirmCloud, setConfirmCloud] = useState(false);
    const [showProfiles, setShowProfiles] = useState(false);
    const profileCount = useLibrary((state) => (record === undefined ? 0 : state.profiles.filter((profile) => profile.gamedataId === record.id).length));
    const [shot, setShot] = useState(0);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (levelId === null) return;
        const controller = new AbortController();
        fetchLevelDetails(levelId, controller.signal).then(setFetched, (error: unknown) => {
            // What the library keeps is enough offline.
            if (!controller.signal.aborted && stored === undefined) setProblem(error instanceof Error ? error.message : String(error));
        });
        return () => controller.abort();
        // The stored details only matter for whether a failure is worth showing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [levelId]);

    const details: CustomLevelDetails | undefined = fetched ?? stored?.details;
    const level: CustomLevelSummary | undefined = details ?? summary;
    const storedCover = useObjectUrl(stored?.cover);
    const shots = details?.screenshots.length ? details.screenshots : [level?.cover ?? storedCover].filter((url): url is string => url !== null);
    const shotCount = Math.max(1, shots.length);
    const turn = (step: number) => {
        if (shotCount > 1) playEffect('browse');
        setShot((current) => (current + step + shotCount) % shotCount);
    };

    // The panel is a layer of its own over the screen: (B) comes back here.
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    const confirmRef = useRef(confirm);
    confirmRef.current = confirm || confirmCloud;
    useEffect(() => {
        const pop = pushLayer({
            root: () => panel.current,
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
                    case 'down': {
                        // The text scrolls on its own beside the screenshots, or with them on a narrow screen.
                        const scroller = [info.current, main.current].find((element) => element !== null && element.scrollHeight > element.clientHeight + 1);
                        scroller?.scrollBy({ top: action === 'up' ? -160 : 160, behavior: 'smooth' });
                        return true;
                    }
                    case 'back':
                        if (confirmRef.current) {
                            setConfirm(false);
                            setConfirmCloud(false);
                            return true;
                        }
                        return false;
                    default:
                        return false;
                }
            },
            onBack: () => closeRef.current(),
        });
        return pop;
        // turn only reads state through its setter.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shotCount]);

    const engine = record?.engine ?? level?.game ?? null;
    // Converted levels fetch what they use of the original game as they come in; only lone level files lean on it.
    const lone = record?.layout === 'level';
    const hasBase = !lone || gamedata.some((candidate) => candidate.layout === 'game' && candidate.mod === baseModOf(record) && candidate.status === 'ready');

    const run = async (task: () => Promise<unknown>) => {
        setBusy(true);
        setProblem(null);
        try {
            await task();
        } catch (error) {
            setProblem(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    };

    let primary = null;
    if (record?.status === 'ready') {
        primary = <Prompt action="confirm" label="Play" variant="primary" global icon={<PlayIcon />} disabled={busy} onPress={() => void run(() => playCustomLevel(record))} />;
    } else if (record?.status === 'failed' && record.source.kind !== 'upload') {
        primary = <Prompt action="confirm" label="Try again" variant="primary" global disabled={busy} onPress={() => void run(() => retryImport(record.id))} />;
    } else if (record === undefined && listed !== undefined && listed.source.kind !== 'upload') {
        // Back as the cloud lists it: the version its saves were made in.
        const entry = listed;
        const size = entry.source.kind === 'trcustoms' ? (entry.source.sizeBytes ?? 0) : 0;
        primary = (
            <Prompt
                action="confirm"
                label={size > 0 ? `Download · ${formatBytes(size)}` : 'Download'}
                variant="primary"
                global
                icon={<DownloadIcon />}
                disabled={busy || !online}
                onPress={() => void run(() => installFromCloud(entry))}
            />
        );
    } else if (record === undefined && level?.file !== null && level?.file !== undefined && level.game !== null) {
        const file = level.file;
        primary = (
            <Prompt
                action="confirm"
                label={`Download · ${formatBytes(file.sizeBytes)}`}
                variant="primary"
                global
                icon={<DownloadIcon />}
                disabled={busy}
                onPress={() => void run(() => installFromTrcustoms(details ?? level))}
            />
        );
    }

    const described = record?.status === 'importing' && progress[record.id] !== undefined ? describeProgress(progress[record.id]!) : null;
    const facts: [string, string][] = [];
    if (level !== undefined) {
        if (level.difficulty !== null) facts.push(['Difficulty', level.difficulty]);
        const length = lengthLabel(level.duration);
        if (length !== null) facts.push(['Length', length]);
        if (level.genres.length > 0) facts.push(['Genres', level.genres.join(', ')]);
        if (details !== undefined && details.tags.length > 0) facts.push(['Tags', details.tags.join(', ')]);
        if (level.releaseDate !== '') facts.push(['Released', new Date(level.releaseDate).toLocaleDateString(undefined, { dateStyle: 'long' })]);
        facts.push(['Downloads', level.downloads.toLocaleString()]);
        if (level.reviews > 0) facts.push(['Reviews', level.reviews.toLocaleString()]);
        if (details !== undefined && details.walkthroughs > 0) facts.push(['Walkthroughs', details.walkthroughs.toLocaleString()]);
        if (level.file !== null) facts.push(['Archive', `${formatBytes(level.file.sizeBytes)}, version ${level.file.version}`]);
    }
    if (record !== undefined && record.status === 'ready') {
        facts.push(['In your library', `${formatBytes(record.sizeBytes)} · ${describeSource(record.source)}`]);
    }
    const source = record?.source;
    const newerFile = source?.kind === 'trcustoms' && level?.file != null && level.file.version > source.version ? level.file : null;
    const sameFile = source?.kind === 'trcustoms' && level?.file != null && level.file.id === source.fileId ? level.file : undefined;
    // A level converted by another converter than this one may lack its fixes.
    const stale = record?.convert === true && record.status === 'ready' && record.convertedWith !== CONVERTER_VERSION;
    const canRedownload = record !== undefined && record.status === 'ready' && record.source.kind !== 'upload';
    const replacing = record?.status === 'importing' && record.replacing !== undefined;

    const name = level?.name ?? record?.name ?? 'Custom level';
    const by = level !== undefined ? authorsLine(level) : null;
    const current = shots[Math.min(shot, shots.length - 1)] ?? null;

    return (
        <>
        <div className="details-layer" inert={showProfiles}>
            <div className="details-scrim" onClick={onClose} aria-hidden="true" />
            <div ref={panel} className="details" role="dialog" aria-modal="true" aria-label={name}>
                <div className="details__main" ref={main}>
                <div className="details__gallery">
                    <Shot src={current} engine={engine} className="details__shot" />
                    {shots.length > 1 ? (
                        <>
                            <button type="button" className="details__turn details__turn--left" tabIndex={-1} onMouseDown={keepFocus} aria-label="Previous screenshot" onClick={() => turn(-1)}>
                                <ChevronLeft />
                            </button>
                            <button type="button" className="details__turn details__turn--right" tabIndex={-1} onMouseDown={keepFocus} aria-label="Next screenshot" onClick={() => turn(1)}>
                                <ChevronRight />
                            </button>
                            <div className="details__thumbs">
                                {shots.map((url, index) => (
                                    <button
                                        key={url}
                                        type="button"
                                        tabIndex={-1}
                                        onMouseDown={keepFocus}
                                        className={`details__thumb ${index === shot ? 'details__thumb--on' : ''}`}
                                        aria-label={`Screenshot ${index + 1}`}
                                        onClick={() => setShot(index)}
                                    >
                                        <img src={url} alt="" loading="lazy" draggable={false} />
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : null}
                </div>

                <div className="details__info" ref={info}>
                    <p className="details__eyebrow">{engine !== null ? gameTitle(engine) : 'Custom level'}{level?.engineName && engine === null ? ` · ${level.engineName}` : ''}</p>
                    <h2 className={`details__title ${name.length > 24 ? 'details__title--long' : ''}`}>
                        <GameText text={name} />
                    </h2>
                    {by !== null ? <p className="details__by">{by}</p> : null}
                    {level !== undefined ? (
                        <p className="details__rating">
                            {level.rating !== null ? (
                                <span className={`rating rating--${ratingTone(level.rating.position)}`}>{level.rating.name}</span>
                            ) : (
                                <span className="rating rating--none">Not rated yet</span>
                            )}
                        </p>
                    ) : null}

                    {described !== null || record?.status === 'importing' ? (
                        <div className="details__progress">
                            <ProgressBar fraction={described?.fraction ?? null} label={described?.label ?? 'Waiting to continue…'} />
                        </div>
                    ) : null}
                    {record?.status === 'failed' ? <p className="notice notice--error">{record.error ?? 'Adding it failed.'}</p> : null}
                    {record?.layout === 'level' && !hasBase ? <p className="notice">{loneLevelNotice(record.engine)}</p> : null}
                    {replacing ? <p className="details__note">Downloading it again. Your saves stay, and so does the level you had if this fails.</p> : null}
                    {record?.reimportError !== undefined ? (
                        <p className="notice notice--error">Downloading it again failed: {record.reimportError} The level you had stays as it was.</p>
                    ) : null}
                    {newerFile !== null && record?.status === 'ready' && source?.kind === 'trcustoms' ? (
                        <p className="notice">
                            TRCustoms has version {newerFile.version} of it; you have version {source.version}. Updating keeps your saves, though a save
                            in a level the author has changed since may not load.
                        </p>
                    ) : stale ? (
                        <p className="notice">
                            It was converted by an older version of the converter. Download it again to convert it with the fixes made since; your saves
                            stay.
                        </p>
                    ) : null}
                    {record === undefined && listed !== undefined ? (
                        <p className="details__note">
                            {listed.source.kind === 'upload'
                                ? `In your cloud: added from ${listed.source.name} on another device. Add the same files here to play it with its saves.`
                                : cloudProfiles > 0
                                  ? `In your cloud, with the saves of ${cloudProfiles === 1 ? 'one profile' : `${cloudProfiles} profiles`}. Download it and they come back with it.`
                                  : 'In your cloud: you added it on another device.'}
                        </p>
                    ) : null}
                    {problem !== null ? <p className="notice notice--error">{problem}</p> : null}

                    {facts.length > 0 ? (
                        <dl className="details__facts">
                            {facts.map(([term, value]) => (
                                <div key={term} className="details__fact">
                                    <dt>{term}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : null}
                    {details !== undefined ? <Description text={details.description} /> : levelId !== null && problem === null ? <p className="details__loading">Loading the description…</p> : null}
                </div>
                </div>

                <PromptBar className="details__prompts">
                    {confirmCloud && listed !== undefined ? (
                        <>
                            <span className="details__ask">Delete it and its saves from the cloud and every device?</span>
                            <Prompt
                                action="confirm"
                                label="Delete"
                                variant="danger"
                                global
                                disabled={busy || !online}
                                onPress={() => {
                                    setConfirmCloud(false);
                                    void run(async () => {
                                        await deleteFromCloud(listed.mod);
                                        if (record === undefined && cloudMod !== undefined) onClose();
                                    });
                                }}
                            />
                            <Prompt action="back" label="Keep" global onPress={() => setConfirmCloud(false)} />
                        </>
                    ) : confirm && record !== undefined ? (
                        <>
                            <span className="details__ask">
                                {record.status === 'importing'
                                    ? 'Stop adding it?'
                                    : listed !== undefined
                                      ? 'Remove it from this device? Your cloud keeps it and its saves.'
                                      : 'Delete it with its saves?'}
                            </span>
                            <Prompt
                                action="confirm"
                                label={record.status === 'importing' ? 'Stop' : listed !== undefined ? 'Remove' : 'Delete'}
                                variant="danger"
                                global
                                onPress={() => {
                                    setConfirm(false);
                                    void run(() => removeCustomLevel(record));
                                }}
                            />
                            <Prompt action="back" label="Keep" global onPress={() => setConfirm(false)} />
                        </>
                    ) : (
                        <>
                            {primary}
                            {details?.pageUrl !== undefined ? (
                                <Prompt action="alternate" label="TRCustoms page" global iconic icon={<ExternalIcon />} onPress={() => window.open(details.pageUrl, '_blank', 'noopener')} />
                            ) : null}
                            {canRedownload && record !== undefined ? (
                                <Prompt
                                    action="menu"
                                    label={newerFile !== null ? `Update to version ${newerFile.version}` : 'Re-download'}
                                    variant={newerFile !== null || stale ? undefined : 'quiet'}
                                    className={newerFile !== null || stale ? 'prompt--accent' : undefined}
                                    global
                                    iconic={newerFile === null && !stale}
                                    icon={<DownloadIcon />}
                                    disabled={busy}
                                    onPress={() => void run(() => redownloadCustomLevel(record, newerFile ?? sameFile, details))}
                                />
                            ) : null}
                            {replacing && record !== undefined ? (
                                <Prompt action="extra" label="Stop" global onPress={() => void run(() => cancelRedownload(record.id))} />
                            ) : record !== undefined ? (
                                <Prompt action="extra" label={record.status === 'importing' ? 'Stop' : 'Delete'} global iconic icon={<TrashIcon />} onPress={() => setConfirm(true)} />
                            ) : listed !== undefined ? (
                                <Prompt action="extra" label="Delete from cloud" global iconic icon={<TrashIcon />} disabled={!online} onPress={() => setConfirmCloud(true)} />
                            ) : null}
                            {record?.status === 'ready' && profileCount > 0 ? (
                                <Prompt action="view" label={profileCount > 1 ? `Profiles · ${profileCount}` : 'Profiles'} global iconic icon={<ProfilesIcon />} onPress={() => setShowProfiles(true)} />
                            ) : null}
                            <Prompt action="back" label="Back" global icon={<BackIcon />} onPress={onClose} className="prompt-bar__end details__back" />
                        </>
                    )}
                </PromptBar>
            </div>
        </div>
        {showProfiles && record !== undefined ? <ProfilesSheet record={record} onClose={() => setShowProfiles(false)} /> : null}
        </>
    );
}
