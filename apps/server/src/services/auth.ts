import {
  SESSION_TTL_DAYS,
  normaliseEmail,
  resolveDisplayName,
  validateEmail,
  validatePassword,
  type AuthResult,
  type AuthSessionInfo,
  type PublicUser,
} from '@language-srs/core';
import { decoyPasswordHash, hashPassword, verifyPassword } from '../crypto/passwords.ts';
import { createToken, hashToken, newId } from '../crypto/tokens.ts';
import { ApiError } from '../http/errors.ts';
import type { ServerStore, SessionRecord, UserRecord } from '../store/types.ts';

export interface AuthServiceOptions {
  store: ServerStore;
  /** Injected so expiry can be tested without waiting a month. */
  now?: () => Date;
  /** Failed sign-ins allowed per email before the door closes for a while. */
  maxFailedAttempts?: number;
  lockoutMinutes?: number;
}

/** Everything the API knows how to do with an account. */
export class AuthService {
  private readonly store: ServerStore;
  private readonly now: () => Date;
  private readonly maxFailedAttempts: number;
  private readonly lockoutMs: number;
  /**
   * Failed sign-ins, in memory.
   *
   * Deliberately not persisted: it is a rate limit, not a fact about the
   * account, and losing it on restart costs an attacker a restart's worth of
   * attempts rather than costing a locked-out learner their evening. Keyed by
   * email so an attacker cannot spread guesses at one account across addresses.
   */
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(options: AuthServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.maxFailedAttempts = options.maxFailedAttempts ?? 10;
    this.lockoutMs = (options.lockoutMinutes ?? 15) * 60_000;
  }

  async register(input: { email: string; password: string; displayName?: string; device?: string }): Promise<AuthResult> {
    const emailProblem = validateEmail(input.email);
    if (emailProblem) throw new ApiError(400, 'invalid_email', emailProblem);

    const passwordProblem = validatePassword(input.password, input.email);
    if (passwordProblem) throw new ApiError(400, 'weak_password', passwordProblem);

    const email = normaliseEmail(input.email);
    if (await this.store.findUserByEmail(email)) {
      // Deliberately explicit. Hiding it would only push the discovery to the
      // sign-in form, and a sign-up flow that cannot say "you already have an
      // account" is a support ticket rather than a security control.
      throw new ApiError(409, 'email_taken', 'There is already an account with that email.');
    }

    const user: UserRecord = {
      id: newId(),
      email,
      displayName: resolveDisplayName(input.displayName, email),
      createdAt: this.now().toISOString(),
      passwordHash: await hashPassword(input.password),
    };

    await this.store.createUser(user);
    return this.issueSession(user, input.device);
  }

  async signIn(input: { email: string; password: string; device?: string }): Promise<AuthResult> {
    const email = normaliseEmail(input.email);
    this.assertNotLockedOut(email);

    const user = await this.store.findUserByEmail(email);
    // Verify even when there is no such user, against a decoy of the same cost,
    // so the two paths take the same time — see `decoyPasswordHash`.
    const hash = user?.passwordHash ?? (await decoyPasswordHash());
    const ok = await verifyPassword(input.password, hash);

    if (!user || !ok) {
      this.recordFailure(email);
      throw new ApiError(401, 'invalid_credentials', 'That email and password do not match.');
    }

    this.failures.delete(email);
    return this.issueSession(user, input.device);
  }

  /**
   * Resolve a bearer token to its user and session.
   *
   * Expired sessions are deleted rather than merely rejected: a token that will
   * never work again has no reason to stay in the store, and cleaning up on the
   * attempt keeps the device list honest without a sweeper job.
   */
  async authenticate(token: string): Promise<{ user: UserRecord; session: SessionRecord }> {
    const session = await this.store.findSessionByTokenHash(hashToken(token));
    if (!session) throw new ApiError(401, 'unauthorized', 'Sign in again.');

    const nowMs = this.now().getTime();
    if (Date.parse(session.expiresAt) <= nowMs) {
      await this.store.deleteSession(session.id);
      throw new ApiError(401, 'unauthorized', 'That session has expired. Sign in again.');
    }

    const user = await this.store.findUserById(session.userId);
    if (!user) {
      await this.store.deleteSession(session.id);
      throw new ApiError(401, 'unauthorized', 'Sign in again.');
    }

    // Sliding expiry: using the app keeps you signed in, a month away does not.
    // Written back at most once an hour, because a write on every request would
    // make the store's job reading-and-writing rather than reading.
    const lastSeenMs = Date.parse(session.lastSeenAt);
    if (nowMs - lastSeenMs > 60 * 60_000) {
      const refreshed: SessionRecord = {
        ...session,
        lastSeenAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + SESSION_TTL_DAYS * 86_400_000).toISOString(),
      };
      await this.store.updateSession(refreshed);
      return { user, session: refreshed };
    }

    return { user, session };
  }

  async signOut(sessionId: string): Promise<void> {
    await this.store.deleteSession(sessionId);
  }

  /** Sign out everywhere else, keeping the device that asked. */
  async signOutOthers(userId: string, keepSessionId: string): Promise<{ revoked: number }> {
    return { revoked: await this.store.deleteSessionsForUser(userId, keepSessionId) };
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const sessions = await this.store.listSessionsForUser(userId);
    // Checked against the caller's own list rather than fetched by id, so one
    // account cannot revoke another's device by guessing an id.
    if (!sessions.some((session) => session.id === sessionId)) {
      throw new ApiError(404, 'not_found', 'No such session.');
    }
    await this.store.deleteSession(sessionId);
  }

  async listSessions(userId: string, currentSessionId: string): Promise<AuthSessionInfo[]> {
    const nowMs = this.now().getTime();
    const sessions = await this.store.listSessionsForUser(userId);

    return sessions
      .filter((session) => Date.parse(session.expiresAt) > nowMs)
      .map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        device: session.device,
        current: session.id === currentSessionId,
      }));
  }

  private async issueSession(user: UserRecord, device?: string): Promise<AuthResult> {
    const token = createToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString();

    await this.store.createSession({
      id: newId(),
      userId: user.id,
      tokenHash: hashToken(token),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt,
      device: (device ?? 'unknown device').slice(0, 60),
    });

    return { user: toPublicUser(user), token, expiresAt };
  }

  private assertNotLockedOut(email: string): void {
    const entry = this.failures.get(email);
    if (!entry) return;

    const nowMs = this.now().getTime();
    if (entry.until <= nowMs) {
      this.failures.delete(email);
      return;
    }
    if (entry.count >= this.maxFailedAttempts) {
      const minutes = Math.max(1, Math.ceil((entry.until - nowMs) / 60_000));
      throw new ApiError(429, 'rate_limited', `Too many attempts. Try again in ${minutes} minutes.`);
    }
  }

  private recordFailure(email: string): void {
    const nowMs = this.now().getTime();
    const entry = this.failures.get(email);
    if (!entry || entry.until <= nowMs) {
      this.failures.set(email, { count: 1, until: nowMs + this.lockoutMs });
      return;
    }
    entry.count += 1;
    entry.until = nowMs + this.lockoutMs;
  }
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}
