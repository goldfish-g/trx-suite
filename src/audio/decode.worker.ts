// Turns a game's ADPCM music into plain PCM away from the page, which keeps
// drawing the flyby meanwhile.

import { playableWav } from './wav';

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    try {
        const wav = playableWav(new Uint8Array(event.data));
        if (wav === null) {
            self.postMessage(null);
            return;
        }
        const out = wav.byteOffset === 0 && wav.byteLength === wav.buffer.byteLength ? wav.buffer : wav.slice().buffer;
        self.postMessage(out, { transfer: [out] });
    } catch {
        self.postMessage(null);
    }
};
