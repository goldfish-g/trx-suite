import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Which converter a build runs, as a hash of its source: a level converted
 * by another may lack fixes made since, and the custom levels screen offers
 * to convert it again; the server checks levels found unplayable again when
 * its checker runs another.
 */
export function converterVersion(root: string): string {
    const hash = createHash('sha256');
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) walk(path);
            else hash.update(relative(root, path)).update(readFileSync(path));
        }
    };
    try {
        walk(join(root, 'converter/client/src/converter'));
        walk(join(root, 'converter/client/src/templates'));
    } catch {
        return 'unknown';
    }
    return hash.digest('hex').slice(0, 12);
}
