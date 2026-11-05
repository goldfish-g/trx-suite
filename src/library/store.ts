// What the library screen shows: the profiles and the game data, kept in
// step with storage.

import { create } from 'zustand';
import { listGameData } from '../gamedata/store';
import type { GameDataRecord } from '../gamedata/types';
import { onLibraryChange } from '../lib/changes';
import { listProfiles } from '../profiles/store';
import type { ProfileRecord } from '../profiles/types';

interface LibraryState {
    loaded: boolean;
    profiles: ProfileRecord[];
    gamedata: GameDataRecord[];
}

export const useLibrary = create<LibraryState>(() => ({
    loaded: false,
    profiles: [],
    gamedata: [],
}));

let refreshing: Promise<void> | null = null;
let again = false;

/** Reads the library from storage again, once at a time. */
export function refreshLibrary(): Promise<void> {
    if (refreshing !== null) {
        again = true;
        return refreshing;
    }
    refreshing = (async () => {
        do {
            again = false;
            const [profiles, gamedata] = await Promise.all([listProfiles(), listGameData()]);
            useLibrary.setState({ loaded: true, profiles, gamedata });
        } while (again);
        refreshing = null;
    })();
    return refreshing;
}

onLibraryChange(() => void refreshLibrary());
