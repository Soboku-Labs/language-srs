import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.ts';
import { DEMO_EMAIL, DEMO_PASSWORD, demoLoginRefusal, demoLoginRequested, seedDemoAccount } from './services/demo.ts';
import { VocabularyService } from './services/vocabulary.ts';
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
 *   VOCAB_DIR         data/vocab       — the word lists this server hands out
 *   ALLOWED_ORIGINS   *                — comma-separated, e.g. https://example.com
 *   DEMO_LOGIN        unset            — "1" seeds an admin/admin account for
 *                                        development. Refuses to start with
 *                                        NODE_ENV=production. See services/demo.ts.
 */
const port = Number(process.env.PORT ?? 4000);
const dataDir = process.env.DATA_DIR ?? '.data';
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((origin) => origin.trim());
/**
 * The word lists, found relative to this file rather than to the shell.
 *
 * `npm run server` from the repository root runs the script with the *workspace*
 * as its working directory, so a default of `data/vocab` resolved to
 * `apps/server/data/vocab` and quietly found nothing: an API that answered
 * `/vocabulary` with an empty manifest and every level with a 404, while logging
 * four lines nobody was reading. The files sit at a known place relative to this
 * source, so that is where the default looks. An explicit `VOCAB_DIR` still wins
 * and is still resolved against the shell's cwd, which is what a person typing
 * one expects.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const vocabDir = process.env.VOCAB_DIR ?? resolve(repoRoot, 'data/vocab');

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

/**
 * The word lists, read once into memory.
 *
 * 1.7MB of read-only data that every client wants and nothing ever writes —
 * the one shape where holding it in memory is simply correct. Missing files are
 * survivable and logged: this server's other job is accounts, and refusing to
 * start over a word list would take sign-in down with it.
 */
const vocabulary = await VocabularyService.load(vocabDir);

/*
 * The demo login, if it was asked for.
 *
 * Refusing to start beats starting with a known password: a warning in a
 * startup log is not a control, because nobody reads the startup logs of a
 * server that started.
 */
const demoRefusal = demoLoginRefusal();
if (demoRefusal) {
  console.error(`[api] cannot start: ${demoRefusal}`);
  console.error('[api] unset DEMO_LOGIN, or do not set NODE_ENV=production.');
  process.exit(1);
}

let demoSeeded = false;
if (demoLoginRequested()) {
  demoSeeded = await seedDemoAccount(store);
}

const app = createApp({ store, vocabulary, allowedOrigins });

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
  console.log(`[api] accounts in ${dataDir === 'memory' ? 'memory (nothing is kept)' : dataDir}`);
  console.log(`[api] vocabulary from ${vocabDir}`);

  if (demoLoginRequested()) {
    // Loud on every boot, not just the one that created it, so an instance
    // that has been running for a week still says what it is.
    console.warn('[api] ================================================');
    console.warn(`[api] DEMO LOGIN IS ON — ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    console.warn(`[api] ${demoSeeded ? 'account created' : 'account already present'}`);
    console.warn('[api] Anyone who can reach this server can sign in.');
    console.warn('[api] ================================================');
  }
});

// A container stop should close connections rather than have them cut.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close(() => process.exit(0));
  });
}
