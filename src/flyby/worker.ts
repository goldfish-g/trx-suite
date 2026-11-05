// The worker that reads levels for the background.

import { prepareLevel, preparedTransferables } from './prepare';

export interface WorkerRequest {
    id: number;
    bytes: Uint8Array;
    fileName: string;
    seed?: number;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const { id, bytes, fileName, seed } = event.data;
    try {
        const prepared = await prepareLevel(bytes, fileName, seed);
        (self as unknown as Worker).postMessage({ id, prepared }, preparedTransferables(prepared));
    } catch (error) {
        (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
};
