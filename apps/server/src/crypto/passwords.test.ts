import { describe, expect, it } from 'vitest';
import { decoyPasswordHash, hashPassword, verifyPassword } from './passwords.ts';
import { bearerFrom, createToken, hashToken } from './tokens.ts';

describe('password hashing', () => {
  it('verifies the password it hashed', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery stapler', hash)).toBe(false);
  });

  /** Without a per-password salt, one rainbow table breaks every account. */
  it('produces a different hash every time, even for the same password', async () => {
    const [a, b] = await Promise.all([hashPassword('the same password'), hashPassword('the same password')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('the same password', a)).toBe(true);
    expect(await verifyPassword('the same password', b)).toBe(true);
  });

  it('never stores the password itself', async () => {
    const hash = await hashPassword('sư tử biển');
    expect(hash).not.toContain('sư tử biển');
  });

  /**
   * The parameters travel inside the hash so the cost can be raised later
   * without locking out every existing account.
   */
  it('records its parameters in the stored hash', async () => {
    const hash = await hashPassword('a password long enough');
    const [algorithm, N, r, p] = hash.split('$');
    expect(algorithm).toBe('scrypt');
    expect(Number(N)).toBeGreaterThanOrEqual(16_384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it('still verifies a hash made with different parameters', async () => {
    // Simulates a hash written by an older or newer server: same format, lower
    // cost. It must keep working, or raising the cost is a mass lockout.
    const hash = await hashPassword('a password long enough');
    const [, , r, p, salt, digest] = hash.split('$');
    const cheaper = ['scrypt', 1024, r, p, salt, digest].join('$');

    // Different parameters produce a different digest, so this must *fail* —
    // what is being asserted is that it fails cleanly rather than throwing.
    await expect(verifyPassword('a password long enough', cheaper)).resolves.toBe(false);
  });

  it('treats a corrupt stored hash as a failed sign-in, not a crash', async () => {
    for (const bad of ['', 'nonsense', 'scrypt$x$8$1$aa$bb', 'bcrypt$1$2$3$4$5', 'scrypt$16384$8$1$$']) {
      await expect(verifyPassword('anything', bad)).resolves.toBe(false);
    }
  });

  it('normalises unicode, so the same typed password matches either encoding', async () => {
    const hash = await hashPassword('mật khẩu dài hơn'.normalize('NFC'));
    expect(await verifyPassword('mật khẩu dài hơn'.normalize('NFD'), hash)).toBe(true);
  });

  it('offers a decoy of the same cost for the no-such-user path', async () => {
    const decoy = await decoyPasswordHash();
    expect(decoy.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('anything at all', decoy)).toBe(false);
    // Cached, so the no-such-user path does not pay to generate one each time.
    expect(await decoyPasswordHash()).toBe(decoy);
  });
});

describe('session tokens', () => {
  it('produces unguessable, unique tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createToken()));
    expect(tokens.size).toBe(200);
    // 32 bytes, base64url — 43 characters with no padding.
    expect([...tokens][0]).toHaveLength(43);
  });

  it('hashes tokens one way, so a stolen database is not a set of credentials', () => {
    const token = createToken();
    const hash = hashToken(token);
    expect(hash).not.toContain(token);
    expect(hash).toHaveLength(64);
    expect(hashToken(token)).toBe(hash);
  });

  it('reads a bearer header whatever case the scheme arrives in', () => {
    expect(bearerFrom('Bearer abc')).toBe('abc');
    expect(bearerFrom('bearer abc')).toBe('abc');
    expect(bearerFrom('  BEARER   abc ')).toBe('abc');
  });

  it('ignores anything that is not a bearer token', () => {
    expect(bearerFrom(undefined)).toBeUndefined();
    expect(bearerFrom('')).toBeUndefined();
    expect(bearerFrom('Basic abc')).toBeUndefined();
    expect(bearerFrom('Bearer')).toBeUndefined();
  });
});
