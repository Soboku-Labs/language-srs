import { createApp } from './app.ts';
import { JsonFileServerStore } from './store/json-file.ts';
import { MemoryServerStore } from './store/memory.ts';
import type { ServerStore } from './store/types.ts';

/**
 * The entry point.
 *
 * Configuration is environment variables with defaults that work: `npm run
 * server` in a fresh clone starts a usable API on port 4000 storing accounts in
 * `.data/accounts.json`, with no setup step and nothing to provision.
 *
 *   PORT              4000
 *   DATA_DIR          .data            — set to "memory" for a disposable server
 *   ALLOWED_ORIGINS   *                — comma-separated, e.g. https://example.com
 */
const port = Number(process.env.PORT ?? 4000);
const dataDir = process.env.DATA_DIR ?? '.data';
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((origin) => origin.trim());

/**
 * Open the store, or refuse to start.
 *
 * Deliberately fatal. A server that cannot persist accounts can still answer a
 * health check, which means a platform will happily route traffic to it and
 * every sign-up will fail one at a time. Failing here puts the reason in the
 * deployment log, which is where somebody is looking.
 */
let store: ServerStore;
try {
  store =
    dataDir === 'memory'
      ? new MemoryServerStore()
      : await JsonFileServerStore.open(JsonFileServerStore.pathFor(dataDir));
} catch (error) {
  console.error(`[api] cannot start: ${(error as Error).message}`);
  process.exit(1);
}

const app = createApp({ store, allowedOrigins });

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
  console.log(`[api] accounts in ${dataDir === 'memory' ? 'memory (nothing is kept)' : dataDir}`);
});

// A container stop should close connections rather than have them cut.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close(() => process.exit(0));
  });
}
