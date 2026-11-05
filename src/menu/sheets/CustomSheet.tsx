// Custom levels: pick one to play, or add a new one from its files.

import { useState } from 'react';
import { removeGameData, useImports } from '../../gamedata/imports';
import type { GameDataRecord } from '../../gamedata/types';
import { ENGINE_NAMES } from '../../games/catalog';
import { describeProgress } from '../../library/describe';
import { useLibrary } from '../../library/store';
import { LEVEL_CONVERTER_URL } from '../../links';
import { deleteProfile } from '../../profiles/store';
import type { ProfileRecord } from '../../profiles/types';
import { formatBytes, formatWhen } from '../../ui/format';
import { ExternalIcon, PlayIcon, TrashIcon } from '../../ui/icons';
import { ProgressBar } from '../../ui/ProgressBar';
import { Sheet } from '../../ui/Sheet';
import { addCustomLevel, baseGameFor, describeDetection, describeError, inspectPicked, playProfile, type PickedFiles } from '../actions';
import { FilePicker } from '../FilePicker';

export function CustomSheet({ onClose }: { onClose(): void }) {
    const { gamedata, profiles } = useLibrary();
    const custom = gamedata.filter((record) => record.layout !== 'game');
    const [picked, setPicked] = useState<PickedFiles | null>(null);
    const [level, setLevel] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const inspect = async (files: File[], fromFolder: boolean) => {
        setBusy(true);
        setError(null);
        setPicked(null);
        try {
            const result = await inspectPicked(files, fromFolder);
            setPicked(result);
            setLevel(result.detection.kind === 'level' ? (result.detection.levels[0] ?? '') : '');
        } catch (problem) {
            setError(describeError(problem));
        } finally {
            setBusy(false);
        }
    };

    const add = async () => {
        if (picked === null) return;
        setBusy(true);
        setError(null);
        try {
            await addCustomLevel(picked, level || undefined);
            setPicked(null);
        } catch (problem) {
            setError(describeError(problem));
        } finally {
            setBusy(false);
        }
    };

    const detection = picked?.detection;
    const playable = detection?.kind === 'custom' || detection?.kind === 'level';
    const base =
        detection?.kind === 'custom'
            ? baseGameFor(detection.engine, detection.extendsMod)
            : detection?.kind === 'level'
              ? baseGameFor(detection.engine, null)
              : undefined;
    const hasBase = base === undefined || gamedata.some((record) => record.mod === base.mod && record.status === 'ready');

    return (
        <Sheet title="Custom Levels" eyebrow="Your profiles" onClose={onClose} wide>
            <section className="sheet__section">
                {custom.length === 0 ? (
                    <p className="sheet__text">
                        No custom levels yet. Thousands are made by the community, for example on trcustoms.org. Add one from
                        its zip or folder.
                    </p>
                ) : (
                    <ul className="list">
                        {custom.map((record) => (
                            <CustomRow
                                key={record.id}
                                record={record}
                                profiles={profiles.filter((profile) => profile.gamedataId === record.id)}
                            />
                        ))}
                    </ul>
                )}
            </section>

            <section className="sheet__section">
                <h3 className="sheet__heading">Add a custom level</h3>
                <p className="sheet__text sheet__text--quiet">
                    TRX packages and lone level files play directly. Levels made for the original games or older engines
                    need converting first.
                </p>
                <FilePicker disabled={busy} onPick={(files, fromFolder) => void inspect(files, fromFolder)} />
                {busy && picked === null ? <p className="sheet__text sheet__text--quiet">Reading the files…</p> : null}
                {picked !== null && detection !== undefined ? (
                    <div className="card">
                        <p className="card__title">{picked.name}</p>
                        <p className="sheet__text">{describeDetection(detection)}</p>
                        {detection.kind === 'level' && detection.levels.length > 1 ? (
                            <label className="field">
                                <span className="field__label">Level to start</span>
                                <select className="field__input" value={level} onChange={(event) => setLevel(event.target.value)}>
                                    {detection.levels.map((path) => (
                                        <option key={path} value={path}>
                                            {path.slice(path.lastIndexOf('/') + 1)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ) : null}
                        {playable && !hasBase && base !== undefined ? (
                            <p className="notice">
                                It builds on {base.title}, which isn’t in your library yet. Add {base.title} too, or the level
                                may not start.
                            </p>
                        ) : null}
                        <div className="sheet__actions">
                            {playable ? (
                                <button className="button button--primary" data-autofocus disabled={busy} onClick={() => void add()}>
                                    Add to my levels
                                </button>
                            ) : null}
                            {detection.kind === 'convert' && LEVEL_CONVERTER_URL !== null ? (
                                <a className="button" href={LEVEL_CONVERTER_URL} target="_blank" rel="noreferrer">
                                    <ExternalIcon />
                                    Open the Level Converter
                                </a>
                            ) : null}
                            <button className="button button--quiet" onClick={() => setPicked(null)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : null}
                {error !== null ? <p className="notice notice--error">{error}</p> : null}
            </section>
        </Sheet>
    );
}

function CustomRow({ record, profiles }: { record: GameDataRecord; profiles: ProfileRecord[] }) {
    const progress = useImports((state) => state.progress[record.id]);
    const [confirm, setConfirm] = useState(false);
    const profile = profiles[0];

    const remove = async () => {
        for (const owned of profiles) await deleteProfile(owned.id);
        await removeGameData(record.id);
    };

    let detail;
    if (record.status === 'importing') {
        const described = progress === undefined ? null : describeProgress(progress);
        detail = <ProgressBar fraction={described?.fraction ?? null} label={described?.label ?? 'Waiting…'} />;
    } else if (record.status === 'failed') {
        detail = <span className="list__meta list__meta--error">{record.error ?? 'Adding it failed.'}</span>;
    } else {
        detail = (
            <span className="list__meta">
                {ENGINE_NAMES[record.engine]} · {formatBytes(record.sizeBytes)}
                {profile !== undefined ? ` · played ${formatWhen(profile.lastPlayedAt)}` : ''}
            </span>
        );
    }

    if (confirm) {
        return (
            <li className="list__row">
                <span className="list__main">Delete {record.name} with its saves?</span>
                <button className="button button--small button--danger" onClick={() => void remove()}>
                    Delete
                </button>
                <button className="button button--small" onClick={() => setConfirm(false)}>
                    Keep
                </button>
            </li>
        );
    }
    return (
        <li className="list__row">
            <span className="list__main">
                <span className="list__title">{record.name}</span>
                {detail}
            </span>
            {record.status === 'ready' && profile !== undefined ? (
                <button className="button button--small button--primary" onClick={() => playProfile(profile)}>
                    <PlayIcon />
                    Play
                </button>
            ) : null}
            <button className="button button--small button--quiet" onClick={() => setConfirm(true)} aria-label={`Delete ${record.name}`}>
                <TrashIcon />
            </button>
        </li>
    );
}
