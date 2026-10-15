import type { AccountState, LanguageSettings, UserSettings, StudySessionRecord, Timestamp } from '@language-srs/core';

/**
 * Everything the API needs to keep, and nothing about how.
 *
 * Two implementations ship: a Map for tests, and a JSON file for running it.
 * The interface exists so the third one — Postgres, when an account count
 * justifies it — is a file rather than a rewrite. Every method here is
 * deliberately a single round trip with no query language in it, so nothing in
 * the services above assumes anything about the storage engine.
 */
export interface ServerStore {
  createUser(user: UserRecord): Promise<void>;
  findUserByEmail(email: string): Promise<UserRecord | undefined>;
  findUserById(id: string): Promise<UserRecord | undefined>;

  createSession(session: SessionRecord): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined>;
  updateSession(session: SessionRecord): Promise<void>;
  deleteSession(id: string): Promise<void>;
  /** Sign out everywhere. `exceptId` keeps the session doing the asking. */
  deleteSessionsForUser(userId: string, exceptId?: string): Promise<number>;
  listSessionsForUser(userId: string): Promise<SessionRecord[]>;

  getState(userId: string): Promise<AccountState | undefined>;
  putState(userId: string, state: AccountState): Promise<void>;

  /*
   * Settings are stored apart from the state blob, and readably.
   *
   * The blob is the engine's own storage keys and the server must not try to
   * interpret it. Settings are the opposite: the server needs to read them to
   * answer for them, and one day to act on them. Keeping them here means a
   * preference is a row rather than a string inside a string.
   */
  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  putUserSettings(userId: string, settings: UserSettings): Promise<void>;

  listLanguageSettings(userId: string): Promise<LanguageSettings[]>;
  getLanguageSettings(userId: string, code: string): Promise<LanguageSettings | undefined>;
  putLanguageSettings(userId: string, settings: LanguageSettings): Promise<void>;

  listStudySessions(userId: string): Promise<StudySessionRecord[]>;
  putStudySessions(userId: string, records: StudySessionRecord[]): Promise<void>;
}

/**
 * A user, including the parts nobody outside this file may see.
 *
 * `passwordHash` carries its own parameters — see `crypto/passwords.ts` — so a
 * future increase in cost does not invalidate existing accounts.
 */
export interface UserRecord {
  id: string;
  /** Normalised: lower-cased and trimmed. The unique key. */
  email: string;
  displayName: string;
  createdAt: Timestamp;
  passwordHash: string;
}

/**
 * One signed-in device.
 *
 * The token itself is not here. Only its SHA-256 hash is stored, so a dump of
 * this table does not let the reader sign in as anybody — the same reason
 * passwords are hashed, applied to the credential that is used far more often.
 */
export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  expiresAt: Timestamp;
  device: string;
}
