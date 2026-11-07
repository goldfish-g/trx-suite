// Which object of which level stands for each entry of the ring. Each entry
// lists places to look, in order; the server shows the first it can find in
// the games it holds. Ids are the levels' own object numbers (m = moveable,
// s = static mesh); dev/objects.html shows them on a contact sheet.

import type { ObjectRef } from './extract.ts';

export interface RingSource {
    /** The official game whose package holds the level. */
    mod: string;
    /** The level's file name, matched case-insensitively. */
    level: string;
    object: ObjectRef;
    name: string;
}

const m = (id: number): ObjectRef => ({ kind: 'moveable', id });
const s = (id: number): ObjectRef => ({ kind: 'static', id });

export const RING_SOURCES: Record<string, RingSource[]> = {
    tr1: [{ mod: 'tr1', level: 'level10b.phd', object: m(146), name: 'The Scion' }],
    tr2: [{ mod: 'tr2', level: 'xian.tr2', object: m(179), name: 'The Dagger of Xian' }],
    tr3: [
        { mod: 'tr3', level: 'tonyboss.tr2', object: m(240), name: 'The Infada Stone' },
        { mod: 'tr3', level: 'chamber.tr2', object: m(240), name: 'The Infada Stone' },
    ],
    tr4: [
        { mod: 'tr4', level: 'karnak1.tr4', object: m(252), name: 'A golden ankh' },
        { mod: 'tr4', level: 'joby5a.tr4', object: m(252), name: 'A golden ankh' },
    ],
    'tr1-ub': [{ mod: 'tr1-ub', level: 'cat.phd', object: s(31), name: 'A statue of Bastet' }],
    'tr2-gm': [{ mod: 'tr2-gm', level: 'level4.tr2', object: m(178), name: 'The Golden Mask' }],
    // The Hand of Rathmore takes the Infada Stone's place in Reunion, the
    // only level that holds it.
    'tr3-la': [{ mod: 'tr3-la', level: 'slinc.tr2', object: m(240), name: 'The Hand of Rathmore' }],
    custom: [
        { mod: 'tr4', level: 'angkor1.tr4', object: m(375), name: 'A compass' },
        { mod: 'tr4', level: 'ang_race.tr4', object: m(375), name: 'A compass' },
    ],
};
