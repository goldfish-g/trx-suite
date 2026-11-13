// Moving between the menu and a game.
//
// A game plays in a frame over the menu's page (GameHost.tsx), not on a page
// of its own, so the page and what it runs carry on while the game plays:
// downloads above all. Leaving the game removes the frame, and with it the
// engine; the menu shows again, without a page load. The game's frame is a
// page of the app too (/play/<profile> inside the frame), which finds the
// page above it through GAME_HOST and asks it to close the frame, to switch
// games, or to fill the screen.

import type { NavigateFunction } from 'react-router-dom';

/** What the page holding a game's frame offers the game inside it. */
export interface GameHostApi {
    /** Back to the menu: the frame goes. */
    close(): void;
    /** Plays url (/play/<profile>?mod=…) in a fresh frame instead, for another game picked in the engine. */
    switchTo(url: string): void;
    /** Fills the screen, sideways where the device allows; inside the player's tap. */
    enterFullscreen(): Promise<void>;
    setTitle(title: string): void;
}

const GAME_HOST = '__tombsNexusGameHost';

type HostWindow = Window & { [GAME_HOST]?: GameHostApi };

/** Offers api to a game's frame, until the returned function is called. */
export function offerGameHost(api: GameHostApi): () => void {
    (window as HostWindow)[GAME_HOST] = api;
    return () => {
        if ((window as HostWindow)[GAME_HOST] === api) delete (window as HostWindow)[GAME_HOST];
    };
}

/** The page this game's frame plays in, when this page is one. */
export function gameHost(): GameHostApi | null {
    if (window.parent === window) return null;
    try {
        return (window.parent as HostWindow)[GAME_HOST] ?? null;
    } catch {
        // A page of another site, which this page has no business in.
        return null;
    }
}

let navigateTo: NavigateFunction | null = null;

/** Lets pages.ts move between the app's screens, from inside the router. */
export function setNavigator(navigate: NavigateFunction): void {
    navigateTo = navigate;
}

interface PageState {
    /** Set on a game opened from the menu, which Back returns to. */
    fromMenu?: boolean;
}

function pageState(): PageState | undefined {
    return (history.state as { usr?: PageState } | null)?.usr;
}

/** Whether a game has shown in this page: any menu after it is the way back from a game. */
let gameShown = false;

/** As a game's frame shows. */
export function noteGameShown(): void {
    gameShown = true;
}

/**
 * Whether the menu shows because the player left a game, however they left
 * it, rather than as the app starts or on a reload.
 */
export function cameFromGame(): boolean {
    return gameShown;
}

/** Opens a game over the menu (url: /play/<profile>). */
export function openGame(url: string): void {
    if (navigateTo === null) location.assign(url);
    else navigateTo(url, { state: { fromMenu: true } satisfies PageState });
}

/** In the page holding a game: back to the menu, where Back would lead. */
export function closeGame(): void {
    if (navigateTo === null) location.replace('/');
    else if (pageState()?.fromMenu === true) navigateTo(-1);
    else navigateTo('/', { replace: true });
}

/** In the page holding a game: url instead, in its place. */
export function switchGame(url: string): void {
    if (navigateTo === null) location.replace(url);
    else navigateTo(url, { replace: true, state: pageState() });
}

/** In a game's own page: back to the menu. */
export function leaveGame(): void {
    const host = gameHost();
    if (host !== null) host.close();
    else location.replace('/');
}
