// A custom level's files through the TRX Level Converter (the converter
// submodule, trx-update-tool): the files are mapped into a TRX package, the
// game flow is written from the level's script, and whatever was made for an
// older TRX is brought up to date. The page runs this in its converter
// worker (worker.ts); the server runs the same to check a level a player's
// conversion said TRX cannot play (check.ts), so both reach one verdict.
//
// Type-checked by tsconfig.converter.json, with the converter's own settings.

import { detectGameVersion, filterByLanguage, processFiles } from '../../../converter/client/src/converter/gamedata.ts';
import { setupCustomGameflow } from '../../../converter/client/src/converter/gameflow.ts';
import { migrateToCurrentTRX } from '../../../converter/client/src/converter/migrate.ts';
import { checkHasLevels } from '../../../converter/client/src/converter/references.ts';
import type { BaseNeed, ConvertFile, ConvertRequest } from './protocol.ts';

export { UnplayableLevelError } from '../../../converter/client/src/converter/references.ts';

export interface ConvertedFiles {
    gameVersion: 1 | 2 | 3;
    files: ConvertFile[];
    notes: string[];
    /** Files of the original game the package uses and lacks, for the page to fetch. */
    needs: BaseNeed[];
}

/** Converts a level's files; throws UnplayableLevelError for a level TRX cannot play. */
export async function convertFiles({ title, modId, files }: ConvertRequest, onStep: (label: string) => void = () => {}): Promise<ConvertedFiles> {
    onStep('Reading the level');
    const version = detectGameVersion(files);
    let { mapped, languages } = processFiles(files, modId);
    // Remastered releases bring their speech in several languages; the
    // package keeps one, English where it is offered.
    if (languages.length > 1) {
        const language = languages.find((candidate) => candidate.code === 'en') ?? languages[0];
        mapped = processFiles(filterByLanguage(files, language.code), modId).mapped;
    }
    // A game with no level would only fail when it starts, so it stops here,
    // saying why.
    checkHasLevels(files, mapped);

    onStep('Writing its game flow');
    const withGameflow = await setupCustomGameflow(mapped, modId, Number(version), false, title);

    onStep('Bringing it up to date');
    // What it needs of the original game comes from the server (imports.ts),
    // so it plays without the player owning the game.
    const { files: out, notes, needs } = await migrateToCurrentTRX(withGameflow, {
        modDir: modId,
        gameVersion: Number(version),
        upload: files,
        fetchBase: true,
    });
    return {
        gameVersion: Number(version) as 1 | 2 | 3,
        files: out.map((file) => ({ path: file.path, data: file.data })),
        notes,
        needs,
    };
}
