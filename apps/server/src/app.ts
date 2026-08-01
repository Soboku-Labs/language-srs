import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { StudySessionRecord } from '@language-srs/core';
import { bearerFrom } from './crypto/tokens.ts';
import { ApiError } from './http/errors.ts';
import { Router, readJsonBody, type RouteContext, type RouteResult } from './http/router.ts';
import { AuthService, toPublicUser } from './services/auth.ts';
import { StateConflictError, StateService } from './services/state.ts';
import type { VocabularyService } from './services/vocabulary.ts';
import type { ServerStore, SessionRecord, UserRecord } from './store/types.ts';

export interface AppOptions {
  store: ServerStore;
  /**
   * The word lists.
   *
   * Optional: an API with no vocabulary still serves accounts, and clients fall
   * back to the starter deck they carry. Tests that only care about auth leave
   * it out.
   */
  vocabulary?: VocabularyService;
  now?: () => Date;
  /**
   * Origins allowed to call this API from a browser.
   *
   * `*` is the default and is defensible *here*: this API authenticates with a
   * bearer token the app holds, not with a cookie the browser attaches
   * automatically, so a hostile page reading a response it cannot authenticate
   * gets nothing. Set it to your own origin anyway when you deploy — defence in
   * depth costs an environment variable.
   */
  allowedOrigins?: string[];
  /** Body limits, in bytes. State sync legitimately carries an account. */
  maxBodyBytes?: { default: number; state: number };
  authOptions?: { maxFailedAttempts?: number; lockoutMinutes?: number };
}

interface Authenticated {
  user: UserRecord;
  session: SessionRecord;
}

/**
 * The API.
 *
 * Ten routes over three services. The shape is deliberately boring: every route
 * is "authenticate, validate, call a service, return a value", so the
 * interesting decisions all live in the services and the crypto where they can
 * be tested without a socket.
 */
export function createApp(options: AppOptions): Server {
  const now = options.now ?? (() => new Date());
  const auth = new AuthService({ store: options.store, now, ...(options.authOptions ?? {}) });
  const state = new StateService(options.store);
  const limits = options.maxBodyBytes ?? { default: 256 * 1024, state: 16 * 1024 * 1024 };
  const allowedOrigins = options.allowedOrigins ?? ['*'];

  /** Authenticate, or fail with 401. Used by everything except the two front doors. */
  const require = async (context: RouteContext): Promise<Authenticated> => {
    const token = bearerFrom(context.request.headers.authorization);
    if (!token) throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
    return auth.authenticate(token);
  };

  const router = new Router();

  router.get('/health', async () => ({ status: 200, body: { ok: true } }));

  // ---------------------------------------------------------------- accounts

  router.post('/auth/register', async ({ body }) => {
    const input = asObject(body);
    return {
      status: 201,
      body: await auth.register({
        email: asString(input.email, 'email'),
        password: asString(input.password, 'password'),
        displayName: optionalString(input.displayName),
        device: optionalString(input.device),
      }),
    };
  });

  router.post('/auth/login', async ({ body }) => {
    const input = asObject(body);
    return {
      status: 200,
      body: await auth.signIn({
        email: asString(input.email, 'email'),
        password: asString(input.password, 'password'),
        device: optionalString(input.device),
      }),
    };
  });

  router.get('/auth/me', async (context) => {
    const { user, session } = await require(context);
    return {
      status: 200,
      body: { user: toPublicUser(user), sessionId: session.id, expiresAt: session.expiresAt },
    };
  });

  router.post('/auth/logout', async (context) => {
    const { session } = await require(context);
    await auth.signOut(session.id);
    return { status: 204 };
  });

  router.post('/auth/logout-others', async (context) => {
    const { user, session } = await require(context);
    return { status: 200, body: await auth.signOutOthers(user.id, session.id) };
  });

  router.get('/auth/sessions', async (context) => {
    const { user, session } = await require(context);
    return { status: 200, body: { sessions: await auth.listSessions(user.id, session.id) } };
  });

  router.delete('/auth/sessions/:id', async (context) => {
    const { user } = await require(context);
    await auth.revokeSession(user.id, context.params.id!);
    return { status: 204 };
  });

  // ---------------------------------------------------------------- sync

  router.get('/state', async (context) => {
    const { user } = await require(context);
    return { status: 200, body: await state.get(user.id) };
  });

  router.put('/state', async (context) => {
    const { user } = await require(context);
    const input = asObject(context.body);

    const next = await state.put(
      user.id,
      {
        baseRevision: asNumber(input.baseRevision, 'baseRevision'),
        device: optionalString(input.device) ?? 'unknown device',
        values: asStringRecord(input.values),
      },
      now(),
    );

    return { status: 200, body: { revision: next.revision, updatedAt: next.updatedAt } };
  });

  // ---------------------------------------------------------------- sittings

  router.get('/study-sessions', async (context) => {
    const { user } = await require(context);
    return { status: 200, body: { sessions: await state.listStudySessions(user.id) } };
  });

  router.post('/study-sessions', async (context) => {
    const { user } = await require(context);
    const input = asObject(context.body);
    const incoming = Array.isArray(input.sessions) ? input.sessions : [input];

    const merged = await state.addStudySessions(user.id, incoming.map(asStudySession));
    return { status: 200, body: { sessions: merged } };
  });

  // ------------------------------------------------------------- vocabulary
  //
  // Public and unauthenticated on purpose: a published word list is the same for
  // everybody, and requiring a token to read it would mean a learner cannot see
  // the syllabus until they have an account.

  const vocabulary = options.vocabulary;

  const requireVocabulary = (): VocabularyService => {
    if (!vocabulary) throw new ApiError(404, 'not_found', 'This server has no vocabulary loaded.');
    return vocabulary;
  };

  router.get('/vocabulary', async () => ({
    status: 200,
    body: requireVocabulary().manifest,
    cache: 'short' as const,
  }));

  router.get('/vocabulary/:levelId', async (context) => {
    const service = requireVocabulary();
    const levelId = context.params.levelId!;
    const { languageCode, entries } = service.level(levelId);

    return {
      status: 200,
      body: { levelId, languageCode, version: service.version, entries },
      // Immutable for a given version, and the version is a hash of the content,
      // so a rebuilt dataset invalidates every cached copy without a manual bump.
      cache: 'immutable' as const,
      etag: `"${service.version}-${levelId}"`,
    };
  });

  /**
   * Several levels in one request.
   *
   * A learner targeting HSK 4 needs four levels, and four separate requests to a
   * sleeping free-tier server is four chances for one of them to be the slow one.
   */
  router.get('/vocabulary-levels', async (context) => {
    const service = requireVocabulary();
    const requested = (context.query.get('ids') ?? '').split(',').filter(Boolean);
    if (requested.length === 0) throw new ApiError(400, 'bad_request', 'Pass ?ids=level-1,level-2.');

    return {
      status: 200,
      body: { version: service.version, levels: service.levels(requested) },
      cache: 'immutable' as const,
      etag: `"${service.version}-${requested.join('-')}"`,
    };
  });

  return createServer((request, response) => {
    void handle(request, response, router, limits, allowedOrigins);
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  router: Router,
  limits: { default: number; state: number },
  allowedOrigins: string[],
): Promise<void> {
  const origin = request.headers.origin;
  const allowOrigin = allowedOrigins.includes('*')
    ? '*'
    : origin && allowedOrigins.includes(origin)
      ? origin
      : undefined;

  if (allowOrigin) {
    response.setHeader('Access-Control-Allow-Origin', allowOrigin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.setHeader('Access-Control-Expose-Headers', 'ETag');
  // Tokens and account state are never anybody's to cache. The routes that serve
  // public reference data say otherwise for themselves, below.
  response.setHeader('Cache-Control', 'no-store');

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  const url = new URL(request.url ?? '/', 'http://localhost');
  const matched = router.match(request.method ?? 'GET', url.pathname);

  if (matched === undefined) {
    send(response, 404, { error: 'not_found', message: 'No such endpoint.' });
    return;
  }
  if (matched === 'method-not-allowed') {
    send(response, 405, { error: 'bad_request', message: 'That endpoint does not accept this method.' });
    return;
  }

  try {
    const limit = url.pathname === '/state' ? limits.state : limits.default;
    const body =
      request.method === 'GET' || request.method === 'DELETE'
        ? undefined
        : await readJsonBody(request, limit);

    const result: RouteResult = await matched.handler({
      request,
      params: matched.params,
      query: url.searchParams,
      body,
    });

    if (result.cache === 'immutable') {
      response.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    } else if (result.cache === 'short') {
      response.setHeader('Cache-Control', 'public, max-age=3600');
    }

    if (result.etag) {
      response.setHeader('ETag', result.etag);
      // A device that already holds this level asks with the tag it has and gets
      // a few bytes back instead of half a megabyte.
      if (request.headers['if-none-match'] === result.etag) {
        response.writeHead(304).end();
        return;
      }
    }

    if (result.status === 204 || result.body === undefined) {
      response.writeHead(result.status).end();
      return;
    }
    send(response, result.status, result.body);
  } catch (error) {
    if (error instanceof StateConflictError) {
      send(response, error.status, { ...error.toBody(), current: error.current });
      return;
    }
    if (error instanceof ApiError) {
      send(response, error.status, error.toBody());
      return;
    }

    // Anything unexpected: log it here, tell the caller nothing. A stack trace
    // in a response body is a map of the server for whoever asked for it.
    console.error('[api] unhandled error', error);
    send(response, 500, { error: 'server_error', message: 'Something went wrong.' });
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    // A rejected upload is still arriving. Closing the connection after the
    // response stops it, where keep-alive would leave the rest of a body nobody
    // is reading queued against a connection waiting for its next request.
    ...(status === 413 ? { Connection: 'close' } : {}),
  });
  response.end(payload);
}

// ------------------------------------------------------------------ parsing
//
// Hand-written rather than schema-validated, for the same reason the router is
// hand-written: there are four shapes here. Every one of these throws a 400 the
// app can show, rather than letting `undefined` travel into a service and
// surface later as something less explicable.

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'bad_request', 'Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ApiError(400, 'bad_request', `Missing "${field}".`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError(400, 'bad_request', `Missing "${field}".`);
  }
  return value;
}

function asStringRecord(value: unknown): Record<string, string> {
  const object = asObject(value);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(object)) {
    if (typeof entry !== 'string') {
      throw new ApiError(400, 'bad_request', `State values must be strings; "${key}" is not.`);
    }
    result[key] = entry;
  }
  return result;
}

/**
 * Validate an uploaded sitting.
 *
 * Sittings are the one thing the server stores in a shape it understands, so it
 * is the one thing it has to check. Counts are clamped to non-negative integers
 * and recalled cannot exceed reviewed — not because a client would send that
 * deliberately, but because an account screen reporting 130% accuracy is a bug
 * report nobody can act on months later.
 */
function asStudySession(value: unknown): StudySessionRecord {
  const object = asObject(value);
  const reviewed = Math.max(0, Math.trunc(asNumber(object.reviewed, 'reviewed')));
  const recalled = Math.min(reviewed, Math.max(0, Math.trunc(asNumber(object.recalled, 'recalled'))));

  return {
    id: asString(object.id, 'id'),
    languageCode: asString(object.languageCode, 'languageCode') as StudySessionRecord['languageCode'],
    startedAt: asString(object.startedAt, 'startedAt'),
    endedAt: asString(object.endedAt, 'endedAt'),
    reviewed,
    recalled,
    activeMs: Math.max(0, Math.trunc(asNumber(object.activeMs, 'activeMs'))),
    ...(optionalString(object.device) ? { device: optionalString(object.device) } : {}),
    ...(object.derived === true ? { derived: true } : {}),
  };
}
