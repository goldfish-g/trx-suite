// The eight menu artifacts, one per game, built procedurally with three.js.
// See each artifact's file for its design; materials.ts holds the shared
// material language and the locked ("petrified") look, rig.ts the plumbing,
// and stage.ts the lighting they are designed under.

import { createCat } from './cat';
import { createCompass } from './compass';
import { createDagger } from './dagger';
import { createEye } from './eye';
import { createHand } from './hand';
import { createMask } from './mask';
import { createMeteorite } from './meteorite';
import { createScion } from './scion';
import type { Artifact, ArtifactKind } from './types';

export type { Artifact, ArtifactKind, ArtifactState } from './types';
export { setupArtifactLighting, LIGHTING, type ArtifactLighting } from './stage';

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['scion', 'dagger', 'meteorite', 'eye', 'cat', 'mask', 'hand', 'compass'];

const BUILDERS: Record<ArtifactKind, () => Artifact> = {
    scion: createScion,
    dagger: createDagger,
    meteorite: createMeteorite,
    eye: createEye,
    cat: createCat,
    mask: createMask,
    hand: createHand,
    compass: createCompass,
};

export function createArtifact(kind: ArtifactKind): Artifact {
    return BUILDERS[kind]();
}
