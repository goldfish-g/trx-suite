// Starts the server: node server/src/main.ts (Node runs the TypeScript as is).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from './app.ts';
import { ConfigError, loadConfig, type LoadedConfig } from './config.ts';

let loaded: LoadedConfig;
try {
    loaded = loadConfig(process.env);
} catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`trx-web: ${error.message}`);
    process.exit(1);
}
const { config, warnings } = loaded;

const app = await buildApp(config, { logger: { level: process.env.LOG_LEVEL ?? 'info' } });
for (const warning of warnings) app.log.warn(warning);
if (!existsSync(join(config.staticDir, 'index.html'))) {
    app.log.warn(`No built page in ${config.staticDir} (run pnpm build); only the API and files are served.`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
        app.close().then(
            () => process.exit(0),
            () => process.exit(1),
        );
    });
}

await app.listen({ port: config.port, host: config.host });
app.log.info(
    { publicUrl: config.publicUrl, dataDir: config.dataDir, enginesDir: config.enginesDir, staticDir: config.staticDir },
    `trx-web is up; players reach it at ${config.publicUrl}`,
);
