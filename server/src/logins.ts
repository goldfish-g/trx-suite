// Steam sign-ins in flight. Steam returns the player to a callback page that
// may open in another browser than the app (an installed PWA on iOS hands
// links to Safari), so the callback cannot set the app's cookie. It leaves
// the result here under the sign-in's random state, and the app collects it
// by polling, which sets the cookie in the app's own cookie jar.

import { randomBytes } from 'node:crypto';
import type { LinkedAccount } from '../../shared/api.ts';

export const LOGIN_TTL_MS = 10 * 60 * 1000;
/** Starting a sign-in needs no account, so cap what strangers can make us hold. */
const MAX_PENDING = 10_000;

export type LoginResult = { account: LinkedAccount } | { error: string };

export interface PendingLogin {
    /** The exact openid.return_to we sent; Steam's answer must repeat it. */
    returnTo: string;
    createdAt: number;
    /** Set when the callback ran, so one assertion cannot be replayed. */
    callbackSeen: boolean;
    result?: LoginResult;
}

export function createLoginStore(now: () => number = Date.now) {
    const pending = new Map<string, PendingLogin>();

    function sweep(): void {
        const cutoff = now() - LOGIN_TTL_MS;
        // Insertion order is creation order, so the expired ones come first.
        for (const [state, login] of pending) {
            if (login.createdAt > cutoff && pending.size <= MAX_PENDING) break;
            pending.delete(state);
        }
    }

    return {
        /** Starts a sign-in; returnTo receives the new state to build the address with. */
        create(returnTo: (state: string) => string): { state: string; login: PendingLogin } {
            sweep();
            const state = randomBytes(24).toString('base64url');
            const login: PendingLogin = { returnTo: returnTo(state), createdAt: now(), callbackSeen: false };
            pending.set(state, login);
            return { state, login };
        },
        get(state: string): PendingLogin | undefined {
            sweep();
            return pending.get(state);
        },
        delete(state: string): void {
            pending.delete(state);
        },
    };
}

export type LoginStore = ReturnType<typeof createLoginStore>;
