import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { SEED_ENTRIES, StudyEngine, type Account } from '@language-srs/core';
import { Accounts, AuthError } from './accounts.ts';
import { FileStore } from './store.ts';
import { authRoutes } from './routes/auth.ts';
import { studyRoutes } from './routes/study.ts';

/**
 * The backend.
 *
 * One service over `@language-srs/core`, so the clients render and never
 * reimplement. That is the whole point: a scheduler hand-ported into Swift and
 * again into Kotlin is three chances for a learner's phone and laptop to
 * disagree about when a word is due, and the disagreement would be silent.
 *
 * Built on `node:http` with no framework. The surface is a dozen routes with
 * JSON in and JSON out; a router dependency would be more code to audit than
 * the forty lines below.
 *
 * ## Offline
 *
 * Centralising the scheduler puts it behind a network, and an SRS that stops
 * working on the Underground is a worse product. The design answer is that
 * `POST /study/grades` takes a *batch* of gradings, each carrying the instant it
 * happened — so a client can record reviews offline and replay them later, and
 * the scheduler sees the real timestamps rather than the moment the signal came
 * back. The engine already works this way for home-screen widget taps.
 */

export interface ServerOptions {
  /** Where accounts, tokens and per-account decks are written. */
  dataDir: string;
  port?: number;
  /** Origins allowed to call this from a browser. `*` in development only. */
  allowedOrigins?: string[];
}

export interface RequestContext {
  account: Account;
  engine: StudyEngine;
  url: URL;
  body: unknown;
}

export type Handler = (context: RequestContext) => Promise<unknown>;

/** Thrown by a route to produce a specific status rather than a 500. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function createApp(options: ServerOptions) {
  const accounts = new Accounts(new FileStore(join(options.dataDir, 'accounts')));

  /**
   * One engine per account, kept in memory.
   *
   * Rebuilding it per request would re-read and re-parse every card the learner
   * owns on every call. Cached by account id and shared, which is safe because
   * Node runs one request at a time per process and every mutation persists
   * before the response is written.
   */
  const engines = new Map<string, Promise<StudyEngine>>();
  const engineFor = (account: Account): Promise<StudyEngine> => {
    const existing = engines.get(account.id);
    if (existing) return existing;

    const created = StudyEngine.create({
      store: new FileStore(join(options.dataDir, 'decks', account.id)),
      seedEntries: SEED_ENTRIES,
    });
    engines.set(account.id, created);
    return created;
  };

  const study = studyRoutes();
  const auth = authRoutes(accounts);

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = request.headers.origin;
    const allowed = options.allowedOrigins ?? ['*'];
    if (origin && (allowed.includes('*') || allowed.includes(origin))) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');

    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const route = `${request.method} ${url.pathname}`;

    try {
      const body = await readJsonBody(request);

      if (url.pathname === '/health') return send(response, 200, { ok: true });

      const authHandler = auth[route];
      if (authHandler) return send(response, ...(await authHandler(body, bearer(request))));

      const studyHandler = study[route] ?? study[`${request.method} ${patternise(url.pathname)}`];
      if (!studyHandler) return send(response, 404, { code: 'not-found', message: `No route ${route}` });

      const account = await accounts.verify(bearer(request));
      if (!account) {
        return send(response, 401, { code: 'unauthorised', message: 'Sign in first.' });
      }

      const result = await studyHandler({ account, engine: await engineFor(account), url, body });
      return send(response, 200, result ?? { ok: true });
    } catch (cause) {
      if (cause instanceof AuthError || cause instanceof HttpError) {
        return send(response, cause.status, { code: cause.code, message: cause.message });
      }
      // Logged in full, reported as a generic failure: a stack trace in a
      // response body is a gift to whoever is probing the service.
      console.error(`${route} failed`, cause);
      return send(response, 500, { code: 'server', message: 'Something went wrong.' });
    }
  }

  return {
    handle,
    accounts,
    listen(port = options.port ?? 8787) {
      const server = createServer((request, response) => void handle(request, response));
      server.listen(port);
      return server;
    },
  };
}

/** `/study/cards/zh-nihao:recognition/suspend` -> `/study/cards/:id/suspend`. */
function patternise(pathname: string): string {
  return pathname.replace(/^\/study\/cards\/[^/]+\//, '/study/cards/:id/');
}

function bearer(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    // A word-list import is the largest honest body; past this it is an attack
    // or a mistake, and either way reading it all into memory is the wrong move.
    if (size > 8 * 1024 * 1024) throw new HttpError(413, 'too-large', 'Body over 8MB.');
    chunks.push(chunk as Buffer);
  }

  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid-json', 'Body is not valid JSON.');
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  // 204 means no body, and `JSON.stringify(undefined)` is `undefined` rather
  // than a string — measuring it throws, which turned a correct sign-out into a
  // 500 after the session had already been destroyed.
  if (status === 204 || body === undefined) {
    response.writeHead(status === 204 ? 204 : status, { 'Content-Length': 0 });
    response.end();
    return;
  }

  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
}
