// What the page and the converter's worker tell each other.

/**
 * A file of the original game a converted package uses and does not bring,
 * as the converter lists it (references.ts): the page fetches it from the
 * server and puts it at `to` in the package, adding the server's extension
 * to a music track's.
 */
export interface BaseNeed {
    kind: 'level' | 'cut' | 'sfx' | 'fmv' | 'music';
    name: string;
    to: string;
}

/** A file by its path in the archive, or in the package made from it. */
export interface ConvertFile {
    path: string;
    data: Uint8Array;
}

export interface ConvertRequest {
    /** The name the package's game flow gives the level. */
    title: string;
    /** The package's directory, games/<modId>/. */
    modId: string;
    files: ConvertFile[];
}

export type ConvertReply =
    | { kind: 'step'; label: string }
    /** `needs`: files of the original game the package uses and lacks, for the page to fetch. */
    | { kind: 'done'; gameVersion: 1 | 2 | 3; files: ConvertFile[]; notes: string[]; needs: BaseNeed[] }
    /** `unplayable`: the message already says what the player needs, without a prefix. */
    | { kind: 'error'; message: string; unplayable?: boolean };
