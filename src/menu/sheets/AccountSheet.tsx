// Signing in with Steam, which proves which games the player owns, so the
// server may send them, and keeps their saves and custom levels in the cloud.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LinkedAccount } from '../../../shared/api.ts';
import { OFFICIAL_GAMES, STEAM } from '../../../shared/games.ts';
import { mockSignIn, startSteamSignIn, unlinkAccount, useAccount, type SignInHandle } from '../../account/store';
import { formatBytes, formatWhen } from '../../ui/format';
import { CloudIcon, ExternalIcon, StoreMark, TrashIcon } from '../../ui/icons';
import { GameText } from '../../ui/GameText';
import { Prompt } from '../../ui/Prompt';
import { Row } from '../../ui/Row';
import { Sheet } from '../../ui/Sheet';
import { deleteFromCloud, describeCloudError, syncCloudNow, useCloud } from '../../cloud/sync';
import { cloudTitles, type CloudTitle } from '../../cloud/view';
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
                    games your account owns unlock for download, and your saves and custom levels are kept in the cloud for your
                    other devices. Steam only tells the app which games you own.
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
                    <StoreMark provider="steam" />
                    <GameText text="Steam" />
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
                                    <GameText text="No window? Open Steam" />
                                </a>
                                <button className="button button--quiet" onClick={() => steam.cancel()}>
                                    <GameText text="Cancel" />
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="sheet__actions">
                            <button className="button button--primary" disabled={!online} data-autofocus onClick={() => void signInSteam()}>
                                <GameText text={account === undefined ? 'Sign in with Steam' : 'Check again'} />
                            </button>
                            {account !== undefined ? (
                                <button className="button button--quiet" onClick={() => void unlinkAccount('steam').catch((e) => setError(describeError(e)))}>
                                    <GameText text="Sign out" />
                                </button>
                            ) : null}
                        </div>
                    )
                ) : null}
            </section>
            {account !== undefined ? <CloudSection /> : null}
            {providers.mock ? (
                <section className="sheet__section">
                    <h3 className="sheet__heading">
                        <GameText text="Test sign-in" />
                    </h3>
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
                            <GameText text="Sign in as a test player" />
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

function cloudStatusLine(status: ReturnType<typeof useCloud.getState>['status'], lastSyncAt: string | null, error: string | null): string {
    switch (status) {
        case 'syncing':
            return 'Syncing…';
        case 'offline':
            return 'Offline. Your saves sync once the connection is back.';
        case 'error':
            return `The last sync failed: ${error ?? 'something went wrong'}`;
        default:
            return lastSyncAt === null ? 'Not synced yet' : `Synced ${formatWhen(lastSyncAt)}`;
    }
}

/**
 * The cloud: what it keeps of each game and custom level, and the way to
 * take one out, its saves on every device going with it.
 */
function CloudSection() {
    const { status, index, lastSyncAt, error } = useCloud();
    const online = useAccount((state) => state.online);
    const titles = useMemo(() => (index === null ? [] : cloudTitles(index)), [index]);

    return (
        <section className="sheet__section">
            <h3 className="sheet__heading">
                <CloudIcon />
                <GameText text="Cloud saves" />
            </h3>
            <p className="sheet__text">
                Your profiles and their saves, and the custom levels you add, are kept with this Steam account. Sign in on another device and
                your profiles come back once their game is there; your custom levels wait under Custom levels → Library to download again.
            </p>
            <p className={`list__meta ${status === 'error' ? 'notice--error' : ''}`}>
                {cloudStatusLine(status, lastSyncAt, error)}
                {index !== null ? ` · ${formatBytes(index.usage.bytes)} of ${formatBytes(index.usage.limitBytes)} used` : ''}
            </p>
            <div className="sheet__actions">
                <button className="button" disabled={!online || status === 'syncing'} onClick={() => void syncCloudNow()}>
                    <GameText text="Sync now" />
                </button>
            </div>
            {titles.length > 0 ? (
                <ul className="list">
                    {titles.map((title) => (
                        <CloudTitleRow key={title.title} title={title} online={online} />
                    ))}
                </ul>
            ) : index !== null ? (
                <p className="sheet__text sheet__text--quiet">Nothing in your cloud yet. Play a game and its saves go there.</p>
            ) : null}
        </section>
    );
}

function CloudTitleRow({ title, online }: { title: CloudTitle; online: boolean }) {
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const profiles = title.profiles.length;
    const meta = [
        title.kind === 'level' ? 'Custom level' : null,
        profiles === 0 ? 'no saves' : profiles === 1 ? '1 profile' : `${profiles} profiles`,
        profiles > 0 ? formatBytes(title.bytes) : null,
        title.lastPlayedAt !== null ? `played ${formatWhen(title.lastPlayedAt)}` : null,
    ]
        .filter((part): part is string => part !== null)
        .join(' · ');

    const remove = async () => {
        setBusy(true);
        setProblem(null);
        try {
            await deleteFromCloud(title.title);
        } catch (failure) {
            setProblem(describeCloudError(failure));
            setBusy(false);
            setConfirm(false);
        }
    };

    if (confirm) {
        return (
            <Row
                className="row--confirm"
                prompts={
                    <>
                        <Prompt variant="row" action="confirm" label="Delete" className="prompt--danger" disabled={busy || !online} onPress={() => void remove()} />
                        <Prompt variant="row" action="back" label="Keep" onPress={() => setConfirm(false)} />
                    </>
                }
            >
                <span className="row__title">
                    {title.kind === 'level'
                        ? `Delete ${title.name} and its saves from the cloud and every device? Where the level is downloaded, it stays.`
                        : `Delete the saves of ${title.name} from the cloud and every device, this one too?`}
                </span>
            </Row>
        );
    }
    return (
        <Row
            label={title.name}
            prompts={<Prompt variant="row" action="extra" label="Delete from cloud" icon={<TrashIcon />} disabled={!online} onPress={() => setConfirm(true)} />}
        >
            <span className="row__title">{title.name}</span>
            <span className="row__meta">{meta}</span>
            {problem !== null ? <span className="row__meta notice--error">{problem}</span> : null}
        </Row>
    );
}
