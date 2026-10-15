import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AccountState, LanguageSettings, UserSettings, StudySessionRecord } from '@language-srs/core';
import type { ServerStore, SessionRecord, UserRecord } from './types.ts';

interface FileShape {
  version: number;
  users: UserRecord[];
  sessions: SessionRecord[];
  state: Record<string, AccountState>;
  studySessions: Record<string, StudySessionRecord[]>;
  /** Keyed by user id. */
  userSettings: Record<string, UserSettings>;
  /** Keyed by `${userId}:${languageCode}`. */
  languageSettings: Record<string, LanguageSettings>;
}

const EMPTY: FileShape = {
  version: 1,
  users: [],
  sessions: [],
  state: {},
  studySessions: {},
  userSettings: {},
  languageSettings: {},
};

/**
 * Persistence for a single-process deployment.
 *
 * The whole dataset is held in memory and the file is rewritten after each
 * change. That is the right trade at this size — an account is a few hundred
 * kilobytes and a personal deployment has a handful — and the wrong one the
 * moment there are two processes, because there is no locking between them.
 * When that day comes, `ServerStore` is the seam: write a Postgres
 * implementation and change one line in `index.ts`.
 *
 * Two things it does get right, because losing an account to a power cut is not
 * a trade anyone agreed to:
 *
 * - **Atomic writes.** Written to a temporary file and renamed over the target,
 *   so a crash mid-write leaves the previous file intact rather than a truncated
 *   one that fails to parse on the next boot.
 * - **Serialised writes.** Every write goes through one promise chain, so two
 *   concurrent requests cannot interleave and produce a file containing half of
 *   each.
 */
export class JsonFileServerStore implements ServerStore {
  private data: FileShape = structuredClone(EMPTY);
  private writing: Promise<void> = Promise.resolve();
  private readonly temporaryPath: string;

  private constructor(private readonly path: string) {
    this.temporaryPath = `${path}.tmp`;
  }

  static async open(path: string): Promise<JsonFileServerStore> {
    const store = new JsonFileServerStore(path);
    await mkdir(dirname(path), { recursive: true });

    try {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<FileShape>;
      // EMPTY first, so a file written before settings existed gains the two
      // new maps rather than arriving with them undefined.
      store.data = { ...structuredClone(EMPTY), ...parsed };
    } catch (error) {
      // A missing file is a first run. Anything else — a truncated or corrupt
      // file — must stop the server rather than silently starting with no
      // accounts and overwriting the file that still holds them.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Could not read ${path}: ${(error as Error).message}`);
      }
    }

    /**
     * Prove the directory is writable before accepting traffic.
     *
     * Found by deploying it: a container running as an unprivileged user with a
     * volume mounted root-owned starts perfectly, answers the health check, and
     * then fails on the first sign-up with a 500. A server that cannot store an
     * account is not healthy, and the honest place to say so is startup — where
     * a deployment log will show it — rather than in a stranger's face.
     */
    try {
      await store.flush();
    } catch (error) {
      throw new Error(
        `Could not write ${path}: ${(error as Error).message}. ` +
          'Check that DATA_DIR exists and is writable by the user this process runs as.',
      );
    }

    return store;
  }

  /** Where the data file lives for a given directory. */
  static pathFor(directory: string): string {
    return join(directory, 'accounts.json');
  }

  private flush(): Promise<void> {
    const snapshot = JSON.stringify(this.data);
    this.writing = this.writing.then(async () => {
      await writeFile(this.temporaryPath, snapshot, 'utf8');
      await rename(this.temporaryPath, this.path);
    });
    return this.writing;
  }

  async createUser(user: UserRecord): Promise<void> {
    this.data.users.push({ ...user });
    await this.flush();
  }

  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const user = this.data.users.find((candidate) => candidate.email === email);
    return user ? { ...user } : undefined;
  }

  async findUserById(id: string): Promise<UserRecord | undefined> {
    const user = this.data.users.find((candidate) => candidate.id === id);
    return user ? { ...user } : undefined;
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.data.sessions.push({ ...session });
    await this.flush();
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
    const session = this.data.sessions.find((candidate) => candidate.tokenHash === tokenHash);
    return session ? { ...session } : undefined;
  }

  async updateSession(session: SessionRecord): Promise<void> {
    const index = this.data.sessions.findIndex((candidate) => candidate.id === session.id);
    if (index === -1) return;
    this.data.sessions[index] = { ...session };
    await this.flush();
  }

  async deleteSession(id: string): Promise<void> {
    this.data.sessions = this.data.sessions.filter((session) => session.id !== id);
    await this.flush();
  }

  async deleteSessionsForUser(userId: string, exceptId?: string): Promise<number> {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter(
      (session) => session.userId !== userId || session.id === exceptId,
    );
    await this.flush();
    return before - this.data.sessions.length;
  }

  async listSessionsForUser(userId: string): Promise<SessionRecord[]> {
    return this.data.sessions
      .filter((session) => session.userId === userId)
      .map((session) => ({ ...session }))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async getState(userId: string): Promise<AccountState | undefined> {
    const state = this.data.state[userId];
    return state ? { ...state, values: { ...state.values } } : undefined;
  }

  async putState(userId: string, state: AccountState): Promise<void> {
    this.data.state[userId] = { ...state, values: { ...state.values } };
    await this.flush();
  }

  async listStudySessions(userId: string): Promise<StudySessionRecord[]> {
    return (this.data.studySessions[userId] ?? []).map((record) => ({ ...record }));
  }

  async putStudySessions(userId: string, records: StudySessionRecord[]): Promise<void> {
    this.data.studySessions[userId] = records.map((record) => ({ ...record }));
    await this.flush();
  }

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const found = this.data.userSettings[userId];
    return found ? structuredClone(found) : undefined;
  }

  async putUserSettings(userId: string, settings: UserSettings): Promise<void> {
    this.data.userSettings[userId] = structuredClone(settings);
    await this.flush();
  }

  async listLanguageSettings(userId: string): Promise<LanguageSettings[]> {
    return Object.entries(this.data.languageSettings)
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([, value]) => structuredClone(value));
  }

  async getLanguageSettings(userId: string, code: string): Promise<LanguageSettings | undefined> {
    const found = this.data.languageSettings[`${userId}:${code}`];
    return found ? structuredClone(found) : undefined;
  }

  async putLanguageSettings(userId: string, settings: LanguageSettings): Promise<void> {
    this.data.languageSettings[`${userId}:${settings.languageCode}`] = structuredClone(settings);
    await this.flush();
  }
}
