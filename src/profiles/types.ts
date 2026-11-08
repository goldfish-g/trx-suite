import type { ProfileCloudLink } from '../cloud/types';
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
    /**
     * The game or custom level it plays, by its game data's mod, which stays
     * the same on every device; missing on profiles made before the cloud.
     */
    title?: string;
    /** When it was made or renamed: the newer name wins between devices. */
    updatedAt?: string;
    /** Set once the profile is in a cloud, which it then syncs with. */
    cloud?: ProfileCloudLink;
}
