// What the page and the converter's worker tell each other.

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
    | { kind: 'done'; gameVersion: 1 | 2 | 3; files: ConvertFile[]; notes: string[] }
    | { kind: 'error'; message: string };
