// Signing in with Steam, which only proves which games the player owns, so
// the server may send them.

import { useEffect, useRef, useState } from 'react';
import type { LinkedAccount } from '../../../shared/api.ts';
import { OFFICIAL_GAMES, STEAM } from '../../../shared/games.ts';
import { mockSignIn, startSteamSignIn, unlinkAccount, useAccount, type SignInHandle } from '../../account/store';
import { formatWhen } from '../../ui/format';
import { ExternalIcon, StoreMark } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { describeError } from '../actions';

/** Names for the Steam apps the server reports, for "Owns …" lines. */
const PRODUCT_NAMES: Record<number, string> = {
    [STEAM.tr1]: 'Tomb Raider I',
    [STEAM.tr2]: 'Tomb Raider II',
    [STEAM.tr3]: 'Tomb Raider III',
    [STEAM.tr4]: 'Tomb Raider IV',
    [STEAM.remasteredI_III]: 'Tomb Raider I–III Remastered',
    [STEAM.remasteredIV_VI]: 'Tomb Raider IV–VI Remastered',
};

export function AccountSheet({ onClose }: { onClose(): void }) {
    const { me, online } = useAccount();
    const account = me?.accounts.find((linked) => linked.provider === 'steam');
    const providers = me?.providers ?? { steam: false, mock: false };
    const unlocked = new Set(me?.unlocked ?? []);
    const [error, setError] = useState<string | null>(null);
    const [steam, setSteam] = useState<SignInHandle | null>(null);
    const steamRef = useRef(steam);
    steamRef.current = steam;

    useEffect(() => () => steamRef.current?.cancel(), []);

    const signInSteam = async () => {
        setError(null);
        try {
            const handle = await startSteamSignIn();
            setSteam(handle);
            await handle.done;
        } catch (problem) {
            setError(describeError(problem));
        } finally {
            setSteam(null);
        }
    };

    const freeGames = OFFICIAL_GAMES.filter((game) => game.access.kind === 'free');
    const ownedGames = OFFICIAL_GAMES.filter((game) => game.access.kind === 'owned' && unlocked.has(game.mod));

    return (
        <Sheet title="Your games" eyebrow="Account" onClose={onClose}>
            <section className="sheet__section">
                <p className="sheet__text">
                    {freeGames.map((game) => game.title).join(' and ')} are free for everyone. Sign in with Steam, and the
                    games your account owns unlock for download. Signing in only reads which games you own.
                </p>
                <p className="sheet__text sheet__text--quiet">
                    Bought the games elsewhere? Open a game and choose “Use your own copy” to bring its files from an
                    installed copy.
                </p>
                {!online ? (
                    <p className="notice">You’re offline. Signing in needs the connection; downloaded games still play.</p>
                ) : null}
                {ownedGames.length > 0 ? (
                    <p className="notice notice--ok">Unlocked: {ownedGames.map((game) => game.title).join(', ')}.</p>
                ) : null}
            </section>

            <section className="sheet__section">
                <h3 className="sheet__heading">
                    <StoreMark provider="steam" /> Steam
                </h3>
                {account !== undefined ? (
                    <AccountCard account={account} />
                ) : !providers.steam && online ? (
                    <p className="sheet__text sheet__text--quiet">This server doesn’t offer Steam sign-in.</p>
                ) : null}
                {providers.steam ? (
                    steam !== null ? (
                        <div className="card">
                            <p className="sheet__text">Waiting for Steam… Finish signing in in the window that opened.</p>
                            <div className="sheet__actions">
                                <a className="button" href={steam.url} target="_blank" rel="noreferrer">
                                    <ExternalIcon />
                                    No window? Open Steam
                                </a>
                                <button className="button button--quiet" onClick={() => steam.cancel()}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="sheet__actions">
                            <button className="button button--primary" disabled={!online} data-autofocus onClick={() => void signInSteam()}>
                                {account === undefined ? 'Sign in with Steam' : 'Check again'}
                            </button>
                            {account !== undefined ? (
                                <button className="button button--quiet" onClick={() => void unlinkAccount('steam').catch((e) => setError(describeError(e)))}>
                                    Sign out
                                </button>
                            ) : null}
                        </div>
                    )
                ) : null}
            </section>
            {providers.mock ? (
                <section className="sheet__section">
                    <h3 className="sheet__heading">Test sign-in</h3>
                    <p className="sheet__text sheet__text--quiet">
                        This server runs with AUTH_MOCK=1, for development: a made-up Steam account that owns the remasters
                        unlocks every game.
                    </p>
                    <div className="sheet__actions">
                        <button
                            className="button"
                            onClick={() =>
                                void mockSignIn('steam', [STEAM.remasteredI_III, STEAM.remasteredIV_VI]).catch((e) => setError(describeError(e)))
                            }
                        >
                            Sign in as a test player
                        </button>
                    </div>
                </section>
            ) : null}
            {error !== null ? <p className="notice notice--error">{error}</p> : null}
        </Sheet>
    );
}

function AccountCard({ account }: { account: LinkedAccount }) {
    const owned = account.owned.map((id) => PRODUCT_NAMES[id]).filter((name): name is string => name !== undefined);
    return (
        <div className="account">
            {account.avatarUrl !== undefined ? (
                <img
                    className="account__avatar"
                    src={account.avatarUrl}
                    alt=""
                    crossOrigin="anonymous"
                    onError={(event) => (event.currentTarget.style.display = 'none')}
                />
            ) : null}
            <div>
                <p className="account__name">{account.name}</p>
                <p className="list__meta">
                    {account.privateProfile
                        ? 'Steam keeps this profile’s game details private. Set “Game details” to Public in your Steam privacy settings, then check again.'
                        : owned.length > 0
                          ? `Owns ${owned.join(', ')}`
                          : 'Owns none of the games this app plays.'}
                </p>
                <p className="list__meta">Checked {formatWhen(account.checkedAt)}</p>
            </div>
        </div>
    );
}
