import { ArchiveError, type ArchiveEntry } from './entry';
import { readTar } from './tar';
import { readZip } from './zip';

export { ArchiveError, type ArchiveEntry } from './entry';

/** Lists the files of a zip, tar or tar.gz archive, telling them apart by content. */
export async function readArchive(blob: Blob): Promise<ArchiveEntry[]> {
    const head = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4b) {
        return readZip(blob);
    }
    if (head[0] === 0x1f && head[1] === 0x8b) {
        return readTar(blob.stream().pipeThrough(new DecompressionStream('gzip')));
    }
    if (new TextDecoder().decode(head.subarray(257, 262)) === 'ustar') {
        return readTar(blob.stream());
    }
    throw new ArchiveError('This is not a zip, tar or tar.gz archive.');
}

/** Lists the files of a picked folder, at their paths inside it. */
export function readFolder(files: readonly File[]): ArchiveEntry[] {
    return files.map((file) => ({
        path: file.webkitRelativePath || file.name,
        size: file.size,
        read: async () => file,
    }));
}
