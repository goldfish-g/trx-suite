import type { EngineNumber } from '../games/catalog';

export interface ProfileRecord {
    id: string;
    name: string;
    gamedataId: string;
    mod: string;
    engine: EngineNumber;
    /** The engine build the profile plays with, pinned when it was made. */
    engineVersion: string;
    /** The mods the profile has kept saves for, so deleting it can clear them. */
    storageMods: string[];
    createdAt: string;
    lastPlayedAt: string | null;
}
