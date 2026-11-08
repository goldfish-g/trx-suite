// A custom level as a card: its screenshot, name, rating class, difficulty
// and length. Browse cards open the level's details; installed cards carry
// their own prompts, "(A) Play (X) Details (Y) Delete", like rows do.

import { useEffect, useState, type MouseEvent } from 'react';
import type { CustomLevelSummary } from '../../shared/api.ts';
import { cancelRedownload, retryImport, type ImportProgress } from '../gamedata/imports';
import type { GameDataRecord, LevelInfoRecord } from '../gamedata/types';
import { ENGINE_NAMES, type EngineNumber } from '../games/catalog';
import { describeProgress } from '../library/describe';
import { formatBytes, formatWhen } from '../ui/format';
import { GameText } from '../ui/GameText';
import { CheckIcon, PlayIcon, TrashIcon } from '../ui/icons';
import { ProgressBar } from '../ui/ProgressBar';
import { Prompt } from '../ui/Prompt';
import { playCustomLevel, removeCustomLevel } from './actions';
import { CONVERTER_VERSION } from './convert';
import { authorsLine, lengthLabel, ratingTone } from './labels';

/** An object URL for a stored image, for as long as the card shows it. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (blob === null || blob === undefined) {
            setUrl(null);
            return;
        }
        const made = URL.createObjectURL(blob);
        setUrl(made);
        return () => URL.revokeObjectURL(made);
    }, [blob]);
    return url;
}

export function Shot({ src, engine, className }: { src: string | null; engine: EngineNumber | null; className?: string }) {
    const [failed, setFailed] = useState(false);
    return (
        <div className={`shot ${className ?? ''}`}>
            {src !== null && !failed ? (
                <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
            ) : (
                <span className="shot__placeholder">
                    <GameText text={engine === null ? 'TRX' : ENGINE_NAMES[engine]} />
                </span>
            )}
        </div>
    );
}

type Facts = Pick<CustomLevelSummary, 'name' | 'authors' | 'rating' | 'difficulty' | 'duration'>;

function CardText({ level }: { level: Facts }) {
    const by = authorsLine(level);
    const meta = [level.difficulty, lengthLabel(level.duration)].filter(Boolean).join(' · ');
    return (
        <span className="level-card__text">
            <span className="level-card__name">{level.name}</span>
            {by !== null ? <span className="level-card__by">{by}</span> : null}
            <span className="level-card__facts">
                {level.rating !== null ? (
                    <span className={`rating rating--${ratingTone(level.rating.position)}`}>{level.rating.name}</span>
                ) : (
                    <span className="rating rating--none">Not rated yet</span>
                )}
                {meta !== '' ? <span className="level-card__meta">{meta}</span> : null}
            </span>
        </span>
    );
}

function InstalledBadge({ record, progress }: { record: GameDataRecord; progress: ImportProgress | undefined }) {
    if (record.status === 'ready') {
        return (
            <span className="level-card__badge level-card__badge--ready">
                <CheckIcon />
                Installed
            </span>
        );
    }
    if (record.status === 'failed') return <span className="level-card__badge level-card__badge--failed">Failed</span>;
    const described = progress === undefined ? null : describeProgress(progress);
    return (
        <span className="level-card__badge level-card__badge--busy">
            {described?.fraction !== null && described?.fraction !== undefined ? `${Math.round(described.fraction * 100)} %` : 'Adding…'}
        </span>
    );
}

interface BrowseCardProps {
    level: CustomLevelSummary;
    /** The level in the library, when it is there. */
    installed: GameDataRecord | undefined;
    progress: ImportProgress | undefined;
    onOpen(level: CustomLevelSummary): void;
}

export function BrowseCard({ level, installed, progress, onOpen }: BrowseCardProps) {
    return (
        <li className="level-card">
            <button type="button" className="level-card__face" data-level={level.id} onClick={() => onOpen(level)}>
                <Shot src={level.cover} engine={level.game} />
                {installed !== undefined ? <InstalledBadge record={installed} progress={progress} /> : null}
                <CardText level={level} />
            </button>
        </li>
    );
}

interface InstalledCardProps {
    record: GameDataRecord;
    info: LevelInfoRecord | undefined;
    progress: ImportProgress | undefined;
    lastPlayed: string | null;
    onDetails(): void;
}

export function InstalledCard({ record, info, progress, lastPlayed, onDetails }: InstalledCardProps) {
    const [confirm, setConfirm] = useState(false);
    const cover = useObjectUrl(info?.cover);
    const facts: Facts = info?.details ?? { name: record.name, authors: [], rating: null, difficulty: null, duration: null };

    let status;
    if (record.status === 'importing') {
        const described = progress === undefined ? null : describeProgress(progress);
        status = <ProgressBar fraction={described?.fraction ?? null} label={described?.label ?? 'Waiting to continue…'} />;
    } else if (record.status === 'failed') {
        status = <span className="level-card__status level-card__status--error">{record.error ?? 'Adding it failed.'}</span>;
    } else {
        status = (
            <span className="level-card__status">
                {formatBytes(record.sizeBytes)}
                {lastPlayed !== null ? ` · played ${formatWhen(lastPlayed)}` : ' · not played yet'}
                {record.convert === true && record.convertedWith !== CONVERTER_VERSION ? (
                    <span className="level-card__fresh">New conversion available</span>
                ) : null}
            </span>
        );
    }
    // Downloading a level that played again: stopping keeps the level and its saves.
    const replacing = record.status === 'importing' && record.replacing !== undefined;

    const click = (event: MouseEvent<HTMLLIElement>) => {
        if (event.target instanceof Element && event.target.closest('button, a')) return;
        const main = event.currentTarget.querySelector<HTMLElement>('[data-action="confirm"]:not(:disabled)');
        if (main !== null) main.click();
        else onDetails();
    };

    return (
        <li className={`level-card level-card--installed ${confirm ? 'level-card--confirm' : ''}`} tabIndex={0} data-scope="" data-record={record.id} onClick={click}>
            <Shot src={cover} engine={record.engine} />
            <CardText level={{ ...facts, name: record.name }} />
            <span className="level-card__foot">{status}</span>
            <span className="level-card__prompts">
                {confirm ? (
                    <>
                        <span className="level-card__ask">Delete it with its saves?</span>
                        <Prompt variant="row" action="confirm" label="Delete" className="prompt--danger" onPress={() => void removeCustomLevel(record)} />
                        <Prompt variant="row" action="back" label="Keep" onPress={() => setConfirm(false)} />
                    </>
                ) : (
                    <>
                        {record.status === 'ready' ? (
                            <Prompt variant="row" action="confirm" label="Play" icon={<PlayIcon />} onPress={() => void playCustomLevel(record)} />
                        ) : null}
                        {record.status === 'failed' && record.source.kind !== 'upload' ? (
                            <Prompt variant="row" action="confirm" label="Try again" onPress={() => void retryImport(record.id)} />
                        ) : null}
                        <Prompt variant="row" action="alternate" label="Details" onPress={onDetails} />
                        {replacing ? (
                            <Prompt variant="row" action="extra" label="Stop" onPress={() => void cancelRedownload(record.id)} />
                        ) : (
                            <Prompt variant="row" action="extra" label={record.status === 'importing' ? 'Cancel' : 'Delete'} icon={<TrashIcon />} onPress={() => setConfirm(true)} />
                        )}
                    </>
                )}
            </span>
        </li>
    );
}
