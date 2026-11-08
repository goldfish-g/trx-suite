// Moving between the menu and a game without leaving pages behind.
//
// Browsers keep a page the player navigated away from alive for a while, in
// case they go Back to it (Chrome's back/forward cache). A game page holds
// the engine, a gigabyte or more, so every game played from the menu stayed
// in memory, until after three or four the next one could not start
// ("WebAssembly.Memory(): could not allocate memory"). A page that is
// replaced in the history is not kept. So the menu always takes a game
// page's place, and a menu that took a game's place gives its own place to
// the next game, so menus do not pile up behind the game either. Back from
// a game still leads to a menu.

const FROM_GAME_KEY = 'trx-suite:from-game';

interface PageState {
    fromGame?: boolean;
}

/** Back to the menu, in the game page's place. */
export function leaveGame(): void {
    sessionStorage.setItem(FROM_GAME_KEY, '1');
    location.replace('/');
}

/** As the app starts: marks a menu that took a game's place, in its history entry. */
export function noteArrival(): void {
    if (sessionStorage.getItem(FROM_GAME_KEY) === null) return;
    sessionStorage.removeItem(FROM_GAME_KEY);
    // The router keeps its own fields in the state; they stay.
    history.replaceState({ ...(history.state as object | null), fromGame: true }, '');
}

/** Opens a game page: in the menu's place when that menu took a game's, else after it. */
export function openGame(url: string): void {
    if ((history.state as PageState | null)?.fromGame === true) location.replace(url);
    else location.assign(url);
}
