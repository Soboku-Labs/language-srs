import type { Timestamp } from '../types/card';

/**
 * Accounts.
 *
 * The app works without one and always will: an SRS whose reviews stop because a
 * token expired on a train is a worse product than one with no accounts at all.
 * So signing in is additive — it names the learner, separates two people sharing a
 * device, and gives a future sync layer an identity to attach progress to. It is
 * not a gate in front of studying.
 *
 * Two providers ship. `device` is a local profile with no server and no
 * credential, and says so plainly rather than implying a security property it
 * does not have. `email` talks to a backend over the port below, and is offered
 * only when one is configured — an app that shows a password field with nothing
 * behind it is lying to the person typing into it.
 */

export type AuthProviderId = 'device' | 'email';

export interface Account {
  id: string;
  provider: AuthProviderId;
  displayName: string;
  email?: string;
  createdAt: Timestamp;
}

export interface AuthSession {
  account: Account;
  /** Bearer token for a remote provider. Absent for the device account. */
  token?: string;
  /** When the token stops being accepted, if the provider says. */
  expiresAt?: Timestamp;
  /** Presented to the provider to obtain a new token. */
  refreshToken?: string;
}

export interface Credentials {
  email: string;
  password: string;
  /** Only read when registering. */
  displayName?: string;
}

/**
 * Why a sign-in failed, in terms the UI can act on.
 *
 * A code rather than a message, because the screen decides what to say and where
 * to say it — "that password is wrong" belongs under the password field, and
 * "you are offline" belongs nowhere near it.
 */
export type AuthErrorCode =
  | 'invalid-credentials'
  | 'email-taken'
  | 'weak-password'
  | 'invalid-email'
  | 'not-configured'
  | 'network'
  | 'server'
  | 'expired';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AuthError';
  }
}

export interface AuthProvider {
  readonly id: AuthProviderId;
  /** Shown on the sign-in screen. */
  readonly label: string;
  /** False for the device account, which is why it still works on a plane. */
  readonly requiresNetwork: boolean;
  signIn(credentials?: Credentials): Promise<AuthSession>;
  register?(credentials: Credentials): Promise<AuthSession>;
  signOut?(session: AuthSession): Promise<void>;
  /** Exchange a refresh token for a fresh session. */
  refresh?(session: AuthSession): Promise<AuthSession>;
}

/**
 * Where an account's data lives.
 *
 * The device account keeps the unprefixed keys deliberately: it is the account a
 * learner already has, and moving its keys on first launch after this feature
 * shipped would have read to them as their progress being deleted.
 */
export function storagePrefixFor(account: Account | undefined): string {
  if (!account || account.provider === 'device') return '';
  return `acct:${account.id}:`;
}
