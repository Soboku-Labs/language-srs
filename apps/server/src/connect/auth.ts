import { Code, ConnectError, type HandlerContext, type ServiceImpl } from '@connectrpc/connect';
import type { Accounts } from '../accounts.ts';
import * as pb from '../gen/mon/v1/mon_pb.ts';
import { sessionToPb } from './convert.ts';
import { toConnectError } from './errors.ts';

/** The bearer token on a request, if there is one. */
export function bearerFrom(context: HandlerContext): string | undefined {
  const header = context.requestHeader.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

/**
 * AuthService over the same `Accounts` the JSON routes use.
 *
 * No logic lives here — the constant-work sign-in, the rotating refresh tokens
 * and the scrypt parameters are all in `accounts.ts`, and this is the second
 * doorway onto them. That is the point of the exercise: adding a protocol must
 * not add a second implementation of anything that matters.
 */
export function authService(accounts: Accounts): ServiceImpl<typeof pb.AuthService> {
  return {
    async register(request) {
      try {
        if (!request.email || !request.password) {
          throw new ConnectError('email and password are required.', Code.InvalidArgument);
        }
        const session = await accounts.register({
          email: request.email,
          password: request.password,
          ...(request.displayName ? { displayName: request.displayName } : {}),
        });
        return { session: sessionToPb(session) };
      } catch (cause) {
        throw toConnectError(cause, 'AuthService/Register');
      }
    },

    async signIn(request) {
      try {
        if (!request.email || !request.password) {
          throw new ConnectError('email and password are required.', Code.InvalidArgument);
        }
        const session = await accounts.signIn({ email: request.email, password: request.password });
        return { session: sessionToPb(session) };
      } catch (cause) {
        throw toConnectError(cause, 'AuthService/SignIn');
      }
    },

    async refresh(request) {
      try {
        if (!request.refreshToken) {
          throw new ConnectError('refresh_token is required.', Code.InvalidArgument);
        }
        return { session: sessionToPb(await accounts.refresh(request.refreshToken)) };
      } catch (cause) {
        throw toConnectError(cause, 'AuthService/Refresh');
      }
    },

    /**
     * Always succeeds, token or no token.
     *
     * Telling an unauthenticated caller whether the token it sent was real is a
     * way to test tokens, so sign-out reports nothing either way — the same
     * reasoning as the 204 on the JSON route.
     */
    async signOut(_request, context) {
      try {
        const token = bearerFrom(context);
        if (token) await accounts.signOut(token);
        return {};
      } catch (cause) {
        throw toConnectError(cause, 'AuthService/SignOut');
      }
    },
  };
}
