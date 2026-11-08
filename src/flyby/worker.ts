// The worker that reads levels for the background.

import { prepareLevel, preparedTransferables, type RouteData } from './prepare';

export interface WorkerRequest {
    id: number;
    bytes: Uint8Array;
    fileName: string;
    seed?: number;
    /** Routes planned ahead for the level, if any. */
    planned?: RouteData[] | null;
    /** How many tours to try when planning now. */
    attempts?: number;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const { id, bytes, fileName, seed, planned, attempts } = event.data;
    try {
        const prepared = await prepareLevel(bytes, fileName, seed, planned, attempts);
        (self as unknown as Worker).postMessage({ id, prepared }, preparedTransferables(prepared));
    } catch (error) {
        (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
};
