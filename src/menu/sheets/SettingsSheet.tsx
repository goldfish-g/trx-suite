// The app's own settings: installing it, storage, motion, and where things come from.

import { useEffect, useState } from 'react';
import { promptInstall, useInstall } from '../../pwa/install';
import { formatBytes } from '../../ui/format';
import { InstallIcon } from '../../ui/icons';
import { GameText } from '../../ui/GameText';
import { Sheet } from '../../ui/Sheet';
import { reducedMotionChoice, setReducedMotionChoice } from '../motion';

interface Storage {
    usage: number;
    quota: number;
    persisted: boolean;
}

export function SettingsSheet({ onClose, onNewFlyby }: { onClose(): void; onNewFlyby(): void }) {
    const mode = useInstall((state) => state.mode);
    const [storage, setStorage] = useState<Storage | null>(null);
    const [motion, setMotion] = useState(reducedMotionChoice);

    useEffect(() => {
        void (async () => {
            const estimate = await navigator.storage?.estimate?.();
            const persisted = (await navigator.storage?.persisted?.()) ?? false;
            if (estimate !== undefined) setStorage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted });
        })();
    }, []);

    const keepFiles = async () => {
        const persisted = (await navigator.storage?.persist?.()) ?? false;
        setStorage((current) => (current === null ? current : { ...current, persisted }));
    };

    return (
        <Sheet title="Settings" eyebrow="TRX" onClose={onClose}>
            {mode !== 'installed' ? (
                <section className="sheet__section">
                    <h3 className="sheet__heading">
                        <GameText text="Install the app" />
                    </h3>
                    {mode === 'prompt' ? (
                        <>
                            <p className="sheet__text">
                                Installed, it opens like any other app and plays your downloaded games without a connection.
                            </p>
                            <div className="sheet__actions">
                                <button className="button button--primary" data-autofocus onClick={() => void promptInstall()}>
                                    <InstallIcon />
                                    <GameText text="Install" />
                                </button>
                            </div>
                        </>
                    ) : mode === 'ios' ? (
                        <p className="sheet__text">
                            In Safari, tap the Share button, then “Add to Home Screen”. The app then opens full screen and
                            plays your downloaded games offline.
                        </p>
                    ) : (
                        <p className="sheet__text sheet__text--quiet">
                            Your browser can install this app from its menu (“Install app” or “Add to Home screen”).
                        </p>
                    )}
                </section>
            ) : null}

            <section className="sheet__section">
                <h3 className="sheet__heading">
                    <GameText text="Background" />
                </h3>
                <div className="sheet__actions">
                    <button className="button" data-autofocus={mode === 'installed' ? true : undefined} onClick={onNewFlyby}>
                        <GameText text="Fly through another level" />
                    </button>
                </div>
                <div className="field">
                    <span className="field__label">Reduce motion</span>
                    <div className="choices" role="radiogroup" aria-label="Reduce motion">
                        {(
                            [
                                ['system', 'As the system says'],
                                ['on', 'On'],
                                ['off', 'Off'],
                            ] as const
                        ).map(([choice, text]) => (
                            <button
                                key={choice}
                                className={`choice ${motion === choice ? 'choice--on' : ''}`}
                                role="radio"
                                aria-checked={motion === choice}
                                onClick={() => {
                                    setMotion(choice);
                                    setReducedMotionChoice(choice);
                                }}
                            >
                                <GameText text={text} />
                            </button>
                        ))}
                    </div>
                </div>
                <p className="sheet__text sheet__text--quiet">Takes effect the next time the menu opens.</p>
            </section>

            <section className="sheet__section">
                <h3 className="sheet__heading">
                    <GameText text="Storage" />
                </h3>
                {storage === null ? (
                    <p className="sheet__text sheet__text--quiet">This browser doesn’t say how much it stores.</p>
                ) : (
                    <>
                        <p className="sheet__text">
                            Games and saves use {formatBytes(storage.usage)}
                            {storage.quota > 0 ? ` of the ${formatBytes(storage.quota)} the browser allows` : ''}.
                        </p>
                        {storage.persisted ? (
                            <p className="sheet__text sheet__text--quiet">The browser keeps these files even when space runs low.</p>
                        ) : (
                            <div className="sheet__actions">
                                <button className="button" onClick={() => void keepFiles()}>
                                    <GameText text="Ask the browser to keep the files" />
                                </button>
                            </div>
                        )}
                    </>
                )}
            </section>

            <section className="sheet__section">
                <h3 className="sheet__heading">
                    <GameText text="About" />
                </h3>
                <p className="sheet__text sheet__text--quiet">
                    Plays the games with TRX by LostArtefacts. The flyby reads the original level files in the browser, an
                    idea from Evgeny Popov’s TRN viewer. Tomb Raider is a trademark of its owners; this app is not affiliated
                    with them. Games other than the free expansions download only for players whose store account owns them.
                </p>
            </section>
        </Sheet>
    );
}
