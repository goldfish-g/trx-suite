// A profile as a row: "(A) Play (X) Rename (Y) Delete", renaming in place
// and asking before it deletes. A profile in the cloud is deleted there and
// on every device too, as its saves are one set everywhere.

import { useEffect, useState } from 'react';
import { deleteProfileEverywhere, useCloud } from '../cloud/sync';
import { playProfile } from '../menu/actions';
import { formatWhen } from '../ui/format';
import { CloudIcon, PlayIcon, TrashIcon } from '../ui/icons';
import { Prompt } from '../ui/Prompt';
import { Row } from '../ui/Row';
import { renameProfile } from './store';
import type { ProfileRecord } from './types';

export function ProfileRow({
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
    const cloudAccount = useCloud((state) => state.account);
    // Its saves are one set on every device signed in to this cloud.
    const synced = profile.cloud !== undefined && profile.cloud.account === cloudAccount;
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
                        <Prompt variant="row" action="confirm" label="Delete" className="prompt--danger" onPress={() => void deleteProfileEverywhere(profile)} />
                        <Prompt variant="row" action="back" label="Keep" onPress={() => setConfirmDelete(false)} />
                    </>
                }
            >
                <span className="row__title">
                    {synced ? `Delete ${profile.name} and its saves here, in the cloud and on your other devices?` : `Delete ${profile.name} and its saves?`}
                </span>
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
                Played {formatWhen(profile.lastPlayedAt)} · TRX {profile.engineVersion}
                {synced ? (
                    <span className="row__cloud" title="Its saves are in your cloud">
                        <CloudIcon />
                        In the cloud
                    </span>
                ) : null}
            </span>
        </Row>
    );
}
