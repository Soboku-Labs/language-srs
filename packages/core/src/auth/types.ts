import type { Timestamp } from '../types/card';

/**
 * The contract between the app and its API.
 *
 * These types are in core rather than in either side of the wire because they
 * *are* the wire. The server validates a password against `validatePassword` and
 * the sign-up form shows the rule from the same function — so a rule can never be
 * enforced in one place and described differently in the other, which is how
 * "password too weak" ends up appearing after the learner has already been told
 * their password is fine.
 *
 * Nothing here does any IO. The server implements it over HTTP and a store; the
 * app calls it through `ApiClient`; tests call it directly.
 */

export type UserId = string;

/** A user as anyone other than the database is allowed to see them. */
export interface PublicUser {
  id: UserId;
  email: string;
  displayName: string;
  createdAt: Timestamp;
}

/**
 * One signed-in device.
 *
 * Returned by `GET /auth/sessions` so the account screen can show where the
 * account is signed in and revoke any of them. The token itself never appears
 * here — not even the current one — because a list endpoint that hands back
 * credentials turns one leaked response into every device compromised.
 */
export interface AuthSessionInfo {
  id: string;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  expiresAt: Timestamp;
  /** Free-text device label supplied at sign-in, e.g. "iPhone" or "web". */
  device: string;
  /** True for the session making the request. */
  current: boolean;
}

/** What a successful sign-up or sign-in returns. */
export interface AuthResult {
  user: PublicUser;
  /** Bearer token. Held by the client, never logged, never listed back. */
  token: string;
  expiresAt: Timestamp;
}

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_taken'
  | 'invalid_email'
  | 'weak_password'
  | 'unauthorized'
  | 'rate_limited'
  | 'conflict'
  | 'not_found'
  | 'payload_too_large'
  | 'bad_request'
  | 'server_error';

export interface ApiErrorBody {
  error: AuthErrorCode;
  message: string;
}

export const PASSWORD_MIN_LENGTH = 10;

/**
 * Upper bound on password length.
 *
 * Not a strength rule — a hashing function that is deliberately slow is a
 * denial-of-service surface if it can be handed a megabyte of input.
 */
export const PASSWORD_MAX_LENGTH = 200;

export const SESSION_TTL_DAYS = 30;

/** Lower-cased and trimmed, which is how emails are compared and stored. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether an email is usable, and why not if it is not.
 *
 * Deliberately permissive. The exhaustive RFC 5322 pattern rejects addresses that
 * work and accepts ones that do not; the only check that proves an address is
 * real is sending mail to it. This catches the typo class — no @, no dot, spaces
 * — and lets the rest through.
 */
export function validateEmail(email: string): string | undefined {
  const value = normaliseEmail(email);
  if (value.length === 0) return 'Enter an email address.';
  if (value.length > 254) return 'That email address is too long.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'That does not look like an email address.';
  return undefined;
}

/**
 * Whether a password is acceptable, and why not if it is not.
 *
 * Length, and nothing else. Composition rules — a digit, a symbol, a capital —
 * are known to push people towards `Password1!` and are not in any current
 * guidance; length is the property that actually costs an attacker anything.
 */
export function validatePassword(password: string, email?: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Keep it under ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (password.trim().length === 0) return 'A password of spaces is not a password.';
  if (email && normaliseEmail(password) === normaliseEmail(email)) {
    return 'Your password cannot be your email address.';
  }
  return undefined;
}

/** A display name, defaulted from the email when the learner does not give one. */
export function resolveDisplayName(displayName: string | undefined, email: string): string {
  const trimmed = (displayName ?? '').trim();
  if (trimmed.length > 0) return trimmed.slice(0, 60);
  const local = normaliseEmail(email).split('@')[0] ?? 'learner';
  return local.slice(0, 60);
}
