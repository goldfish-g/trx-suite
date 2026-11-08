// Merging a profile's saves on a device with the cloud's, file by file,
// against what the two last agreed on (the base). A file only one side
// changed takes that side's change; a file both changed keeps the newer
// copy, and a file beats its deletion. Saves in other slots never meet.

import type { CloudFile } from '../../shared/cloud.ts';

export type FileList = Readonly<Record<string, CloudFile>>;

export interface SavesMerge {
    /** The files both sides hold once merged. */
    result: Record<string, CloudFile>;
    /** Files the device must take from the cloud. */
    download: string[];
    /** Files the device must delete. */
    removeLocal: string[];
    /** Whether the cloud must take the result: it differs from what the cloud has. */
    upload: boolean;
}

export function mergeSaves(local: FileList, remote: FileList, base: FileList): SavesMerge {
    const result: Record<string, CloudFile> = {};
    const download: string[] = [];
    const removeLocal: string[] = [];
    let upload = false;

    const paths = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)]);
    for (const path of [...paths].sort()) {
        const mine = local[path];
        const theirs = remote[path];
        const before = base[path];
        if (mine?.hash === theirs?.hash) {
            if (theirs !== undefined) result[path] = theirs;
            continue;
        }
        const mineChanged = mine?.hash !== before?.hash;
        const theirsChanged = theirs?.hash !== before?.hash;

        let take: 'mine' | 'theirs';
        if (!mineChanged) take = 'theirs';
        else if (!theirsChanged) take = 'mine';
        // Both changed it: a save beats its deletion, and the newer save the older.
        else if (mine === undefined) take = 'theirs';
        else if (theirs === undefined) take = 'mine';
        else take = mine.mtime > theirs.mtime ? 'mine' : 'theirs';

        if (take === 'theirs') {
            if (theirs === undefined) removeLocal.push(path);
            else {
                result[path] = theirs;
                download.push(path);
            }
        } else {
            upload = true;
            if (mine !== undefined) result[path] = mine;
        }
    }
    return { result, download, removeLocal, upload };
}
