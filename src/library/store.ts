// What the library screen shows: the profiles and the game data, kept in
// step with storage.

import { create } from 'zustand';
import { listGameData, listLevelInfo } from '../gamedata/store';
import type { GameDataRecord, LevelInfoRecord } from '../gamedata/types';
import { onLibraryChange } from '../lib/changes';
import { listProfiles } from '../profiles/store';
import type { ProfileRecord } from '../profiles/types';

interface LibraryState {
    loaded: boolean;
    profiles: ProfileRecord[];
    gamedata: GameDataRecord[];
    /** What TRCustoms says about the custom levels from there, by game data id. */
    levelInfo: Record<string, LevelInfoRecord>;
}

export const useLibrary = create<LibraryState>(() => ({
    loaded: false,
    profiles: [],
    gamedata: [],
    levelInfo: {},
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
            const [profiles, gamedata, info] = await Promise.all([listProfiles(), listGameData(), listLevelInfo()]);
            const levelInfo = Object.fromEntries(info.map((entry) => [entry.gamedataId, entry]));
            useLibrary.setState({ loaded: true, profiles, gamedata, levelInfo });
        } while (again);
        refreshing = null;
    })();
    return refreshing;
}

onLibraryChange(() => void refreshLibrary());
