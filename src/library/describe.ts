import type { ImportProgress } from '../gamedata/imports';
import type { GameDataSource } from '../gamedata/types';
import { formatBytes } from '../ui/format';

export function describeProgress(progress: ImportProgress): { fraction: number | null; label: string } {
    const { phase, done, total, notice } = progress;
    const fraction = total !== null && total > 0 ? done / total : null;
    if (notice !== null) return { fraction, label: notice };
    if (phase === 'downloading') {
        if (done === 0) return { fraction: null, label: 'Starting the download…' };
        return {
            fraction,
            label: total !== null ? `Downloading ${formatBytes(done)} of ${formatBytes(total)}` : `Downloading ${formatBytes(done)}`,
        };
    }
    if (total === null) return { fraction: null, label: 'Reading the archive…' };
    return { fraction, label: `Unpacking ${formatBytes(done)} of ${formatBytes(total)}` };
}

export function describeSource(source: GameDataSource): string {
    switch (source.kind) {
        case 'server':
            return 'From the server';
        case 'upload':
            return `From ${source.name}`;
        case 'link':
            return `From ${new URL(source.url).host}`;
    }
}
