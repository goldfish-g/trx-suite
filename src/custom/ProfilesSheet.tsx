// A custom level's profiles, each its own set of saves: play one, rename
// it, delete it, or start another. (A) on the level plays the one played
// last; this is where to pick another.

import { useState } from 'react';
import type { GameDataRecord } from '../gamedata/types';
import { useLibrary } from '../library/store';
import { describeError } from '../menu/actions';
import { ProfileRow } from '../profiles/ProfileRow';
import { GameText } from '../ui/GameText';
import { PlusIcon } from '../ui/icons';
import { Sheet } from '../ui/Sheet';
import { newCustomProfile } from './actions';

export function ProfilesSheet({ record, onClose }: { record: GameDataRecord; onClose(): void }) {
    const allProfiles = useLibrary((state) => state.profiles);
    const profiles = allProfiles.filter((profile) => profile.gamedataId === record.id);
    const [editing, setEditing] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const add = async () => {
        setBusy(true);
        setError(null);
        try {
            const profile = await newCustomProfile(record, `${record.name} ${profiles.length + 1}`);
            setEditing(profile.id);
        } catch (problem) {
            setError(describeError(problem));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet title={record.name} eyebrow="Profiles" onClose={onClose}>
            <section className="sheet__section">
                <p className="sheet__text sheet__text--quiet">
                    Each profile keeps its own saves. Play on the level continues the one played last.
                </p>
                {profiles.length > 0 ? (
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
                ) : (
                    <p className="sheet__text">No profiles yet: playing the level makes the first.</p>
                )}
                <div className="sheet__actions">
                    <button className="button" disabled={busy} onClick={() => void add()}>
                        <PlusIcon />
                        <GameText text="New profile" />
                    </button>
                </div>
                {error !== null ? <p className="notice notice--error">{error}</p> : null}
            </section>
        </Sheet>
    );
}
