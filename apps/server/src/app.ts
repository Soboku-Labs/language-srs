import { IncomingMessage, createServer, type ServerResponse } from 'node:http';
import {
  createServer as createHttp2Server,
  type Http2ServerRequest,
  type Http2ServerResponse,
} from 'node:http2';
import { join } from 'node:path';
import { cors } from '@connectrpc/connect';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { SEED_ENTRIES, StudyEngine, type Account } from '@mon/core';
import { Accounts, AuthError } from './accounts.ts';
import { connectRoutes } from './connect/index.ts';
import { FileStore } from './store.ts';
import { authRoutes } from './routes/auth.ts';
import { studyRoutes } from './routes/study.ts';

/**
 * The backend.
 *
 * One service over `@mon/core`, so the clients render and never
 * reimplement. That is the whole point: a scheduler hand-ported into Swift and
 * again into Kotlin is three chances for a learner's phone and laptop to
 * disagree about when a word is due, and the disagreement would be silent.
 *
 * ## Two surfaces, one implementation
 *
 * The front door is **Connect**, serving `proto/mon/v1/mon.proto`. It speaks
 * gRPC, gRPC-Web and HTTP/JSON from this one process, so the phones get binary
 * gRPC over HTTP/2 and the browser calls it directly with no Envoy sidecar to
 * deploy and monitor. That is the whole reason Connect was chosen over raw gRPC:
 * a browser cannot speak gRPC, because HTTP/2 trailers are not exposed to
 * JavaScript.
 *
 * The hand-rolled JSON routes under `/auth` and `/study` are still served, as
 * Connect's fallback. They are what `HttpAuthProvider` in the core was written
 * against, and removing them would break the only client that exists today for
 * the sake of tidiness. Both surfaces call the same `Accounts` and the same
 * per-account `StudyEngine` — there is no second implementation of anything,
 * only a second doorway.
 *
 * Built on `node:http` with no framework. A router dependency would be more
 * code to audit than the dispatch below.
 *
 * ## Offline
 *
 * Centralising the scheduler puts it behind a network, and an SRS that stops
 * working on the Underground is a worse product. The design answer is that
 * `SubmitGrades` takes a *batch* of gradings, each carrying the instant it
 * happened — so a client can record reviews offline and replay them later, and
 * the scheduler sees the real timestamps rather than the moment the signal came
 * back. The engine already works this way for home-screen widget taps.
 */

/**
 * Either protocol's request and response.
 *
 * One listener serves HTTP/1.1 and cleartext HTTP/2, so the request objects
 * arrive as whichever pair the connection produced. They are interchangeable for
 * everything done here — method, url, headers, a status and a body — and differ
 * only in the overload *shapes* TypeScript sees, which is why the response is
 * narrowed once per function rather than threaded through as a union.
 */
type NodeRequest = IncomingMessage | Http2ServerRequest;
type NodeResponse = ServerResponse | Http2ServerResponse;

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

  async function handleJson(request: IncomingMessage, response: ServerResponse): Promise<void> {
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

  /**
   * Connect in front, the JSON routes behind it.
   *
   * The adapter claims only the paths its services actually own
   * (`/mon.v1.AuthService/SignIn` and the rest) and hands everything else to
   * `fallback`, so `/health` and the existing routes are untouched. Dispatching
   * this way rather than by sniffing the path means the list of RPC paths comes
   * from the generated code, and cannot drift from the proto.
   */
  const connect = connectNodeAdapter({
    routes: connectRoutes({ accounts, engineFor }),
    fallback: (request, response) => {
      /*
       * `listen()` builds an HTTP/1.1 server, so the fallback always receives
       * the `node:http` pair. The adapter's signature is wider because the same
       * adapter can be mounted on an `http2` server, where these routes have
       * never run — so the request is *checked* rather than asserted, and an
       * HTTP/2 caller is told the JSON surface does not speak it instead of
       * failing somewhere inside `writeHead` with nothing to debug.
       *
       * The response needs one cast either way: the adapter types it as a union
       * of two `Omit<..., 'write'>`s, whose overloads TypeScript cannot resolve
       * against each other. `writeHead` and `end` behave the same on both.
       */
      const reply = response as unknown as ServerResponse;
      if (!(request instanceof IncomingMessage)) {
        reply.writeHead(505, { 'Content-Length': 0 }).end();
        return;
      }
      void handleJson(request, reply);
    },
  });

  async function handle(request: NodeRequest, response: NodeResponse): Promise<void> {
    // See `NodeResponse`: the two protocols' response objects differ only in
    // overload shape, and every header call below exists on both.
    const reply = response as unknown as ServerResponse;
    const origin = request.headers.origin;
    const allowed = options.allowedOrigins ?? ['*'];
    if (origin && (allowed.includes('*') || allowed.includes(origin))) {
      reply.setHeader('Access-Control-Allow-Origin', origin);
      reply.setHeader('Vary', 'Origin');
    }

    /*
     * Connect's own header lists, plus Authorization.
     *
     * Hard-coding these was the first attempt and it silently broke the browser
     * client: a Connect request carries `Connect-Protocol-Version`, and a
     * preflight that does not allow it fails before the RPC is ever sent. The
     * library publishes the set it needs, so it is taken from there and will
     * follow the protocol if it gains a header.
     */
    reply.setHeader(
      'Access-Control-Allow-Headers',
      [...cors.allowedHeaders, 'Authorization'].join(', '),
    );
    reply.setHeader(
      'Access-Control-Allow-Methods',
      [...new Set([...cors.allowedMethods, 'PATCH', 'OPTIONS'])].join(', '),
    );
    reply.setHeader('Access-Control-Expose-Headers', cors.exposedHeaders.join(', '));
    // Without this a browser re-preflights every RPC, which doubles the request
    // count for a client that makes one call per screen.
    reply.setHeader('Access-Control-Max-Age', '7200');

    if (request.method === 'OPTIONS') {
      reply.writeHead(204, { 'Content-Length': 0 }).end();
      return;
    }

    connect(request, response);
  }

  return {
    handle,
    accounts,
    /**
     * The main listener: HTTP/1.1.
     *
     * Serves the Connect protocol (binary protobuf or JSON), gRPC-Web, and the
     * JSON routes. That covers every client this product has or plans: the
     * browser, and `connect-swift` / `connect-kotlin`, which speak the Connect
     * protocol with protobuf bodies over ordinary HTTP — so the phones get
     * binary payloads without needing HTTP/2 at all.
     */
    listen(port = options.port ?? 8787) {
      const server = createServer((request, response) => void handle(request, response));
      server.listen(port);
      return server;
    },

    /**
     * A second listener, for real gRPC.
     *
     * gRPC needs HTTP/2, because it carries its status in trailers — and node
     * cannot serve cleartext HTTP/2 and HTTP/1.1 on one port. `allowHTTP1` works
     * only on a TLS listener, where ALPN does the negotiating; on a plain socket
     * `http2.createServer` speaks h2c and nothing else, and an HTTP/1.1 client
     * gets a binary frame where it expected a status line. (Which is precisely
     * what happened when this was one listener: all 27 HTTP tests failed with
     * `HPE_INVALID_CONSTANT`.)
     *
     * So: two ports, and the same `handle` behind both. Only worth starting if
     * something genuinely speaks gRPC — a Go service, `grpcurl`, an Envoy mesh.
     * Cleartext, because TLS belongs to whatever terminates it in front; a server
     * that loads its own certificates has an opinion about where it is deployed.
     */
    listenGrpc(port: number) {
      const server = createHttp2Server((request, response) => void handle(request, response));
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
