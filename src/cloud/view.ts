// What the menus show of the cloud: its games and levels with their saves,
// and the levels this device has yet to download again.

import type { CloudIndex, CloudLevel, CloudProfile } from '../../shared/cloud.ts';
import { findOfficialGame } from '../../shared/games.ts';
import type { GameDataRecord } from '../gamedata/types';

/** A game or custom level in the cloud, with the profiles that play it. */
export interface CloudTitle {
    /** The mod profiles name it by. */
    title: string;
    name: string;
    kind: 'game' | 'level';
    level: CloudLevel | undefined;
    profiles: CloudProfile[];
    /** What its saves take up, each file once. */
    bytes: number;
    lastPlayedAt: string | null;
}

/** Every game and level the cloud holds something of, the last played first. */
export function cloudTitles(index: CloudIndex): CloudTitle[] {
    const titles = new Map<string, CloudTitle>();
    const entry = (title: string): CloudTitle => {
        let found = titles.get(title);
        if (found === undefined) {
            const game = findOfficialGame(title);
            found = { title, name: game?.title ?? title, kind: game !== undefined ? 'game' : 'level', level: undefined, profiles: [], bytes: 0, lastPlayedAt: null };
            titles.set(title, found);
        }
        return found;
    };
    for (const level of index.levels) {
        const found = entry(level.mod);
        found.level = level;
        found.name = level.name;
    }
    for (const profile of index.profiles) {
        const found = entry(profile.title);
        found.profiles.push(profile);
        if (found.kind === 'level' && found.level === undefined) found.name = profile.name;
        if (profile.lastPlayedAt !== null && (found.lastPlayedAt === null || profile.lastPlayedAt > found.lastPlayedAt)) found.lastPlayedAt = profile.lastPlayedAt;
    }
    for (const found of titles.values()) {
        const sizes = new Map<string, number>();
        for (const profile of found.profiles) {
            for (const saves of Object.values(profile.saves)) for (const file of Object.values(saves.files)) sizes.set(file.hash, file.size);
        }
        found.bytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
    }
    return [...titles.values()].sort(
        (a, b) => (b.lastPlayedAt ?? b.level?.addedAt ?? '').localeCompare(a.lastPlayedAt ?? a.level?.addedAt ?? '') || a.name.localeCompare(b.name),
    );
}

/** Whether a library record is the level a cloud entry lists. */
function sameLevel(level: CloudLevel, record: GameDataRecord): boolean {
    if (record.mod === level.mod) return true;
    return level.source.kind === 'trcustoms' && record.source.kind === 'trcustoms' && record.source.levelId === level.source.levelId;
}

/** The custom levels the cloud lists that are not in this device's library. */
export function cloudOnlyLevels(index: CloudIndex | null, gamedata: readonly GameDataRecord[]): CloudLevel[] {
    if (index === null) return [];
    const custom = gamedata.filter((record) => record.layout !== 'game');
    return index.levels.filter((level) => !custom.some((record) => sameLevel(level, record)));
}

/** The cloud's entry for a level of the library. */
export function cloudLevelOf(index: CloudIndex | null, record: GameDataRecord): CloudLevel | undefined {
    return index?.levels.find((level) => sameLevel(level, record));
}

/** The profiles the cloud keeps of a game or level. */
export function cloudProfilesOf(index: CloudIndex | null, title: string): CloudProfile[] {
    return index?.profiles.filter((profile) => profile.title === title) ?? [];
}
