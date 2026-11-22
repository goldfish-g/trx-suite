import { describe, expect, it } from 'vitest';
import { EngineStoppedError } from './stopped';

describe('EngineStoppedError', () => {
    it('tells the last error the engine logged, without its colours, time and source', () => {
        const error = new EngineStoppedError(1, [
            '\x1b[0mINF | 2026-11-22 14:35:23.700 [game/shell/main.c:39:main] Starting TRX 1.12-17-g319a4c2\x1b[0m',
            '\x1b[31mERR | 2026-11-22 14:35:23.761 [game/game_flow/reader.c:1116:M_LoadFMV] No file named by FMV 1\'s \'path\' is installed\x1b[0m',
            '\x1b[0mINF | 2026-11-22 14:35:24.100 [game/shell/main.c:80:main] Exiting\x1b[0m',
        ]);
        expect(error.message).toBe("The engine stopped before the game started (exit code 1): No file named by FMV 1's 'path' is installed");
    });

    it('falls back to the last line, or to nothing', () => {
        expect(new EngineStoppedError(0, ['', 'bye']).message).toBe('The engine stopped before the game started (exit code 0): bye');
        expect(new EngineStoppedError(2, []).message).toBe('The engine stopped before the game started (exit code 2).');
    });
});
