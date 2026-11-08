import type { CloudFile } from '../../shared/cloud.ts';

/**
 * What a profile's saves for one game were when this device and the cloud
 * last agreed: the base the next sync merges both sides' changes against.
 */
export interface CloudSavesBase {
    /** `${profileId}/${mod}` */
    key: string;
    profileId: string;
    mod: string;
    /** The cloud it was agreed with, as `steam:<id>`. */
    account: string;
    rev: number;
    files: Record<string, CloudFile>;
}

/** Which cloud a profile syncs with: the one it was first sent to. */
export interface ProfileCloudLink {
    /** `steam:<id>` */
    account: string;
}
