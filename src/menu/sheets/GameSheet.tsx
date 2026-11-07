// One official game: play it and manage its saves when it's in the library;
// otherwise download it, unlock it, or bring the files of your own copy.

import { useEffect, useState } from 'react';
import { useAccount } from '../../account/store';
import { removeGameData, retryImport } from '../../gamedata/imports';
import type { GameDataRecord } from '../../gamedata/types';
import { describeProgress, describeSource } from '../../library/describe';
import { useLibrary } from '../../library/store';
import { deleteProfile, renameProfile } from '../../profiles/store';
import type { ProfileRecord } from '../../profiles/types';
import { formatBytes, formatWhen } from '../../ui/format';
import { DownloadIcon, LockIcon, PlayIcon, PlusIcon, TrashIcon } from '../../ui/icons';
import { ProgressBar } from '../../ui/ProgressBar';
import { Prompt } from '../../ui/Prompt';
import { Row } from '../../ui/Row';
import { Sheet } from '../../ui/Sheet';
import { describeError, downloadGame, importOwnCopy, inspectPicked, newGameProfile, playGame, playProfile } from '../actions';
import { FilePicker } from '../FilePicker';
import type { ItemStatus, RingItem } from '../items';

interface Props {
    item: RingItem;
    status: ItemStatus;
    onClose(): void;
    onSignIn(): void;
}

export function GameSheet({ item, status, onClose, onSignIn }: Props) {
    const game = item.game!;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const offline = useOnlineNotice();
    const needsServer = status.kind === 'available' || status.kind === 'locked' || status.kind === 'failed';

    const run = async (task: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await task();
        } catch (problem) {
            setError(describeError(problem));
        } finally {
            setBusy(false);
        }
    };

    const ownCopy = (
        <section className="sheet__section">
            <h3 className="sheet__heading">Use your own copy</h3>
            <p className="sheet__text">
                Pick the game’s folder from an installed copy, or a zip of it. The files are checked to be {game.title} and stay
                on this device.
            </p>
            <FilePicker
                disabled={busy}
                onPick={(files, fromFolder) =>
                    void run(async () => {
                        const picked = await inspectPicked(files, fromFolder);
                        await importOwnCopy(game, picked);
                    })
                }
            />
        </section>
    );

    let body;
    switch (status.kind) {
        case 'installed':
            body = <Installed record={status.record} item={item} busy={busy} run={run} />;
            break;
        case 'importing': {
            const progress = status.progress === undefined ? null : describeProgress(status.progress);
            body = (
                <section className="sheet__section">
                    <ProgressBar fraction={progress?.fraction ?? null} label={progress?.label ?? 'Waiting to continue…'} />
                    <p className="sheet__text sheet__text--quiet">
                        Downloads carry on where they stopped if the page closes or the connection drops.
                    </p>
                    <div className="sheet__actions">
                        <button className="button" data-autofocus onClick={() => void run(() => removeGameData(status.record.id))}>
                            Cancel
                        </button>
                    </div>
                </section>
            );
            break;
        }
        case 'failed':
            body = (
                <section className="sheet__section">
                    <p className="notice notice--error">{status.record.error ?? 'Bringing in the files failed.'}</p>
                    <div className="sheet__actions">
                        {status.record.source.kind !== 'upload' ? (
                            <button className="button button--primary" data-autofocus onClick={() => void run(() => retryImport(status.record.id))}>
                                Try again
                            </button>
                        ) : null}
                        <button className="button" onClick={() => void run(() => removeGameData(status.record.id))}>
                            Remove
                        </button>
                    </div>
                </section>
            );
            break;
        case 'available':
            body = (
                <>
                    <section className="sheet__section">
                        <p className="sheet__text">
                            {status.entry.access === 'free'
                                ? `${game.title} was released for free by its publisher. It downloads once and then plays offline.`
                                : 'Your account owns this game. It downloads once and then plays offline.'}
                        </p>
                        <div className="sheet__actions">
                            <button
                                className="button button--primary"
                                data-autofocus
                                disabled={busy}
                                onClick={() => void run(() => downloadGame(status.entry))}
                            >
                                <DownloadIcon />
                                Download · {formatBytes(status.entry.sizeBytes)}
                            </button>
                        </div>
                    </section>
                    {ownCopy}
                </>
            );
            break;
        case 'locked':
            body = (
                <>
                    <section className="sheet__section">
                        <p className="notice">
                            <LockIcon />
                            <span>
                                Sign in with Steam or GOG with an account that owns {game.title}
                                {game.mod === 'tr3-la' ? ' (it comes with Tomb Raider I–III Remastered)' : ' or its remaster'} to
                                download it here.
                            </span>
                        </p>
                        <div className="sheet__actions">
                            <button className="button button--primary" data-autofocus onClick={onSignIn}>
                                Sign in to unlock
                            </button>
                        </div>
                    </section>
                    {ownCopy}
                </>
            );
            break;
        default:
            body = ownCopy;
    }

    return (
        <Sheet title={game.title} eyebrow={item.tagline} onClose={onClose}>
            {offline !== null && needsServer ? <p className="notice">{offline}</p> : null}
            {body}
            {error !== null ? <p className="notice notice--error">{error}</p> : null}
        </Sheet>
    );
}

function Installed({
    record,
    item,
    busy,
    run,
}: {
    record: GameDataRecord;
    item: RingItem;
    busy: boolean;
    run(task: () => Promise<unknown>): Promise<void>;
}) {
    const allProfiles = useLibrary((state) => state.profiles);
    const profiles = allProfiles.filter((profile) => profile.gamedataId === record.id);
    const [editing, setEditing] = useState<string | null>(null);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const game = item.game!;

    return (
        <>
            <section className="sheet__section">
                <div className="sheet__actions">
                    <button className="button button--primary button--large" data-autofocus disabled={busy} onClick={() => void run(() => playGame(record, game))}>
                        <PlayIcon />
                        {profiles.length === 0 ? 'Start playing' : 'Continue'}
                    </button>
                </div>
            </section>

            <section className="sheet__section">
                <h3 className="sheet__heading">Profiles</h3>
                <p className="sheet__text sheet__text--quiet">Each profile keeps its own saves and settings.</p>
                <ul className="list">
                    {profiles.map((profile) => (
                        <ProfileRow
                            key={profile.id}
                            profile={profile}
                            editing={editing === profile.id}
                            onEdit={() => setEditing(profile.id)}
                            onDone={() => setEditing(null)}
                        />
                    ))}
                </ul>
                <div className="sheet__actions">
                    <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                            void run(async () => {
                                const profile = await newGameProfile(record, `${game.title} ${profiles.length + 1}`);
                                setEditing(profile.id);
                            })
                        }
                    >
                        <PlusIcon />
                        New profile
                    </button>
                </div>
            </section>

            <section className="sheet__section">
                <h3 className="sheet__heading">Game files</h3>
                <p className="sheet__text sheet__text--quiet">
                    {describeSource(record.source)} · {formatBytes(record.sizeBytes)} · {record.fileCount} files
                </p>
                {confirmRemove ? (
                    <div className="confirm">
                        <p className="sheet__text">Remove the game files from this device? Profiles and saves stay.</p>
                        <div className="sheet__actions">
                            <button className="button button--danger" onClick={() => void run(() => removeGameData(record.id))}>
                                Remove
                            </button>
                            <button className="button" onClick={() => setConfirmRemove(false)}>
                                Keep
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="sheet__actions">
                        <button className="button button--quiet" onClick={() => setConfirmRemove(true)}>
                            <TrashIcon />
                            Remove from this device
                        </button>
                    </div>
                )}
            </section>
        </>
    );
}

function ProfileRow({
    profile,
    editing,
    onEdit,
    onDone,
}: {
    profile: ProfileRecord;
    editing: boolean;
    onEdit(): void;
    onDone(): void;
}) {
    const [name, setName] = useState(profile.name);
    const [confirmDelete, setConfirmDelete] = useState(false);
    useEffect(() => setName(profile.name), [profile.name]);
    const save = () => {
        const trimmed = name.trim();
        if (trimmed !== '' && trimmed !== profile.name) void renameProfile(profile.id, trimmed);
        onDone();
    };
    const cancel = () => {
        setName(profile.name);
        onDone();
    };

    if (editing) {
        return (
            <Row
                prompts={
                    <>
                        <Prompt variant="row" action="confirm" label="Save" onPress={save} />
                        <Prompt variant="row" action="back" label="Cancel" onPress={cancel} />
                    </>
                }
            >
                <input
                    className="field__input"
                    value={name}
                    autoFocus
                    maxLength={60}
                    aria-label="Profile name"
                    onChange={(event) => setName(event.target.value)}
                />
            </Row>
        );
    }
    if (confirmDelete) {
        return (
            <Row
                className="row--confirm"
                prompts={
                    <>
                        <Prompt variant="row" action="confirm" label="Delete" className="prompt--danger" onPress={() => void deleteProfile(profile.id)} />
                        <Prompt variant="row" action="back" label="Keep" onPress={() => setConfirmDelete(false)} />
                    </>
                }
            >
                <span className="row__title">Delete {profile.name} and its saves?</span>
            </Row>
        );
    }
    return (
        <Row
            label={profile.name}
            prompts={
                <>
                    <Prompt variant="row" action="confirm" label="Play" icon={<PlayIcon />} onPress={() => playProfile(profile)} />
                    <Prompt variant="row" action="alternate" label="Rename" onPress={onEdit} />
                    <Prompt variant="row" action="extra" label="Delete" icon={<TrashIcon />} onPress={() => setConfirmDelete(true)} />
                </>
            }
        >
            <span className="row__title">{profile.name}</span>
            <span className="row__meta">
                Played {formatWhen(profile.lastPlayedAt)} · engine {profile.engineVersion}
            </span>
        </Row>
    );
}

export function useOnlineNotice(): string | null {
    const online = useAccount((state) => state.online);
    return online ? null : 'You are offline. Downloads and sign-in wait for the connection.';
}
