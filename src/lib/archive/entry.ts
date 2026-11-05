/** A file inside an archive or a picked folder, read only when asked. */
export interface ArchiveEntry {
    /** The path inside the archive, with forward slashes. */
    path: string;
    size: number;
    read(): Promise<Blob>;
}

/** An archive the shell cannot read, with a reason to show the player. */
export class ArchiveError extends Error {}
