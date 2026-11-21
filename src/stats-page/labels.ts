// How the stats page names things, and writes numbers.

import { OFFICIAL_GAMES } from '../../shared/games.ts';
import { STEAM_PRODUCTS } from '../../shared/stats.ts';

const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const languages = new Intl.DisplayNames(['en'], { type: 'language' });

export function countryName(code: string): string {
    if (code === 'unknown') return 'Unknown';
    try {
        return regions.of(code) ?? code;
    } catch {
        return code;
    }
}

export function languageName(code: string): string {
    try {
        return languages.of(code) ?? code;
    } catch {
        return code;
    }
}

export function gameName(game: string): string {
    if (game === 'custom') return 'Custom levels';
    return OFFICIAL_GAMES.find((entry) => entry.mod === game)?.title ?? game;
}

export function steamProductName(key: string): string {
    return STEAM_PRODUCTS.find((product) => product.key === key)?.name ?? key;
}

const NAMES: Record<string, Record<string, string>> = {
    screen: { phone: 'Phone', tablet: 'Tablet', desktop: 'Computer' },
    display: { app: 'Installed app', tab: 'Browser tab' },
    input: { touch: 'Touch', mouse: 'Mouse', keyboard: 'Keyboard', gamepad: 'Controller' },
    pad: { xbox: 'Xbox style', playstation: 'PlayStation', nintendo: 'Nintendo' },
    look: { tr1: 'Tomb Raider', tr2: 'Tomb Raider II', tr3: 'Tomb Raider III' },
    bytes: { games: 'Games', engine: 'The engine', levels: 'Custom levels', saves: 'Cloud saves', app: 'The app itself' },
};

export function nameOf(group: string, key: string): string {
    return NAMES[group]?.[key] ?? key;
}

const whole = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** 1,284 below ten thousand, 12.9K above. */
export function formatCount(n: number): string {
    return Math.abs(n) < 10_000 ? whole.format(Math.round(n)) : compact.format(n);
}

/** Minutes as hours, or minutes while under an hour. */
export function formatMinutes(minutes: number): string {
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = minutes / 60;
    return `${hours < 10 ? hours.toFixed(1) : formatCount(Math.round(hours))} h`;
}

export function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1000;
        unit++;
    }
    return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatMetres(metres: number): string {
    return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(metres < 100_000 ? 1 : 0)} km`;
}

export function formatPercent(part: number, whole: number): string {
    if (whole <= 0) return '–';
    const share = (part / whole) * 100;
    return `${share < 10 && share > 0 ? share.toFixed(1) : Math.round(share)}%`;
}

const dayFormat = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDayFormat = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatDay(day: string, long = false): string {
    const date = new Date(`${day}T00:00:00Z`);
    return (long ? longDayFormat : dayFormat).format(date);
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
