// Routes planned ahead of time for the official games' levels, by
// scripts/plan-flybys.mjs: a thorough search, every view of every route
// checked, so the menu shows each level at its best without planning on a
// phone. A level whose file differs from the one planned for (another
// release, a patched file) is planned on the spot instead.
//
// Each game's routes are a separate file, loaded only when one of its
// levels flies by; the service worker keeps them like the rest of the app.

import type { RouteData } from './prepare';
import { loadRoute, type StoredGame } from './stored';

const files = import.meta.glob<StoredGame>('./planned/*.json', { import: 'default' });

/**
 * The routes planned for a level of an official game: none when nothing in
 * it is worth showing, null when this very file was never planned for.
 */
export async function plannedRoutes(mod: string, fileName: string, size: number): Promise<RouteData[] | null> {
    const load = files[`./planned/${mod}.json`];
    if (load === undefined) return null;
    const level = (await load()).levels[fileName.toLowerCase()];
    if (level === undefined || level.size !== size) return null;
    return level.routes.map(loadRoute);
}
