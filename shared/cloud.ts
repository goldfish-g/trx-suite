// Cloud saves, as the server keeps them for a Steam account and the page
// syncs them: the account's profiles with their save files, and the custom
// levels it added (where to get them again, never the levels themselves).

import type { CustomLevelSummary } from './api.ts';
import type { EngineNumber } from './games.ts';

/** A save file, by its contents. The contents are fetched by hash. */
export interface CloudFile {
    /** SHA-256 of the contents, in hex. */
    hash: string;
    size: number;
    /** When the game last wrote it, in ms since 1970: the newer copy wins when two devices changed it. */
    mtime: number;
}

/**
 * A profile's saves for one game, the files in saves/ of its storage, by
 * their path there (saves/save_tr1_00.dat). Each change makes a new
 * revision; a change says which revision it builds on, so two devices never
 * overwrite each other unseen.
 */
export interface CloudSaves {
    rev: number;
    updatedAt: string;
    files: Record<string, CloudFile>;
}

/** What a device says about a profile. */
export interface CloudProfileMeta {
    id: string;
    name: string;
    /**
     * The game or custom level it plays, by the mod it has in the library:
     * tr2 for Tomb Raider II, custom-… for a custom level. Profiles meet their
     * game on another device by it.
     */
    title: string;
    /** What the engine is told to play, such as tr2, or tr1-level for a lone level. */
    mod: string;
    engine: EngineNumber;
    engineVersion: string;
    createdAt: string;
    lastPlayedAt: string | null;
    /** When it was made or renamed: the newer name wins. */
    updatedAt: string;
}

export interface CloudProfile extends CloudProfileMeta {
    /** Its saves, by the game (storage mod) they belong to. */
    saves: Record<string, CloudSaves>;
}

/** Where a custom level comes from, to download it again on another device. */
export type CloudLevelSource =
    | { kind: 'trcustoms'; levelId: number; fileId: number; version: number; sizeBytes?: number }
    | { kind: 'link'; url: string }
    /** Files picked on a device, which only come back the same way. */
    | { kind: 'upload'; name: string };

/** A custom level the player added. */
export interface CloudLevel {
    /** Its mod in the library, which its profiles name as their title. */
    mod: string;
    name: string;
    engine: EngineNumber;
    layout: 'custom' | 'level';
    source: CloudLevelSource;
    /** For a lone level, the level the engine starts. */
    startLevel?: string;
    /** What TRCustoms said about it, for its card. */
    summary?: CustomLevelSummary;
    addedAt: string;
    updatedAt: string;
}

/** The menus' look, as the player picked it in the settings. */
export const CLOUD_THEMES = ['tr1', 'tr2', 'tr3'] as const;
export type CloudTheme = (typeof CLOUD_THEMES)[number];

/** A setting with when the player last changed it: the latest change wins. */
export interface CloudSetting<T> {
    value: T;
    updatedAt: string;
}

/** The settings that follow the player to every device. PUT /api/cloud/settings takes any of them. */
export interface CloudSettings {
    theme?: CloudSetting<CloudTheme>;
}

/** GET /api/cloud: everything the cloud holds for the account, without the files' contents. */
export interface CloudIndex {
    account: { provider: 'steam'; id: string };
    settings: CloudSettings;
    profiles: CloudProfile[];
    levels: CloudLevel[];
    /**
     * Profiles deleted from the cloud, with when: a device that has one
     * deletes its copy too, as the saves are one set on every device.
     */
    removedProfiles: Record<string, string>;
    /**
     * Custom levels taken out of the cloud, with when: devices that still
     * hold one keep it, but no longer put it back.
     */
    removedLevels: Record<string, string>;
    usage: { bytes: number; limitBytes: number };
}

/** PUT /api/cloud/profiles/:id */
export interface PutProfileRequest extends CloudProfileMeta {
    /** Put back a profile deleted from the cloud; otherwise that answers 410. */
    restore?: boolean;
}

/** PUT /api/cloud/levels/:mod */
export interface PutLevelRequest extends Omit<CloudLevel, 'addedAt' | 'updatedAt'> {
    /**
     * The player added it on purpose, so it goes back into the cloud even if
     * it was taken out; a device that merely still has it is answered 410.
     */
    restore?: boolean;
}

/** PUT /api/cloud/saves/:profileId/:mod */
export interface PutSavesRequest {
    /** The revision the change builds on; 0 when the cloud had none. Another answers 409 with the current saves. */
    baseRev: number;
    files: Record<string, CloudFile>;
}

/** The body of a 409 from PUT /api/cloud/saves/…: someone else changed them first. */
export interface SavesConflict {
    error: 'conflict';
    message: string;
    saves: CloudSaves;
}

/**
 * Where a save file's path must lead: a file in saves/, a few directories
 * deep at most. TRX keeps each game's saves in a directory of its own there,
 * named after the game: saves/tr2/save_tr2_00.dat.
 */
export const CLOUD_SAVE_PATH = /^saves(?:\/(?!\.\.?(?:\/|$))[^/\\\0]{1,120}){1,4}$/;
export const CLOUD_HASH = /^[0-9a-f]{64}$/;
/** Profile ids are UUIDs the page makes. */
export const CLOUD_PROFILE_ID = /^[A-Za-z0-9-]{8,64}$/;
/** Mods of games, custom levels and lone levels: tr2, custom-the-cave-1234, tr1-level. */
export const CLOUD_MOD = /^[a-z0-9][a-z0-9._-]{0,79}$/;
