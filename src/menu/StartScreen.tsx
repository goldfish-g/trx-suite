// The screen the app opens on: who made the games playable here, where
// problems go (to this app's maker, never to the level authors or to
// LostArtefacts), and where the code lives. The player presses Continue to
// reach the menu, and that press is also what lets the browser start the
// menu's music. The level flies by behind it meanwhile.

import { useEffect, useRef, type ReactNode } from 'react';
import { pushLayer } from '../input/controller';
import { GameText } from '../ui/GameText';
import { Prompt } from '../ui/Prompt';

const MAINTAINER = 'goldfish-g';
const ISSUES_URL = 'https://github.com/goldfish-g/trx-suite/issues';
const PROFILE_URL = 'https://github.com/goldfish-g';

interface Repo {
    name: string;
    what: string;
    url: string;
    /** The branch the work lives on, when it is not the default one. */
    branch?: string;
}

const REPOS: readonly Repo[] = [
    { name: 'trx-suite', what: 'this app: the menus, downloads, saves and flybys', url: 'https://github.com/goldfish-g/trx-suite' },
    {
        name: 'TRX, for the browser',
        what: 'my WebGL build of the engine',
        url: 'https://github.com/goldfish-g/TRX',
        branch: 'feature/webgl-build-pr',
    },
    {
        name: 'trx-update-tool',
        what: 'brings custom levels made for older TRX up to date',
        url: 'https://github.com/goldfish-g/trx-update-tool',
        branch: 'fix/lzma-and-templates',
    },
    { name: 'trx-webgl-shell', what: 'the plain web shell the engine builds are tested in', url: 'https://github.com/goldfish-g/trx-webgl-shell' },
    { name: 'TRX', what: 'the engine itself, by LostArtefacts', url: 'https://github.com/LostArtefacts/TRX' },
];

function hrefOf(repo: Repo): string {
    return repo.branch === undefined ? repo.url : `${repo.url}/tree/${repo.branch}`;
}

function shown(url: string): string {
    return url.replace(/^https:\/\//, '');
}

function Link({ href, children }: { href: string; children: ReactNode }) {
    return (
        <a className="start__link" href={href} target="_blank" rel="noreferrer noopener">
            {children}
        </a>
    );
}

export function StartScreen({ onContinue }: { onContinue(): void }) {
    const panel = useRef<HTMLDivElement>(null);
    const done = useRef(onContinue);
    done.current = onContinue;

    // (A), Enter or Start continues (the prompt answers (A) and Enter); nothing
    // else in the menu answers until then. A click on it sounds like the games' choose.
    useEffect(
        () =>
            pushLayer({
                root: () => panel.current,
                keepFocus: false,
                onAction: (action) => {
                    if (action !== 'menu') return false;
                    panel.current?.querySelector<HTMLElement>('.start__continue')?.click();
                    return true;
                },
            }),
        [],
    );

    return (
        <div className="start-layer">
            <div
                ref={panel}
                className="start"
                role="dialog"
                aria-modal="true"
                aria-labelledby="start-title"
            >
                <div className="start__body">
                    <header className="start__header">
                        <h1 className="start__title" id="start-title">
                            <GameText text="TRX" />
                        </h1>
                        <p className="start__line">Tomb Raider, in your browser</p>
                    </header>

                    <section className="start__section">
                        <h2 className="start__heading">
                            <GameText text="With thanks to" />
                        </h2>
                        <ul className="start__credits">
                            <li>
                                <strong>LostArtefacts</strong>, for <Link href="https://github.com/LostArtefacts/TRX">TRX</Link>, the
                                engine every game here runs on. Its fonts and button icons dress these menus too.
                            </li>
                            <li>
                                <strong>
                                    <Link href="https://trcustoms.org">TRCustoms</Link>
                                </strong>
                                , home of the community’s custom levels. Each level belongs to the builder who made it.
                            </li>
                        </ul>
                    </section>

                    <section className="start__section start__section--problems">
                        <h2 className="start__heading">
                            <GameText text="Found a problem?" />
                        </h2>
                        <p className="start__text">
                            This browser version is my own work. LostArtefacts, TRCustoms and the level builders have nothing to
                            do with it, so please <strong>tell me first</strong> about anything that goes wrong here: a game, a
                            custom level, a save or the menus. The cause is far more likely to be my port, or how it updated a
                            level, than the level itself.
                        </p>
                        <p className="start__text">
                            <strong>Please don’t contact level builders or LostArtefacts</strong> about problems you find here.
                        </p>
                        <div className="start__contacts">
                            <a className="button" href={ISSUES_URL} target="_blank" rel="noreferrer noopener">
                                <GameText text="Report a problem" />
                            </a>
                            <a className="button" href={PROFILE_URL} target="_blank" rel="noreferrer noopener">
                                <GameText text={`${MAINTAINER} on GitHub`} />
                            </a>
                        </div>
                        <p className="start__text start__text--quiet">
                            Problems go to <Link href={ISSUES_URL}>{shown(ISSUES_URL)}</Link>; I’m{' '}
                            <Link href={PROFILE_URL}>{shown(PROFILE_URL)}</Link>.
                        </p>
                    </section>

                    <section className="start__section">
                        <h2 className="start__heading">
                            <GameText text="The code" />
                        </h2>
                        <ul className="start__repos">
                            {REPOS.map((repo) => (
                                <li key={repo.url} className="start__repo">
                                    <span className="start__repo-name">{repo.name}</span>
                                    <span className="start__repo-what">{repo.what}</span>
                                    <Link href={hrefOf(repo)}>
                                        {shown(repo.url)}
                                        {repo.branch !== undefined ? <span className="start__branch"> · {repo.branch}</span> : null}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </section>

                    <p className="start__legal">
                        Tomb Raider is a trademark of its owners. This is an unofficial fan project, not affiliated with them,
                        with LostArtefacts or with TRCustoms.
                    </p>
                </div>

                <footer className="start__footer">
                    <Prompt action="confirm" label="Continue" variant="primary" global onPress={() => done.current()} className="start__continue" />
                </footer>
            </div>
        </div>
    );
}
