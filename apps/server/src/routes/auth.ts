import type { Accounts } from '../accounts.ts';
import { HttpError } from '../app.ts';

/**
 * Authentication.
 *
 * The paths and the response shape match `HttpAuthProvider` in
 * `@language-srs/core` exactly — that client was written against this contract
 * before a server existed, so this is the other half of it rather than a new
 * design.
 */
export function authRoutes(accounts: Accounts) {
  const routes: Record<
    string,
    (body: unknown, token: string | undefined) => Promise<[number, unknown]>
  > = {
    'POST /auth/register': async (body) => {
      const input = expect(body, ['email', 'password']);
      const session = await accounts.register({
        email: String(input.email),
        password: String(input.password),
        ...(input.displayName ? { displayName: String(input.displayName) } : {}),
      });
      return [201, session];
    },

    'POST /auth/sign-in': async (body) => {
      const input = expect(body, ['email', 'password']);
      return [200, await accounts.signIn({ email: String(input.email), password: String(input.password) })];
    },

    'POST /auth/refresh': async (body) => {
      const input = expect(body, ['refreshToken']);
      return [200, await accounts.refresh(String(input.refreshToken))];
    },

    'POST /auth/sign-out': async (_body, token) => {
      if (token) await accounts.signOut(token);
      // Always 204. Telling an unauthenticated caller whether a token was real
      // is a way to test tokens.
      return [204, undefined];
    },
  };

  return routes;
}

function expect(body: unknown, fields: string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, 'invalid-body', 'Expected a JSON object.');
  }
  const record = body as Record<string, unknown>;
  for (const field of fields) {
    if (record[field] === undefined || record[field] === '') {
      throw new HttpError(400, 'invalid-body', `Missing ${field}.`);
    }
  }
  return record;
}
