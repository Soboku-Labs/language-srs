import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Session tokens.
 *
 * Opaque random strings rather than JWTs, and the choice matters here. A JWT is
 * a bearer credential the server cannot take back before it expires, so
 * "sign out this device" becomes either a lie or a revocation list — which is a
 * database lookup per request, which is the thing JWTs were adopted to avoid.
 * An account screen that lists devices and revokes them is exactly what this API
 * is for, so it uses a token that can actually be revoked.
 *
 * 32 bytes from the OS CSPRNG: far past guessing, and short enough to sit in a
 * header without comment.
 */
export function createToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * What gets stored.
 *
 * Tokens are hashed at rest for the same reason passwords are: a leaked database
 * should not hand the reader a working credential for every signed-in device.
 *
 * SHA-256 with no salt and no work factor is correct *here* and would be wrong
 * for a password. A password is low-entropy and guessable, so it needs a slow
 * hash; a 256-bit random token is not guessable at all, so the only job is
 * one-wayness — and a fast hash is what lets this run on every request.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newId(): string {
  return randomUUID();
}

/**
 * The bearer token on a request, if there is one.
 *
 * Case-insensitive on the scheme, because `Bearer`, `bearer` and `BEARER` all
 * turn up and rejecting two of them produces a bug report that reads "auth
 * randomly stops working".
 */
export function bearerFrom(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer') return undefined;
  const token = rest.join('');
  return token.length > 0 ? token : undefined;
}
