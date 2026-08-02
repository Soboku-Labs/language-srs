import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing.
 *
 * scrypt, from Node's standard library. Chosen over bcrypt and argon2 because
 * both of those are native add-ons — a compiler on the deployment host and a
 * rebuild on every Node upgrade, in exchange for a difference that does not
 * matter at this scale. scrypt is memory-hard, which is the property that costs
 * an attacker with a GPU something.
 *
 * The cost parameters travel *inside* the stored hash rather than living in a
 * constant. That is what makes raising them possible later: an old hash still
 * carries the parameters it was made with, so existing accounts keep working
 * while new ones get the higher cost, and a verified login can be transparently
 * re-hashed. A hard-coded cost means the day you raise it, everyone is locked
 * out.
 */
const CURRENT = {
  /** CPU/memory cost. 2^14 keeps a sign-in around 50ms and uses ~16MB. */
  N: 16_384,
  r: 8,
  p: 1,
  keyLength: 64,
  saltBytes: 16,
} as const;

/**
 * Node's default `maxmem` is 32MB, which is under what these parameters need
 * once the implementation's own overhead is counted. Stated rather than left to
 * a default that would make `scrypt` throw only for some parameter choices.
 */
const MAX_MEMORY = 64 * 1024 * 1024;

/** `scrypt$N$r$p$salt$hash`, all base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(CURRENT.saltBytes);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, CURRENT.keyLength, {
    N: CURRENT.N,
    r: CURRENT.r,
    p: CURRENT.p,
    maxmem: MAX_MEMORY,
  });

  return [
    'scrypt',
    CURRENT.N,
    CURRENT.r,
    CURRENT.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Check a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt row should
 * fail one sign-in, not take the process down.
 *
 * The comparison is `timingSafeEqual`. Password verification is less obviously
 * timing-sensitive than token comparison — the attacker has to get through
 * scrypt for each guess — but the cost of doing it right is one function call.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, 'base64url');
    expected = Buffer.from(parts[5]!, 'base64url');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEMORY,
    });
  } catch {
    // Parameters outside what this build will run — a hash from a future version
    // of the server, or a doctored row.
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * A hash of nothing, for the no-such-user branch of sign-in.
 *
 * Without it, "no account with that email" returns in a millisecond and "wrong
 * password" takes fifty, which turns the sign-in form into an oracle for which
 * email addresses have accounts. Verifying against this makes both paths cost
 * the same.
 */
let decoyHash: Promise<string> | undefined;

export function decoyPasswordHash(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  return decoyHash;
}
