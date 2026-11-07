// The engine's side of the contract, from tools/shared/emscripten/
// trx-adapter.d.ts in the TRX repository. Declared here because the engine
// is loaded at run time from a URL the bundler never sees.

export interface TrxAdapters {
    /** Resolves once the player has interacted with the page. */
    startGate: () => Promise<void>;
    /** Mounts persistent storage at mountPath. */
    mountPersistence: (mountPath: string) => Promise<void>;
    /** Loads what persistent storage holds into the mounted directories. */
    syncPersistenceIn: () => Promise<void>;
    /** Writes the mounted directories back to persistent storage. */
    flushPersistence: () => void;
}

export interface TrxCreateOptions {
    canvas: HTMLCanvasElement;
    adapters: TrxAdapters;
    jsUrl?: string;
    wasmUrl?: string;
    dataUrl?: string;
    onStdout?: (text: string) => void;
    onStderr?: (text: string) => void;
}

/** The part of Emscripten's FS object the shell uses. */
export interface EngineFs {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
    symlink(target: string, path: string): void;
    analyzePath(path: string): { exists: boolean };
    readdir(path: string): string[];
    unlink(path: string): void;
    /** Returns the root of the mounted file system, which holds the mount. */
    mount(type: unknown, options: Record<string, unknown>, mountpoint: string): { mount: unknown };
    syncfs(populate: boolean, callback: (error: unknown) => void): void;
}

export interface TrxEngine {
    canvas: HTMLCanvasElement;
    fs: EngineFs;
    idbfs: unknown;
    version: string;
    run(args: string[]): Promise<number>;
    syncViewport(): void;
}

export type CreateTrx = (options: TrxCreateOptions) => Promise<TrxEngine>;
