import { Platform } from 'react-native';
import type {
  AccountState,
  ApiErrorBody,
  AuthErrorCode,
  AuthResult,
  AuthSessionInfo,
  PublicUser,
  StudySessionRecord,
  VocabularyLevel,
  VocabularyManifest,
} from '@language-srs/core';

/**
 * The app's side of the account API.
 *
 * One class, one `fetch`, no client library. Everything it sends and receives is
 * typed by `@language-srs/core`, which is also what the server validates
 * against, so a change to the contract breaks compilation on both sides at once
 * rather than at runtime on one of them.
 */

/**
 * Where the API lives.
 *
 * `EXPO_PUBLIC_API_URL` is inlined into the bundle at build time, so a hosted
 * build points at a hosted API and a local one does not need configuring. The
 * fallback is the port `npm run server` uses — on Android the emulator reaches
 * the host machine through 10.0.2.2 rather than localhost, which is the kind of
 * thing that costs an afternoon if it is not written down somewhere.
 *
 * Empty is treated as unset, not as a base URL. A CI build with the variable
 * declared but not filled in inlines an empty string, which would turn every
 * call into a relative URL against whatever host is serving the app — a 404
 * from the static site, reported to the learner as a broken sign-in.
 */
const CONFIGURED_URL = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');

export const API_URL: string =
  CONFIGURED_URL && CONFIGURED_URL.length > 0
    ? CONFIGURED_URL
    : Platform.OS === 'android'
      ? 'http://10.0.2.2:4000'
      : 'http://localhost:4000';

/** How long the second attempt waits when the first looks like a cold start. */
const WAKE_TIMEOUT_MS = 60_000;

/** A failure that carries the server's own words, so the UI can show them. */
export class ApiRequestError extends Error {
  /** Extra body the server attached — the current state, on a conflict. */
  detail?: unknown;

  constructor(
    readonly status: number,
    readonly code: AuthErrorCode | 'offline',
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /**
   * Whether retrying later might work.
   *
   * The distinction the sync loop runs on: a wrong password is not going to fix
   * itself, an unreachable server might.
   */
  get isTransient(): boolean {
    return this.code === 'offline' || this.status >= 500;
  }
}

export interface StateConflictResult {
  conflict: true;
  current: AccountState;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string = API_URL,
    private readonly timeoutMs = 10_000,
  ) {}

  // ---------------------------------------------------------------- accounts

  register(
    input: { email: string; password: string; displayName?: string; device: string },
    onWaking?: () => void,
  ): Promise<AuthResult> {
    return this.withWake(onWaking, (timeoutMs) =>
      this.request('POST', '/auth/register', { body: input, timeoutMs }),
    );
  }

  signIn(
    input: { email: string; password: string; device: string },
    onWaking?: () => void,
  ): Promise<AuthResult> {
    return this.withWake(onWaking, (timeoutMs) => this.request('POST', '/auth/login', { body: input, timeoutMs }));
  }

  me(token: string): Promise<{ user: PublicUser; sessionId: string; expiresAt: string }> {
    return this.request('GET', '/auth/me', { token });
  }

  signOut(token: string): Promise<void> {
    return this.request('POST', '/auth/logout', { token });
  }

  signOutOthers(token: string): Promise<{ revoked: number }> {
    return this.request('POST', '/auth/logout-others', { token });
  }

  listSessions(token: string): Promise<{ sessions: AuthSessionInfo[] }> {
    return this.request('GET', '/auth/sessions', { token });
  }

  revokeSession(token: string, sessionId: string): Promise<void> {
    return this.request('DELETE', `/auth/sessions/${encodeURIComponent(sessionId)}`, { token });
  }

  // ---------------------------------------------------------------- sync

  getState(token: string): Promise<AccountState> {
    return this.request('GET', '/state', { token });
  }

  /**
   * Upload state.
   *
   * A conflict is returned rather than thrown. It is an expected outcome of two
   * devices being used, not an error — the caller reconciles and carries on, and
   * making it an exception would put ordinary control flow in a catch block.
   */
  async putState(
    token: string,
    input: { baseRevision: number; device: string; values: Record<string, string> },
  ): Promise<{ revision: number; updatedAt: string } | StateConflictResult> {
    try {
      return await this.request('PUT', '/state', { token, body: input });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'conflict' && error.detail) {
        return { conflict: true, current: error.detail as AccountState };
      }
      throw error;
    }
  }

  listStudySessions(token: string): Promise<{ sessions: StudySessionRecord[] }> {
    return this.request('GET', '/study-sessions', { token });
  }

  pushStudySessions(token: string, sessions: StudySessionRecord[]): Promise<{ sessions: StudySessionRecord[] }> {
    return this.request('POST', '/study-sessions', { token, body: { sessions } });
  }

  // ---------------------------------------------------------------- vocabulary
  //
  // Unauthenticated, because the word lists are public — and cached hard by the
  // server, so the second device to ask this week gets a 304.

  getVocabularyManifest(): Promise<VocabularyManifest> {
    return this.request('GET', '/vocabulary');
  }

  getVocabularyLevel(levelId: string): Promise<VocabularyLevel> {
    // A level is half a megabyte at worst and arrives over whatever connection a
    // phone has, so it gets longer than the default.
    return this.request('GET', `/vocabulary/${encodeURIComponent(levelId)}`, { timeoutMs: 30_000 });
  }

  // ---------------------------------------------------------------- plumbing

  /**
   * Try, and if the server appears to be asleep, wait longer and try again.
   *
   * Free hosting stops the container when nothing has called it for a quarter of
   * an hour, and the request that wakes it can take the better part of a minute
   * — far past the timeout that is right for every other call. Retrying once
   * with a long window is what makes a free deployment usable; making the normal
   * timeout that long instead would mean a phone with no signal sits on a spinner
   * for a minute before admitting it is offline.
   *
   * Only sign-in and sign-up do this. They are the calls a person is waiting on,
   * and everything else happens in the background where being told to try again
   * later costs nothing.
   */
  private async withWake<T>(onWaking: (() => void) | undefined, attempt: (timeoutMs: number) => Promise<T>): Promise<T> {
    try {
      return await attempt(this.timeoutMs);
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.code !== 'offline') throw error;
      onWaking?.();
      return attempt(WAKE_TIMEOUT_MS);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    options: { token?: string; body?: unknown; timeoutMs?: number } = {},
  ): Promise<T> {
    // Without a timeout an unreachable host hangs until the platform gives up,
    // which on a phone with no signal is long enough to look like a freeze.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch {
      throw new ApiRequestError(0, 'offline', 'Could not reach the server.');
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload: unknown = text ? safeParse(text) : undefined;

    if (!response.ok) {
      const body = payload as (ApiErrorBody & { current?: unknown }) | undefined;
      const error = new ApiRequestError(
        response.status,
        body?.error ?? 'server_error',
        body?.message ?? 'Something went wrong.',
      );
      error.detail = body?.current;
      throw error;
    }

    return payload as T;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
