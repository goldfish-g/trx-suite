export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** How long ago an ISO date was, in words. */
export function formatWhen(iso: string | null): string {
    if (iso === null) return 'never';
    const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
    const steps: [number, string][] = [
        [60, 'second'],
        [60, 'minute'],
        [24, 'hour'],
        [7, 'day'],
        [4.35, 'week'],
        [12, 'month'],
        [Infinity, 'year'],
    ];
    let value = seconds;
    for (const [size, unit] of steps) {
        if (Math.abs(value) < size) {
            const rounded = Math.max(1, Math.round(value));
            return unit === 'second' ? 'just now' : `${rounded} ${unit}${rounded === 1 ? '' : 's'} ago`;
        }
        value /= size;
    }
    return 'long ago';
}
