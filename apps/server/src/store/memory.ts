import type { AccountState, LanguageSettings, StudySessionRecord, UserSettings } from '@language-srs/core';
import type { ServerStore, SessionRecord, UserRecord } from './types.ts';

/**
 * The store tests run against, and the one the server falls back to when no
 * data directory is configured.
 *
 * Everything is copied on the way in and out. An in-memory store that hands back
 * live references passes tests that a real database would fail, because a caller
 * mutating what it was given would be invisible here and impossible there.
 */
export class MemoryServerStore implements ServerStore {
  private readonly users = new Map<string, UserRecord>();
  private readonly usersByEmail = new Map<string, string>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionsByToken = new Map<string, string>();
  private readonly state = new Map<string, AccountState>();
  private readonly studySessions = new Map<string, StudySessionRecord[]>();
  private readonly userSettings = new Map<string, UserSettings>();
  /** Keyed by `${userId}:${languageCode}`, which is the natural primary key. */
  private readonly languageSettings = new Map<string, LanguageSettings>();

  async createUser(user: UserRecord): Promise<void> {
    this.users.set(user.id, { ...user });
    this.usersByEmail.set(user.email, user.id);
  }

  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const id = this.usersByEmail.get(email);
    return id ? this.findUserById(id) : undefined;
  }

  async findUserById(id: string): Promise<UserRecord | undefined> {
    const user = this.users.get(id);
    return user ? { ...user } : undefined;
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, { ...session });
    this.sessionsByToken.set(session.tokenHash, session.id);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
    const id = this.sessionsByToken.get(tokenHash);
    const session = id ? this.sessions.get(id) : undefined;
    return session ? { ...session } : undefined;
  }

  async updateSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async deleteSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    this.sessionsByToken.delete(session.tokenHash);
  }

  async deleteSessionsForUser(userId: string, exceptId?: string): Promise<number> {
    let removed = 0;
    for (const session of [...this.sessions.values()]) {
      if (session.userId !== userId || session.id === exceptId) continue;
      await this.deleteSession(session.id);
      removed += 1;
    }
    return removed;
  }

  async listSessionsForUser(userId: string): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .map((session) => ({ ...session }))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async getState(userId: string): Promise<AccountState | undefined> {
    const state = this.state.get(userId);
    return state ? { ...state, values: { ...state.values } } : undefined;
  }

  async putState(userId: string, state: AccountState): Promise<void> {
    this.state.set(userId, { ...state, values: { ...state.values } });
  }

  async listStudySessions(userId: string): Promise<StudySessionRecord[]> {
    return (this.studySessions.get(userId) ?? []).map((record) => ({ ...record }));
  }

  async putStudySessions(userId: string, records: StudySessionRecord[]): Promise<void> {
    this.studySessions.set(
      userId,
      records.map((record) => ({ ...record })),
    );
  }

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const found = this.userSettings.get(userId);
    return found ? { ...found } : undefined;
  }

  async putUserSettings(userId: string, settings: UserSettings): Promise<void> {
    this.userSettings.set(userId, { ...settings });
  }

  async listLanguageSettings(userId: string): Promise<LanguageSettings[]> {
    return [...this.languageSettings.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([, value]) => ({ ...value }));
  }

  async getLanguageSettings(userId: string, code: string): Promise<LanguageSettings | undefined> {
    const found = this.languageSettings.get(`${userId}:${code}`);
    return found ? { ...found } : undefined;
  }

  async putLanguageSettings(userId: string, settings: LanguageSettings): Promise<void> {
    this.languageSettings.set(`${userId}:${settings.languageCode}`, { ...settings });
  }
}
