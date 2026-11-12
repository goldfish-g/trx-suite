// The engine builds the server offers, listed in /engines/manifest.json. The
// list is remembered, so profiles can still be made offline from a build
// the browser already holds.

const MANIFEST_URL = '/engines/manifest.json';
const CACHE_KEY = 'trx-suite:engine-versions';

let versions: Promise<string[]> | null = null;

/**
 * Builds are named as TRX names its own version (tools/get_version): a
 * release, "1.12", or a development build after one, "1.12-17-g319a4c2",
 * 17 commits later. The numbers order them; the commit at the end does not.
 */
function compareDescending(a: string, b: string): number {
    const pa = a.split(/[.-]/).map((part) => parseInt(part, 10) || 0);
    const pb = b.split(/[.-]/).map((part) => parseInt(part, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const difference = (pb[i] ?? 0) - (pa[i] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

function remembered(): string[] | null {
    try {
        const list = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as unknown;
        return Array.isArray(list) && list.length > 0 ? list.filter((v): v is string => typeof v === 'string') : null;
    } catch {
        return null;
    }
}

async function fetchVersions(): Promise<string[]> {
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
            if (!response.ok) throw new Error(`the server answered ${response.status}`);
            const body = (await response.json()) as { versions?: unknown };
            const list = (Array.isArray(body.versions) ? body.versions : [])
                .filter((v): v is string => typeof v === 'string')
                .sort(compareDescending);
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(list));
            } catch {
                // Not remembered; fine while online.
            }
            return list;
        } catch (error) {
            const known = remembered();
            if (known !== null && (!navigator.onLine || attempt >= 2)) return known;
            if (attempt >= 4) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
    }
}

/** The engine versions the server offers, newest first. */
export function loadEngineVersions(): Promise<string[]> {
    versions ??= fetchVersions().catch((error: unknown) => {
        versions = null;
        throw error;
    });
    return versions;
}

/**
 * The build a profile made with `version` plays: its own while the server
 * offers it, else the newest the server offers, since a build it no longer
 * offers would not load. Offline it keeps its own, which the browser may
 * still hold.
 */
export async function offeredEngine(version: string): Promise<string> {
    if (!navigator.onLine) return version;
    const offered = await loadEngineVersions().catch((): string[] => []);
    return offered.length === 0 || offered.includes(version) ? version : offered[0]!;
}
