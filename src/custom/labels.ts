// How the custom levels screen words what TRCustoms says about a level.

import type { CustomLevelSummary } from '../../shared/api.ts';
import { findGame, type EngineNumber } from '../games/catalog';

/** "Long (3+ hours)" reads "3+ hours"; a length without hours keeps its name. */
export function lengthLabel(duration: string | null): string | null {
    if (duration === null) return null;
    const hours = /\(([^)]+)\)/.exec(duration)?.[1];
    return hours?.replace(/^</, 'Under ') ?? duration;
}

/** How a rating class is coloured: glowing for the best, red below the middle. */
export function ratingTone(position: number): 'best' | 'good' | 'mixed' | 'bad' {
    if (position >= 4) return 'best';
    if (position > 0) return 'good';
    if (position === 0) return 'mixed';
    return 'bad';
}

export function gameTitle(engine: EngineNumber): string {
    return findGame(`tr${engine}`)?.title ?? `TR${engine}`;
}

export function authorsLine(level: Pick<CustomLevelSummary, 'authors'>): string | null {
    const { authors } = level;
    if (authors.length === 0) return null;
    if (authors.length <= 2) return `by ${authors.join(' and ')}`;
    return `by ${authors[0]} and ${authors.length - 1} others`;
}


/**
 * For buttons only a mouse or a finger uses, such as tabs: pressing one
 * leaves the focus where it was, so a gamepad picks up from the levels.
 */
export function keepFocus(event: { preventDefault(): void }): void {
    event.preventDefault();
}

/**
 * A level's name from its archive's: TRCustoms names downloads
 * <id>-<Name>-[V<n>-]<authors>.zip, with the name in CamelCase, so
 * 4332-CrusadersDuty-V4-Shadoofus.zip is "Crusaders Duty". Other names
 * lose only their extension.
 */
export function levelNameFromArchive(fileName: string): string {
    const base = fileName.replace(/\.(zip|tar|tar\.gz|tgz)$/i, '');
    const name = /^\d+-(.+?)(?:-V\d+)?-[^-]+$/.exec(base)?.[1];
    if (name === undefined) return base;
    return name.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
}
