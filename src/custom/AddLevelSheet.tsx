// Adds a custom level from files on the device: a zip or tar archive, level
// files, or a folder. Levels made for the original games or an older engine
// are converted for TRX as they come in.

import { useState } from 'react';
import type { GameDataRecord } from '../gamedata/types';
import { ENGINE_NAMES } from '../games/catalog';
import { useLibrary } from '../library/store';
import { describeDetection, describeError, inspectPicked, type PickedFiles } from '../menu/actions';
import { FilePicker } from '../menu/FilePicker';
import { GameText } from '../ui/GameText';
import { Sheet } from '../ui/Sheet';
import { addLevelFromFiles } from './actions';
import { gameTitle } from './labels';

export function AddLevelSheet({ onClose, onAdded }: { onClose(): void; onAdded(record: GameDataRecord): void }) {
    const { gamedata } = useLibrary();
    const [picked, setPicked] = useState<PickedFiles | null>(null);
    const [level, setLevel] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const inspect = async (files: File[], fromFolder: boolean) => {
        setBusy(true);
        setError(null);
        setPicked(null);
        try {
            const result = await inspectPicked(files, fromFolder);
            setPicked(result);
            setLevel(result.detection.kind === 'level' ? (result.detection.levels[0] ?? '') : '');
        } catch (problem) {
            setError(describeError(problem));
        } finally {
            setBusy(false);
        }
    };

    const add = async () => {
        if (picked === null) return;
        setBusy(true);
        setError(null);
        try {
            onAdded(await addLevelFromFiles(picked, level || undefined));
        } catch (problem) {
            setError(describeError(problem));
            setBusy(false);
        }
    };

    const detection = picked?.detection;
    const addable = detection?.kind === 'custom' || detection?.kind === 'level' || detection?.kind === 'convert';
    const engine = detection?.kind === 'custom' || detection?.kind === 'level' ? detection.engine : null;
    const baseMod = detection?.kind === 'custom' ? (detection.extendsMod ?? `tr${detection.engine}`) : engine !== null ? `tr${engine}` : null;
    const hasBase = baseMod === null || gamedata.some((record) => record.layout === 'game' && record.mod === baseMod && record.status === 'ready');

    return (
        <Sheet title="Add a custom level" eyebrow="From your device" onClose={onClose}>
            <section className="sheet__section">
                <p className="sheet__text">
                    Pick a level’s zip archive or its folder. TRX packages, levels made for the original games and levels made for older
                    engines all work: the TRX Level Converter turns them into packages of the current TRX as they come in.
                </p>
                <FilePicker disabled={busy} onPick={(files, fromFolder) => void inspect(files, fromFolder)} />
                {busy && picked === null ? <p className="sheet__text sheet__text--quiet">Reading the files…</p> : null}
                {picked !== null && detection !== undefined ? (
                    <div className="card">
                        <p className="card__title">{picked.name}</p>
                        <p className="sheet__text">{describeDetection(detection)}</p>
                        {detection.kind === 'level' && detection.levels.length > 1 ? (
                            <div className="field">
                                <span className="field__label">Level to start</span>
                                <div className="choices" role="radiogroup" aria-label="Level to start">
                                    {detection.levels.map((path) => (
                                        <button
                                            key={path}
                                            className={`choice ${path === level ? 'choice--on' : ''}`}
                                            role="radio"
                                            aria-checked={path === level}
                                            onClick={() => setLevel(path)}
                                        >
                                            <GameText text={path.slice(path.lastIndexOf('/') + 1)} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        {addable && !hasBase && engine !== null ? (
                            <p className="notice">
                                It builds on {gameTitle(engine)} ({ENGINE_NAMES[engine]}), which isn’t in your library yet. Add it too, or the level may
                                not start.
                            </p>
                        ) : null}
                        <div className="sheet__actions">
                            {addable ? (
                                <button className="button button--primary" data-autofocus disabled={busy} onClick={() => void add()}>
                                    <GameText text={detection.kind === 'level' ? 'Add to my levels' : 'Convert and add'} />
                                </button>
                            ) : null}
                            <button className="button button--quiet" onClick={() => setPicked(null)}>
                                <GameText text="Cancel" />
                            </button>
                        </div>
                    </div>
                ) : null}
                {error !== null ? <p className="notice notice--error">{error}</p> : null}
            </section>
        </Sheet>
    );
}
