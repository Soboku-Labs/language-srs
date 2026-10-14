import { Code, ConnectError, createClient, type Transport } from '@connectrpc/connect';
import {
  AuthError,
  type Account,
  type AuthProvider,
  type AuthSession,
  type Credentials,
} from '@mon/core';
import * as pb from './gen/mon/v1/mon_pb';

/**
 * The email provider, over Connect.
 *
 * `@mon/core` already defines the `AuthProvider` port and a `HttpAuthProvider`
 * that speaks the hand-rolled JSON routes. This is the same port over the
 * contract instead, so an app gains the RPC backend by swapping one provider
 * rather than by changing how it signs anybody in.
 *
 * It lives here and not in the core because the core must not depend on a
 * transport. That rule is why the port exists at all.
 */
export class ConnectAuthProvider implements AuthProvider {
  readonly id = 'email' as const;
  readonly label = 'Email and password';
  readonly requiresNetwork = true;

  private readonly client: ReturnType<typeof createClient<typeof pb.AuthService>>;

  constructor(transport: Transport) {
    this.client = createClient(pb.AuthService, transport);
  }

  async signIn(credentials?: Credentials): Promise<AuthSession> {
    if (!credentials) throw new AuthError('invalid-credentials', 'Email and password required.');

    return toSession(
      await this.call(() =>
        this.client.signIn({ email: credentials.email, password: credentials.password }),
      ),
    );
  }

  async register(credentials: Credentials): Promise<AuthSession> {
    return toSession(
      await this.call(() =>
        this.client.register({
          email: credentials.email,
          password: credentials.password,
          ...(credentials.displayName ? { displayName: credentials.displayName } : {}),
        }),
      ),
    );
  }

  async signOut(_session: AuthSession): Promise<void> {
    /*
     * Deliberately not awaited for its result, and deliberately not fatal.
     *
     * Signing out locally must work with no network — a learner on a plane
     * handing their phone to someone else cannot be told to wait for a server.
     * The token is revoked when the request lands; if it never lands, it expires
     * on its own.
     */
    try {
      await this.client.signOut({});
    } catch {
      // Nothing to report: the local session is already gone.
    }
  }

  async refresh(session: AuthSession): Promise<AuthSession> {
    if (!session.refreshToken) throw new AuthError('expired', 'Nothing to refresh with.');
    return toSession(await this.call(() => this.client.refresh({ refreshToken: session.refreshToken! })));
  }

  /**
   * Translate Connect codes into the port's codes.
   *
   * The screen branches on these to decide where to put the message — "that
   * password is wrong" belongs under the password field, "you are offline"
   * belongs nowhere near it — so collapsing them all to one error would make the
   * sign-in screen worse in a way no test would catch.
   */
  private async call<T>(send: () => Promise<T>): Promise<T> {
    try {
      return await send();
    } catch (cause) {
      const error = ConnectError.from(cause);
      throw new AuthError(codeFor(error), error.rawMessage || error.message);
    }
  }
}

function codeFor(error: ConnectError) {
  switch (error.code) {
    case Code.Unauthenticated:
      return 'invalid-credentials' as const;
    case Code.AlreadyExists:
      return 'email-taken' as const;
    case Code.InvalidArgument:
      /*
       * One Connect code, two things to say.
       *
       * The backend refuses a weak password and a malformed address with the
       * same code — `invalid_argument` is correct for both — but the screen has
       * to put them in different places. The message is the only thing left to
       * tell them apart, which is unlovely and is still better than inventing a
       * code the contract does not have.
       */
      return /password/i.test(error.rawMessage) ? ('weak-password' as const) : ('invalid-email' as const);
    case Code.Unavailable:
    case Code.DeadlineExceeded:
    case Code.Unknown:
      return 'network' as const;
    default:
      return 'server' as const;
  }
}

function toSession(response: {
  session?: { account?: pb.Account; token: string; refreshToken: string; expiresAt: string };
}): AuthSession {
  const session = response.session;
  if (!session?.account) throw new AuthError('server', 'The server returned no session.');

  const account: Account = {
    id: session.account.id,
    provider: 'email',
    displayName: session.account.displayName,
    ...(session.account.email ? { email: session.account.email } : {}),
    createdAt: session.account.createdAt,
  };

  return {
    account,
    token: session.token,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };
}
