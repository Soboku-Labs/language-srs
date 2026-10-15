import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonFileServerStore } from './json-file.ts';
import type { SessionRecord, UserRecord } from './types.ts';

const directories: string[] = [];

async function temporaryStore() {
  const directory = await mkdtemp(join(tmpdir(), 'srs-store-'));
  directories.push(directory);
  const path = JsonFileServerStore.pathFor(directory);
  return { path, store: await JsonFileServerStore.open(path) };
}

const user: UserRecord = {
  id: 'user-1',
  email: 'learner@example.com',
  displayName: 'Learner',
  createdAt: '2026-07-31T09:00:00.000Z',
  passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA',
};

const session: SessionRecord = {
  id: 'session-1',
  userId: 'user-1',
  tokenHash: 'a'.repeat(64),
  createdAt: '2026-07-31T09:00:00.000Z',
  lastSeenAt: '2026-07-31T09:00:00.000Z',
  expiresAt: '2026-08-30T09:00:00.000Z',
  device: 'iPhone',
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('the JSON file store', () => {
  it('creates its file on first write and reads it back after a restart', async () => {
    const { path, store } = await temporaryStore();
    await store.createUser(user);
    await store.createSession(session);

    const reopened = await JsonFileServerStore.open(path);
    expect(await reopened.findUserByEmail('learner@example.com')).toMatchObject({ id: 'user-1' });
    expect(await reopened.findSessionByTokenHash('a'.repeat(64))).toMatchObject({ device: 'iPhone' });
  });

  it('starts empty rather than failing when there is no file yet', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'srs-store-'));
    directories.push(directory);
    const store = await JsonFileServerStore.open(JsonFileServerStore.pathFor(directory));
    expect(await store.findUserById('nobody')).toBeUndefined();
  });

  /**
   * A truncated file must stop the server. Starting with no accounts would mean
   * the first write overwrites the file that still holds them, turning a
   * recoverable problem into a permanent one.
   */
  it('refuses to start on a corrupt file rather than overwriting it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'srs-store-'));
    directories.push(directory);
    const path = JsonFileServerStore.pathFor(directory);
    await writeFile(path, '{"users":[{"id":"user-1"', 'utf8');

    await expect(JsonFileServerStore.open(path)).rejects.toThrow(/Could not read/);
    // Still there, unread and unharmed.
    expect(await readFile(path, 'utf8')).toContain('user-1');
  });

  it('persists account state and sittings', async () => {
    const { path, store } = await temporaryStore();
    await store.putState('user-1', {
      revision: 3,
      updatedAt: '2026-07-31T09:00:00.000Z',
      device: 'iPad',
      values: { 'srs:v1:meta': '{}' },
    });
    await store.putStudySessions('user-1', [
      {
        id: 's1',
        languageCode: 'zh',
        startedAt: '2026-07-31T09:00:00.000Z',
        endedAt: '2026-07-31T09:10:00.000Z',
        reviewed: 10,
        recalled: 9,
        activeMs: 600_000,
      },
    ]);

    const reopened = await JsonFileServerStore.open(path);
    expect((await reopened.getState('user-1'))?.revision).toBe(3);
    expect(await reopened.listStudySessions('user-1')).toHaveLength(1);
  });

  it('hands back copies, so a caller cannot mutate the store by accident', async () => {
    const { store } = await temporaryStore();
    await store.createUser(user);

    const first = await store.findUserById('user-1');
    first!.displayName = 'Somebody Else';

    expect((await store.findUserById('user-1'))?.displayName).toBe('Learner');
  });

  it('survives concurrent writes without producing an unreadable file', async () => {
    const { path, store } = await temporaryStore();

    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        store.createUser({ ...user, id: `user-${index}`, email: `learner${index}@example.com` }),
      ),
    );

    const reopened = await JsonFileServerStore.open(path);
    expect(await reopened.findUserByEmail('learner24@example.com')).toBeDefined();
    expect(await reopened.findUserByEmail('learner0@example.com')).toBeDefined();
  });

  it('removes a user’s other sessions and keeps the one asking', async () => {
    const { store } = await temporaryStore();
    await store.createSession(session);
    await store.createSession({ ...session, id: 'session-2', tokenHash: 'b'.repeat(64) });
    await store.createSession({ ...session, id: 'session-3', userId: 'user-2', tokenHash: 'c'.repeat(64) });

    expect(await store.deleteSessionsForUser('user-1', 'session-1')).toBe(1);
    expect(await store.listSessionsForUser('user-1')).toHaveLength(1);
    expect(await store.listSessionsForUser('user-2')).toHaveLength(1);
  });

  /**
   * Found by deploying it. A container running as an unprivileged user with a
   * root-owned volume starts fine, passes its health check, and then fails on
   * the first sign-up. Refusing to open is how that becomes a deployment log
   * line instead of a stranger's 500.
   *
   * Skipped when the suite runs as root, because root ignores the permission
   * bits this test sets — which would make it pass by not testing anything.
   * CI runs unprivileged, so it runs there.
   */
  it.runIf(typeof process.getuid === 'function' && process.getuid?.() !== 0)(
    'refuses to open a directory it cannot write to',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'srs-store-'));
      directories.push(directory);
      await chmod(directory, 0o500);

      await expect(JsonFileServerStore.open(JsonFileServerStore.pathFor(directory))).rejects.toThrow(
        /Could not write .*writable/s,
      );

      // Restored so the temporary directory can be cleaned up afterwards.
      await chmod(directory, 0o700);
    },
  );

  it('persists settings per user and per language', async () => {
    const { path, store } = await temporaryStore();
    await store.putUserSettings('user-1', {
      appearance: 'dark',
      backdrop: 'living',
      dayStartHour: 6,
      updatedAt: '2026-07-31T09:00:00.000Z',
    });
    await store.putLanguageSettings('user-1', {
      languageCode: 'zh',
      examTrackId: 'hsk',
      targetLevelId: 'hsk-3',
      dailyNewLimit: 25,
      dailyReviewLimit: 200,
      desiredRetention: 0.92,
      updatedAt: '2026-07-31T09:00:00.000Z',
    });
    await store.putLanguageSettings('user-2', {
      languageCode: 'ja',
      examTrackId: 'jlpt',
      targetLevelId: 'jlpt-n5',
      dailyNewLimit: 5,
      dailyReviewLimit: 50,
      desiredRetention: 0.9,
      updatedAt: '2026-07-31T09:00:00.000Z',
    });

    const reopened = await JsonFileServerStore.open(path);
    expect(await reopened.getUserSettings('user-1')).toMatchObject({ appearance: 'dark' });
    expect(await reopened.getUserSettings('user-2')).toBeUndefined();
    // Keyed by user and language together, so listing one account cannot pick
    // up another's row.
    expect(await reopened.listLanguageSettings('user-1')).toHaveLength(1);
    expect(await reopened.getLanguageSettings('user-1', 'ja')).toBeUndefined();
  });

  /**
   * Settings were added after the first deployments, so a file on disk may not
   * have the two maps at all. Opening one must not leave them undefined — the
   * first `listLanguageSettings` would throw on `Object.entries(undefined)`.
   */
  it('opens a file written before settings existed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'srs-store-'));
    directories.push(directory);
    const path = JsonFileServerStore.pathFor(directory);
    await writeFile(
      path,
      JSON.stringify({ version: 1, users: [user], sessions: [], state: {}, studySessions: {} }),
      'utf8',
    );

    const store = await JsonFileServerStore.open(path);
    expect(await store.listLanguageSettings('user-1')).toEqual([]);
    expect(await store.getUserSettings('user-1')).toBeUndefined();
  });
});
