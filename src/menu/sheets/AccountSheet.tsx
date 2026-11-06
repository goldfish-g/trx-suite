// Signing in with Steam or GOG, which only proves which games the player
// owns, so the server may send them.

import { useEffect, useRef, useState } from 'react';
import type { LinkedAccount, Provider } from '../../../shared/api.ts';
import { GOG, OFFICIAL_GAMES, STEAM } from '../../../shared/games.ts';
import {
    completeGogSignIn,
    gogSignInUrl,
    mockSignIn,
    startSteamSignIn,
    unlinkAccount,
    useAccount,
    type SignInHandle,
} from '../../account/store';
import { formatWhen } from '../../ui/format';
import { ExternalIcon, StoreMark } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { describeError } from '../actions';

const STORE_NAMES: Record<Provider, string> = { steam: 'Steam', gog: 'GOG' };

/** Names for the store ids the server reports, for "Owns …" lines. */
const PRODUCT_NAMES: Record<string, string> = {
    [`steam:${STEAM.tr1}`]: 'Tomb Raider I',
    [`steam:${STEAM.tr2}`]: 'Tomb Raider II',
    [`steam:${STEAM.tr3}`]: 'Tomb Raider III',
    [`steam:${STEAM.tr4}`]: 'Tomb Raider IV',
    [`steam:${STEAM.remasteredI_III}`]: 'Tomb Raider I–III Remastered',
    [`steam:${STEAM.remasteredIV_VI}`]: 'Tomb Raider IV–VI Remastered',
    [`gog:${GOG.tr1}`]: 'Tomb Raider 1',
    [`gog:${GOG.tr2}`]: 'Tomb Raider 2',
    [`gog:${GOG.tr3}`]: 'Tomb Raider 3',
    [`gog:${GOG.tr4}`]: 'The Last Revelation',
    [`gog:${GOG.remasteredI_III}`]: 'Tomb Raider I–III Remastered',
    [`gog:${GOG.remasteredIV_VI}`]: 'Tomb Raider IV–VI Remastered',
    [`gog:${GOG.remasteredI_VI}`]: 'Tomb Raider I–VI Remastered',
};

export function AccountSheet({ onClose }: { onClose(): void }) {
    const { me, online } = useAccount();
    const accounts = me?.accounts ?? [];
    const providers = me?.providers ?? { steam: false, gog: false, mock: false };
    const unlocked = new Set(me?.unlocked ?? []);
    const [error, setError] = useState<string | null>(null);
    const [steam, setSteam] = useState<SignInHandle | null>(null);
    const [gogStep, setGogStep] = useState<'idle' | 'paste'>('idle');
    const [gogUrl, setGogUrl] = useState<string | null>(null);
    const [pasted, setPasted] = useState('');
    const [busy, setBusy] = useState(false);
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

    const openGog = async () => {
        setError(null);
        // Open the window within the click, before awaiting the address.
        const popup = window.open('about:blank', 'trx-suite-gog', 'popup,width=820,height=760');
        try {
            const url = await gogSignInUrl();
            setGogUrl(url);
            if (popup !== null && !popup.closed) popup.location.href = url;
            setGogStep('paste');
        } catch (problem) {
            popup?.close();
            setError(describeError(problem));
        }
    };

    const finishGog = async () => {
        setBusy(true);
        setError(null);
        try {
            await completeGogSignIn(pasted.trim());
            setGogStep('idle');
            setPasted('');
        } catch (problem) {
            setError(describeError(problem));
        } finally {
            setBusy(false);
        }
    };

    const linked = (provider: Provider) => accounts.find((account) => account.provider === provider);
    const freeGames = OFFICIAL_GAMES.filter((game) => game.access.kind === 'free');
    const ownedGames = OFFICIAL_GAMES.filter((game) => game.access.kind === 'owned' && unlocked.has(game.mod));

    return (
        <Sheet title="Your games" eyebrow="Account" onClose={onClose}>
            <section className="sheet__section">
                <p className="sheet__text">
                    {freeGames.map((game) => game.title).join(' and ')} are free for everyone. Sign in with the store you bought
                    Tomb Raider from, and the games your account owns unlock for download. Signing in only reads which games
                    you own.
                </p>
                {!online ? (
                    <p className="notice">You’re offline. Signing in needs the connection; downloaded games still play.</p>
                ) : null}
                {ownedGames.length > 0 ? (
                    <p className="notice notice--ok">Unlocked: {ownedGames.map((game) => game.title).join(', ')}.</p>
                ) : null}
            </section>

            {(['steam', 'gog'] as const).map((provider) => {
                const account = linked(provider);
                return (
                    <section key={provider} className="sheet__section">
                        <h3 className="sheet__heading">
                            <StoreMark provider={provider} /> {STORE_NAMES[provider]}
                        </h3>
                        {account !== undefined ? (
                            <AccountCard account={account} />
                        ) : !providers[provider] && online ? (
                            <p className="sheet__text sheet__text--quiet">This server doesn’t offer {STORE_NAMES[provider]} sign-in.</p>
                        ) : null}
                        {provider === 'steam' && providers.steam ? (
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
                        {provider === 'gog' && providers.gog ? (
                            gogStep === 'paste' ? (
                                <div className="card">
                                    <ol className="steps">
                                        <li>Sign in on GOG in the window that opened.</li>
                                        <li>GOG then shows an empty page. Copy that page’s address from the address bar.</li>
                                        <li>Paste it here.</li>
                                    </ol>
                                    <label className="field">
                                        <span className="field__label">Address of GOG’s page</span>
                                        <input
                                            className="field__input"
                                            value={pasted}
                                            autoFocus
                                            placeholder="https://embed.gog.com/on_login_success?…"
                                            onChange={(event) => setPasted(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' && pasted.trim() !== '') void finishGog();
                                            }}
                                        />
                                    </label>
                                    <div className="sheet__actions">
                                        <button className="button button--primary" disabled={busy || pasted.trim() === ''} onClick={() => void finishGog()}>
                                            Finish signing in
                                        </button>
                                        {gogUrl !== null ? (
                                            <a className="button" href={gogUrl} target="_blank" rel="noreferrer">
                                                <ExternalIcon />
                                                No window? Open GOG
                                            </a>
                                        ) : null}
                                        <button className="button button--quiet" onClick={() => setGogStep('idle')}>
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="sheet__actions">
                                    <button className="button button--primary" disabled={!online} onClick={() => void openGog()}>
                                        {account === undefined ? 'Sign in with GOG' : 'Check again'}
                                    </button>
                                    {account !== undefined ? (
                                        <button className="button button--quiet" onClick={() => void unlinkAccount('gog').catch((e) => setError(describeError(e)))}>
                                            Sign out
                                        </button>
                                    ) : null}
                                </div>
                            )
                        ) : null}
                    </section>
                );
            })}
            {providers.mock ? (
                <section className="sheet__section">
                    <h3 className="sheet__heading">Test sign-in</h3>
                    <p className="sheet__text sheet__text--quiet">
                        This server runs with AUTH_MOCK=1: a made-up Steam account that owns the remasters unlocks every game.
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
    const owned = account.owned.map((id) => PRODUCT_NAMES[`${account.provider}:${id}`]).filter((name): name is string => name !== undefined);
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
