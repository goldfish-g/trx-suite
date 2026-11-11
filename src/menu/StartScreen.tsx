// The screen the app opens on: who made the games playable here and where
// problems go (to this app's maker, never to the level authors or to
// LostArtefacts). Source opens a panel of where the code lives. The player
// presses Continue to reach the menu, and that press is also what lets the
// browser start the menu's music. The level flies by behind it meanwhile.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { pushLayer } from '../input/controller';
import { BrandLogo } from '../ui/BrandLogo';
import { GameText } from '../ui/GameText';
import { ExternalIcon } from '../ui/icons';
import { Prompt } from '../ui/Prompt';
import { Sheet } from '../ui/Sheet';

const ISSUES_URL = 'https://github.com/goldfish-g/trx-suite/issues';

interface Repo {
    name: string;
    what: string;
    url: string;
    /** The branch the work lives on, when it is not the default one. */
    branch?: string;
}

const REPOS: readonly Repo[] = [
    { name: 'trx-suite', what: 'This app: the menus, downloads, saves and flybys.', url: 'https://github.com/goldfish-g/trx-suite' },
    {
        name: 'TRX, for the browser',
        what: 'My WebGL build of the engine.',
        url: 'https://github.com/goldfish-g/TRX',
        branch: 'feature/webgl-build-pr',
    },
    {
        name: 'trx-update-tool',
        what: 'Brings custom levels made for older TRX up to date.',
        url: 'https://github.com/goldfish-g/trx-update-tool',
        branch: 'fix/lzma-and-templates',
    },
    { name: 'trx-webgl-shell', what: 'The plain web shell the engine builds are tested in.', url: 'https://github.com/goldfish-g/trx-webgl-shell' },
    { name: 'TRX', what: 'The engine itself, by LostArtefacts.', url: 'https://github.com/LostArtefacts/TRX' },
];

function hrefOf(repo: Repo): string {
    return repo.branch === undefined ? repo.url : `${repo.url}/tree/${repo.branch}`;
}

function Link({ href, children }: { href: string; children: ReactNode }) {
    return (
        <a className="start__link" href={href} target="_blank" rel="noreferrer noopener">
            {children}
        </a>
    );
}

/** Where the code lives, one stop per repository for the d-pad. */
function SourceSheet({ onClose }: { onClose(): void }) {
    return (
        <Sheet title="Source" eyebrow="Where the code lives" onClose={onClose}>
            <ul className="list source">
                {REPOS.map((repo) => (
                    <li key={repo.url}>
                        <a className="list__row source__repo" href={hrefOf(repo)} target="_blank" rel="noreferrer noopener">
                            <span className="list__main">
                                <span className="list__title">{repo.name}</span>
                                <span className="source__what">{repo.what}</span>
                                <span className="list__meta source__url">{repo.url.replace(/^https:\/\//, '')}</span>
                                {repo.branch !== undefined ? <span className="list__meta source__url">Branch {repo.branch}</span> : null}
                            </span>
                            <ExternalIcon />
                        </a>
                    </li>
                ))}
            </ul>
        </Sheet>
    );
}

export function StartScreen({ onContinue }: { onContinue(): void }) {
    const panel = useRef<HTMLDivElement>(null);
    const done = useRef(onContinue);
    done.current = onContinue;
    const [source, setSource] = useState(false);

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
            <div ref={panel} className="start" role="dialog" aria-modal="true" aria-labelledby="start-title" inert={source}>
                <div className="start__body">
                    <header className="start__header">
                        <h1 className="start__title" id="start-title">
                            <BrandLogo className="start__logo" />
                        </h1>
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
                        <a className="button start__report" href={ISSUES_URL} target="_blank" rel="noreferrer noopener">
                            <GameText text="Report a problem" />
                            <ExternalIcon />
                        </a>
                    </section>

                    <p className="start__legal">
                        Tomb Raider is a trademark of its owners. This is an unofficial fan project, not affiliated with them,
                        with LostArtefacts or with TRCustoms.
                    </p>
                </div>

                <footer className="start__footer">
                    <Prompt action="extra" label="Source" global onPress={() => setSource(true)} className="start__source" />
                    <Prompt action="confirm" label="Continue" variant="primary" global onPress={() => done.current()} className="start__continue" />
                </footer>
            </div>
            {source ? <SourceSheet onClose={() => setSource(false)} /> : null}
        </div>
    );
}
