import {
  AuthError,
  type Account,
  type AuthProvider,
  type AuthSession,
  type Credentials,
} from './types';

/**
 * Email and password against a backend.
 *
 * There is no backend yet. This is the client for one, written against a small
 * and ordinary contract, and it is constructed only when a base URL is
 * configured — see `EXPO_PUBLIC_AUTH_URL` in the app. With nothing configured the
 * sign-in screen says the option is unavailable instead of showing a password
 * field with nothing behind it.
 *
 * Expected endpoints, all JSON:
 *
 *   POST {baseUrl}/sign-in   {email, password}                -> AuthSessionBody
 *   POST {baseUrl}/register  {email, password, displayName?}  -> AuthSessionBody
 *   POST {baseUrl}/refresh   {refreshToken}                   -> AuthSessionBody
 *   POST {baseUrl}/sign-out  Authorization: Bearer <token>    -> 204
 *
 * where AuthSessionBody is `{ account: {...}, token, refreshToken?, expiresAt? }`.
 */

interface AuthSessionBody {
  account?: Partial<Account> & { id?: string };
  token?: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface HttpAuthOptions {
  baseUrl: string;
  /** Injectable for tests and for platforms with a non-global fetch. */
  fetch?: typeof fetch;
  /** Abandon a request after this long. Defaults to 15 seconds. */
  timeoutMs?: number;
}

export class HttpAuthProvider implements AuthProvider {
  readonly id = 'email' as const;
  readonly label = 'Sign in with email';
  readonly requiresNetwork = true;

  private readonly baseUrl: string;

  constructor(private readonly options: HttpAuthOptions) {
    // Trailing slashes are the classic way to end up requesting `//sign-in`.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async signIn(credentials?: Credentials): Promise<AuthSession> {
    if (!credentials) throw new AuthError('invalid-credentials', 'Email and password are required.');
    assertEmail(credentials.email);
    return this.post('/sign-in', { email: credentials.email.trim(), password: credentials.password });
  }

  async register(credentials: Credentials): Promise<AuthSession> {
    assertEmail(credentials.email);
    // Checked here as well as by the server so the message arrives before a round
    // trip, and so an unconfigured server cannot be the only thing enforcing it.
    if (credentials.password.length < 8) {
      throw new AuthError('weak-password', 'Use at least 8 characters.');
    }
    return this.post('/register', {
      email: credentials.email.trim(),
      password: credentials.password,
      ...(credentials.displayName ? { displayName: credentials.displayName.trim() } : {}),
    });
  }

  async refresh(session: AuthSession): Promise<AuthSession> {
    if (!session.refreshToken) throw new AuthError('expired', 'Sign in again.');
    return this.post('/refresh', { refreshToken: session.refreshToken });
  }

  /**
   * Sign out.
   *
   * Failures are swallowed. The local session is dropped by the caller either
   * way, and a learner who taps "sign out" on a train has signed out as far as
   * they are concerned — refusing because the server was unreachable would leave
   * them looking at someone else's deck.
   */
  async signOut(session: AuthSession): Promise<void> {
    if (!session.token) return;
    try {
      await this.request('/sign-out', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      });
    } catch {
      // Intentionally ignored — see above.
    }
  }

  private async post(path: string, body: unknown): Promise<AuthSession> {
    const response = await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw errorForStatus(response.status, await safeJson(response));

    const parsed = (await safeJson(response)) as AuthSessionBody | undefined;
    return toSession(parsed);
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const doFetch = this.options.fetch ?? globalThis.fetch;
    if (!doFetch) throw new AuthError('not-configured', 'No fetch implementation available.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);

    try {
      return await doFetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (cause) {
      // Everything that never reached the server looks the same to the learner,
      // and "check your connection" is the only useful thing to say about it.
      throw new AuthError('network', 'Could not reach the server.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

function assertEmail(email: string): void {
  // Deliberately loose. Strict email validation rejects addresses that work, and
  // the server is the only thing that actually knows whether one is deliverable.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new AuthError('invalid-email', 'That does not look like an email address.');
  }
}

function errorForStatus(status: number, body: unknown): AuthError {
  const code = (body as { code?: string } | undefined)?.code;
  const message = (body as { message?: string } | undefined)?.message;

  if (code === 'email-taken' || status === 409) return new AuthError('email-taken', message);
  if (status === 401 || status === 403) return new AuthError('invalid-credentials', message);
  if (status === 422 || status === 400) return new AuthError('weak-password', message);
  return new AuthError('server', message ?? `Server returned ${status}.`);
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Turn a response body into a session.
 *
 * Validated rather than cast. A malformed body from a server that is meant to be
 * ours is still untrusted input, and an account with no id would corrupt the
 * storage namespace — which is the thing keeping two learners' decks apart.
 */
function toSession(body: AuthSessionBody | undefined): AuthSession {
  const id = body?.account?.id;
  const token = body?.token;
  if (!id || !token) throw new AuthError('server', 'The server sent an unusable response.');

  const account: Account = {
    id,
    provider: 'email',
    displayName: body?.account?.displayName?.trim() || body?.account?.email || 'Account',
    ...(body?.account?.email ? { email: body.account.email } : {}),
    createdAt: body?.account?.createdAt ?? new Date().toISOString(),
  };

  return {
    account,
    token,
    ...(body?.refreshToken ? { refreshToken: body.refreshToken } : {}),
    ...(body?.expiresAt ? { expiresAt: body.expiresAt } : {}),
  };
}
