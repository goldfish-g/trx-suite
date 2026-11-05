// The entries of the ring, and what each one can do right now.

import { findOfficialGame, type OfficialGame } from '../../shared/games.ts';
import type { CatalogEntry } from '../../shared/api.ts';
import type { ImportProgress } from '../gamedata/imports';
import type { GameDataRecord } from '../gamedata/types';
import type { ArtifactKind } from './models';

export interface RingItem {
    key: string;
    /** The official game, or null for the custom levels entry. */
    game: OfficialGame | null;
    title: string;
    /** A line under the title. */
    tagline: string;
    artifact: ArtifactKind;
}

function official(mod: string, artifact: ArtifactKind, tagline: string): RingItem {
    const game = findOfficialGame(mod);
    if (game === undefined) throw new Error(`Unknown game ${mod}`);
    return { key: mod, game, title: game.title, tagline, artifact };
}

/** In the order the owner asked for: the four games, their expansions, then custom levels. */
export const RING_ITEMS: readonly RingItem[] = [
    official('tr1', 'scion', '1996'),
    official('tr2', 'dagger', '1997'),
    official('tr3', 'meteorite', '1998'),
    official('tr4', 'eye', 'Tomb Raider IV · 1999'),
    official('tr1-ub', 'cat', 'Tomb Raider Gold · 1998'),
    official('tr2-gm', 'mask', 'Tomb Raider II Gold · 1999'),
    official('tr3-la', 'hand', 'Tomb Raider III Gold · 2000'),
    { key: 'custom', game: null, title: 'Custom Levels', tagline: 'Levels made by the community', artifact: 'compass' },
];

export type ItemStatus =
    /** The game's files are in the library. */
    | { kind: 'installed'; record: GameDataRecord }
    | { kind: 'importing'; record: GameDataRecord; progress: ImportProgress | undefined }
    | { kind: 'failed'; record: GameDataRecord }
    /** The server offers it to this player. */
    | { kind: 'available'; entry: CatalogEntry }
    /** The server has it, but the player has not shown they own it. */
    | { kind: 'locked'; entry: CatalogEntry }
    /** The server does not offer it; the player can still bring their own copy. */
    | { kind: 'own-copy' }
    | { kind: 'custom'; count: number };

export function itemStatus(
    item: RingItem,
    library: readonly GameDataRecord[],
    catalog: readonly CatalogEntry[],
    progress: Record<string, ImportProgress>,
): ItemStatus {
    if (item.game === null) {
        const count = library.filter((record) => record.layout !== 'game' && record.status !== 'failed').length;
        return { kind: 'custom', count };
    }
    const mod = item.game.mod;
    const records = library.filter((record) => record.layout === 'game' && record.mod === mod);
    const ready = records.find((record) => record.status === 'ready');
    if (ready !== undefined) return { kind: 'installed', record: ready };
    const importing = records.find((record) => record.status === 'importing');
    if (importing !== undefined) return { kind: 'importing', record: importing, progress: progress[importing.id] };
    const failed = records.find((record) => record.status === 'failed');
    if (failed !== undefined) return { kind: 'failed', record: failed };
    const entry = catalog.find((candidate) => candidate.mod === mod);
    if (entry === undefined) return { kind: 'own-copy' };
    return entry.unlocked ? { kind: 'available', entry } : { kind: 'locked', entry };
}

export function isLockedLook(status: ItemStatus): boolean {
    return status.kind === 'locked' || status.kind === 'own-copy';
}
