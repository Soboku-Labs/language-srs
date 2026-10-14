import { Code, ConnectError, createClient, type Client, type Transport } from '@connectrpc/connect';
import * as pb from './gen/mon/v1/mon_pb';

/**
 * The client every interface talks to the backend through.
 *
 * Deliberately thin. It attaches the bearer token, renews it once when the
 * server says it is stale, and otherwise gets out of the way — the generated
 * clients are already the API, and wrapping each of fourteen RPCs in a bespoke
 * method would be fourteen more things to keep in step with the proto.
 */

export interface TokenStore {
  /** The access token to send, or undefined when signed out. */
  get(): string | undefined;
  /** The refresh token, if there is a session to renew. */
  getRefresh(): string | undefined;
  /**
   * Called after a successful renewal, and with undefined when the session is
   * gone. Optional: an app whose own session store does the renewing (see
   * `renew`) has already persisted the result by the time this would be called.
   */
  set?(tokens: { token: string; refreshToken: string; expiresAt: string } | undefined): Promise<void>;
}

export interface MonClientOptions {
  transport: Transport;
  tokens: TokenStore;
  /**
   * Called when renewal fails and the session is over.
   *
   * Separate from `tokens.set(undefined)` because the app has to do something
   * visible about it — show the sign-in screen — and a store write is not a
   * place to put that.
   */
  onSignedOut?(): void;
  /**
   * Renew the session, instead of this client doing it.
   *
   * For an app that already has a session store with its own refresh — the web
   * app's `AuthStore` does — so that renewal happens in one place rather than
   * here as well. Returns whether there is now a usable token; `tokens.get()` is
   * read again afterwards, so the implementation just has to have stored it.
   *
   * Without it the client renews on its own, which is what a client used with no
   * surrounding session store needs.
   */
  renew?(): Promise<boolean>;
}

export interface MonClient {
  auth: Client<typeof pb.AuthService>;
  study: Client<typeof pb.StudyService>;
}

export function createMonClient(options: MonClientOptions): MonClient {
  const { tokens } = options;

  /**
   * One renewal at a time.
   *
   * A screen that fires four RPCs on mount will see four `unauthenticated`
   * replies at once. Four concurrent refreshes would rotate the refresh token
   * four times, and since rotation invalidates the previous one — which is the
   * point of rotating — three of them would fail and sign the learner out of a
   * session that was fine.
   */
  let renewing: Promise<boolean> | undefined;

  const renew = async (): Promise<boolean> => {
    // Delegated where the app owns the session, so there is one renewal path and
    // not two implementations of it drifting apart.
    if (options.renew) return options.renew();

    const refreshToken = tokens.getRefresh();
    if (!refreshToken) return false;

    try {
      const { session } = await createClient(pb.AuthService, options.transport).refresh({
        refreshToken,
      });
      if (!session?.token) return false;

      await tokens.set?.({
        token: session.token,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
      });
      return true;
    } catch {
      await tokens.set?.(undefined);
      options.onSignedOut?.();
      return false;
    }
  };

  const renewOnce = (): Promise<boolean> => {
    renewing ??= renew().finally(() => {
      renewing = undefined;
    });
    return renewing;
  };

  /**
   * Attach the token, and retry once if it was stale.
   *
   * An interceptor rather than a wrapper per method, so there is no RPC that can
   * be added without it. The retry is bounded to one attempt: if the renewed
   * token is also refused, something is wrong that retrying will not fix, and a
   * loop would hammer the server while showing the learner nothing.
   */
  const withAuth: Transport = {
    async unary(method, signal, timeoutMs, header, input, contextValues) {
      const send = () => {
        const headers = new Headers(header);
        const token = tokens.get();
        if (token) headers.set('Authorization', `Bearer ${token}`);
        return options.transport.unary(method, signal, timeoutMs, headers, input, contextValues);
      };

      try {
        return await send();
      } catch (cause) {
        const error = ConnectError.from(cause);
        if (error.code !== Code.Unauthenticated) throw error;
        if (!(await renewOnce())) throw error;
        return await send();
      }
    },

    // Nothing in this contract streams. Left delegating rather than throwing, so
    // adding a streaming RPC does not need this file changed to work — it only
    // needs it changed to retry.
    stream(method, signal, timeoutMs, header, input, contextValues) {
      const headers = new Headers(header);
      const token = tokens.get();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return options.transport.stream(method, signal, timeoutMs, headers, input, contextValues);
    },
  };

  return {
    auth: createClient(pb.AuthService, withAuth),
    study: createClient(pb.StudyService, withAuth),
  };
}

/** Whether a failure is worth retrying, or is the server saying no. */
export function isRetryable(cause: unknown): boolean {
  const code = ConnectError.from(cause).code;
  return (
    code === Code.Unavailable ||
    code === Code.DeadlineExceeded ||
    code === Code.ResourceExhausted ||
    code === Code.Aborted ||
    // An interrupted connection surfaces as Unknown, which is the single most
    // common failure a phone on a train produces.
    code === Code.Unknown
  );
}
