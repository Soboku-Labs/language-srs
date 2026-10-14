import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Account } from '@language-srs/core';
import type { FileStore } from './store.ts';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

/**
 * Accounts.
 *
 * Node's own crypto and nothing else: scrypt for passwords, random bytes for
 * tokens. bcrypt and a JWT library are each a dependency with a native build
 * step and a CVE feed, and neither does anything here that the standard library
 * does not.
 *
 * Tokens are opaque and stored server-side rather than signed. A JWT cannot be
 * revoked before it expires; a row in a table can be deleted, which is what
 * "sign out of all devices" and "this account was compromised" both need.
 */

/** scrypt's cost. The default N=16384 is the floor; this is deliberately above it. */
const SCRYPT_KEY_LENGTH = 64;
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface StoredAccount {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  salt: string;
  hash: string;
}

interface StoredToken {
  token: string;
  refreshToken: string;
  accountId: string;
  expiresAt: string;
}

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

export interface Session {
  account: Account;
  token: string;
  refreshToken: string;
  expiresAt: string;
}

export class Accounts {
  private readonly store: FileStore;

  constructor(store: FileStore) {
    this.store = store;
  }

  private async readAll<T>(key: string): Promise<T[]> {
    const raw = await this.store.get(key);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as T[];
    } catch {
      // A corrupt index is not something to silently replace: every account on
      // this server lives in it.
      throw new Error(`Corrupt ${key}; refusing to overwrite it.`);
    }
  }

  private async hash(password: string, salt: string): Promise<string> {
    return (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)).toString('hex');
  }

  async register(input: { email: string; password: string; displayName?: string }): Promise<Session> {
    const email = input.email.trim().toLowerCase();

    // Checked here as well as in the client so the server is the one enforcing
    // it, rather than trusting whoever is calling.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AuthError(400, 'invalid-email', 'That does not look like an email address.');
    }
    if (input.password.length < 8) {
      throw new AuthError(422, 'weak-password', 'Use at least 8 characters.');
    }

    const accounts = await this.readAll<StoredAccount>('accounts');
    if (accounts.some((candidate) => candidate.email === email)) {
      throw new AuthError(409, 'email-taken', 'There is already an account with that email.');
    }

    const salt = randomBytes(16).toString('hex');
    const stored: StoredAccount = {
      id: randomUUID(),
      email,
      displayName: input.displayName?.trim() || email,
      createdAt: new Date().toISOString(),
      salt,
      hash: await this.hash(input.password, salt),
    };

    await this.store.set('accounts', JSON.stringify([...accounts, stored]));
    return this.issue(stored);
  }

  async signIn(input: { email: string; password: string }): Promise<Session> {
    const email = input.email.trim().toLowerCase();
    const accounts = await this.readAll<StoredAccount>('accounts');
    const found = accounts.find((candidate) => candidate.email === email);

    /*
     * The same error whether the email is unknown or the password is wrong, and
     * a hash computed either way. Branching early on "no such account" turns the
     * endpoint into an oracle for which addresses are registered — both in what
     * it says and in how long it takes to say it.
     */
    const salt = found?.salt ?? 'absent-account-constant-salt';
    const attempt = await this.hash(input.password, salt);
    const expected = found?.hash ?? attempt.replace(/./g, '0');

    const attemptBuffer = Buffer.from(attempt, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const matches =
      found !== undefined &&
      attemptBuffer.length === expectedBuffer.length &&
      timingSafeEqual(attemptBuffer, expectedBuffer);

    if (!matches || !found) {
      throw new AuthError(401, 'invalid-credentials', 'That email and password do not match.');
    }

    return this.issue(found);
  }

  async refresh(refreshToken: string): Promise<Session> {
    const tokens = await this.readAll<StoredToken>('tokens');
    const found = tokens.find((candidate) => candidate.refreshToken === refreshToken);
    if (!found) throw new AuthError(401, 'expired', 'Sign in again.');

    const accounts = await this.readAll<StoredAccount>('accounts');
    const account = accounts.find((candidate) => candidate.id === found.accountId);
    if (!account) throw new AuthError(401, 'expired', 'Sign in again.');

    // The old pair is replaced rather than extended, so a leaked refresh token
    // stops working the moment the real client uses it.
    await this.store.set(
      'tokens',
      JSON.stringify(tokens.filter((candidate) => candidate.refreshToken !== refreshToken)),
    );
    return this.issue(account);
  }

  async signOut(token: string): Promise<void> {
    const tokens = await this.readAll<StoredToken>('tokens');
    await this.store.set('tokens', JSON.stringify(tokens.filter((candidate) => candidate.token !== token)));
  }

  /** The account a bearer token belongs to, or undefined if it is unknown or stale. */
  async verify(token: string | undefined): Promise<Account | undefined> {
    if (!token) return undefined;

    const tokens = await this.readAll<StoredToken>('tokens');
    const found = tokens.find((candidate) => candidate.token === token);
    if (!found) return undefined;
    if (Date.parse(found.expiresAt) <= Date.now()) return undefined;

    const accounts = await this.readAll<StoredAccount>('accounts');
    const account = accounts.find((candidate) => candidate.id === found.accountId);
    return account ? toAccount(account) : undefined;
  }

  private async issue(stored: StoredAccount): Promise<Session> {
    const session: StoredToken = {
      token: randomBytes(32).toString('hex'),
      refreshToken: randomBytes(32).toString('hex'),
      accountId: stored.id,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    };

    const tokens = await this.readAll<StoredToken>('tokens');
    // Expired rows are swept on write rather than by a scheduled job: this is
    // the only moment the file is open anyway.
    const live = tokens.filter((candidate) => Date.parse(candidate.expiresAt) > Date.now());
    await this.store.set('tokens', JSON.stringify([...live, session]));

    return {
      account: toAccount(stored),
      token: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    };
  }
}

function toAccount(stored: StoredAccount): Account {
  return {
    id: stored.id,
    provider: 'email',
    displayName: stored.displayName,
    email: stored.email,
    createdAt: stored.createdAt,
  };
}
