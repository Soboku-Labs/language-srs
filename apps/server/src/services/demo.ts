import { resolveDisplayName } from '@language-srs/core';
import { hashPassword } from '../crypto/passwords.ts';
import { newId } from '../crypto/tokens.ts';
import type { ServerStore } from '../store/types.ts';

/**
 * A throwaway account to sign in with while building.
 *
 * `admin` / `admin`, so there is something to type without registering a new
 * address every time the store is wiped.
 *
 * ## Why this is a seeded account and not a special case in sign-in
 *
 * The tempting version is two lines in `AuthService.signIn`: if the email is
 * `admin` and the password is `admin`, hand back a session. That is a
 * backdoor. It lives in the one function whose whole job is deciding who gets
 * in, it runs on every sign-in attempt in every environment, and the day
 * somebody's environment variable is wrong it is the authentication itself
 * that is wrong.
 *
 * This writes a perfectly ordinary user into the store instead. `signIn` is
 * untouched and has no idea this account is different from any other: it
 * hashes the password with the same scrypt parameters, it is subject to the
 * same lockout after failed attempts, and if it is not seeded it simply does
 * not exist, which is the correct behaviour for a credential that should not
 * be there. There is no branch to get wrong.
 *
 * ## Why it is off unless asked for, and never in production
 *
 * `admin`/`admin` is the first pair anybody tries. It is fine on a laptop and
 * indefensible on a deployment, so:
 *
 * - it does nothing unless `DEMO_LOGIN=1` is set;
 * - setting it with `NODE_ENV=production` stops the server rather than
 *   starting one with a known password, because a warning in a log is not a
 *   control — nobody reads startup logs of a server that started;
 * - when it is on, it says so on every boot, loudly enough that leaving it on
 *   by accident is hard.
 *
 * The password deliberately fails the app's own rules — `validatePassword`
 * wants ten characters — which is the other reason to seed rather than
 * register: the rules stay intact for everybody, including for this account's
 * own sign-in attempt, which is checked against a real hash like anyone's.
 */

/** The email to type. Not a valid address, which is the point: it is not one. */
export const DEMO_EMAIL = 'admin';
export const DEMO_PASSWORD = 'admin';

export function demoLoginRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEMO_LOGIN === '1';
}

/**
 * Whether turning it on here would be a mistake.
 *
 * Returns the reason, or undefined when it is safe. Separated from the seeding
 * so the entry point can refuse to start rather than seed and warn.
 */
export function demoLoginRefusal(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!demoLoginRequested(env)) return undefined;
  if (env.NODE_ENV === 'production') {
    return 'DEMO_LOGIN=1 with NODE_ENV=production would publish an account with the password "admin".';
  }
  return undefined;
}

/**
 * Create the demo account if it is not already there.
 *
 * Idempotent, and deliberately does not reset the password of an existing
 * `admin` user: if somebody has genuinely registered that address, silently
 * rewriting their credentials on every boot would be worse than not having a
 * demo login at all.
 */
export async function seedDemoAccount(
  store: ServerStore,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  const existing = await store.findUserByEmail(DEMO_EMAIL);
  if (existing) return false;

  await store.createUser({
    id: newId(),
    email: DEMO_EMAIL,
    displayName: resolveDisplayName('Admin', DEMO_EMAIL),
    createdAt: now().toISOString(),
    // The same hashing as every other account. Nothing about this user is
    // special once it is in the store, which is the whole design.
    passwordHash: await hashPassword(DEMO_PASSWORD),
  });

  return true;
}
