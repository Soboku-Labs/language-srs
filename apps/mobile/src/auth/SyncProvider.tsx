import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { readJson, writeJson, type StudySessionRecord } from '@language-srs/core';
import { useEngine } from '../engine/EngineProvider';
import { useAuth } from './AuthProvider';
import { ApiRequestError } from './client';

/**
 * Keeping an account the same on every device it is signed in on.
 *
 * The rules, stated here because they are the part that decides what a learner
 * loses when two devices disagree:
 *
 * 1. **On sign-in, the server wins if it is ahead.** A device joining an account
 *    adopts what the account already is. It does not merge its own cards in,
 *    because there is no honest way to merge two FSRS histories for the same
 *    card — one of them has to be the truth about when you last saw that word.
 * 2. **Afterwards, this device pushes.** Every change bumps a revision; writes
 *    carry the revision they were based on, so a device that has fallen behind
 *    is told rather than allowed to overwrite.
 * 3. **Sittings merge both ways, always.** They are append-only and immutable,
 *    so union is correct, and losing an evening's study to a sync rule is the
 *    one outcome worth extra code to prevent.
 *
 * Everything here is best-effort. Study works offline and always has; sync is
 * something that happens to it, not something it waits for.
 */

/** Sync bookkeeping, inside the account's own storage namespace. */
const SYNC_KEY = 'sync:v1';

interface SyncMeta {
  /** The server revision this device last agreed with. */
  revision: number;
  lastSyncedAt?: string;
}

export type SyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

interface SyncContextValue {
  state: SyncState;
  lastSyncedAt?: string;
  /** Set when the last attempt failed for a reason worth showing. */
  message?: string;
  syncNow(): Promise<void>;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

/** How long to wait after a change before pushing, so a session is one upload. */
const PUSH_DEBOUNCE_MS = 3_000;

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { token, status, user, api, deviceName } = useAuth();
  const { engine, accountId, revision, mutate } = useEngine();

  const [state, setState] = useState<SyncState>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  /** Guards against two syncs overlapping — the debounce and a manual tap. */
  const running = useRef(false);
  /** Set once the first pull for this account has completed. */
  const pulled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const readMeta = useCallback(async (): Promise<SyncMeta> => {
    return readJson<SyncMeta>(engine.store, SYNC_KEY, { revision: 0 });
  }, [engine]);

  const writeMeta = useCallback(
    async (meta: SyncMeta) => {
      await writeJson(engine.store, SYNC_KEY, meta);
      setLastSyncedAt(meta.lastSyncedAt);
    },
    [engine],
  );

  const sync = useCallback(
    async ({ initial = false }: { initial?: boolean } = {}) => {
      if (!token || running.current) return;

      /**
       * Never sync into an engine that belongs to somebody else.
       *
       * The engine is rebuilt when the account changes, and for a moment during
       * that change the signed-in user and the open engine disagree. Downloading
       * an account's cards in that moment wrote them into the signed-out
       * learner's storage — the account's whole deck appearing under "studying
       * without an account" on a device that had never studied.
       */
      if (accountId !== user?.id) return;

      running.current = true;
      setState('syncing');
      setMessage(undefined);

      try {
        const meta = await readMeta();
        const remote = await api.getState(token);

        // Rule 1: a device joining an account, or one that has fallen behind,
        // adopts what the account is before it contributes anything.
        const serverIsAhead = remote.revision > meta.revision;
        if (serverIsAhead && Object.keys(remote.values).length > 0) {
          await mutate((instance) => instance.importState(remote.values));
          await writeMeta({ revision: remote.revision, lastSyncedAt: new Date().toISOString() });
        }

        // Rule 3, downwards: sittings from other devices.
        const remoteSessions = await api.listStudySessions(token);
        if (remoteSessions.sessions.length > 0) {
          await mutate((instance) => instance.mergeStudySessions(remoteSessions.sessions));
        }

        // Rule 3, upwards: anything this device has that the server does not.
        const known = new Set(remoteSessions.sessions.map((session) => session.id));
        const mine = engine.getStudySessions().filter((session: StudySessionRecord) => !known.has(session.id));
        if (mine.length > 0) await api.pushStudySessions(token, mine);

        // Rule 2: push this device's state.
        const base = serverIsAhead ? remote.revision : (await readMeta()).revision;
        const values = await engine.exportState();
        const result = await api.putState(token, { baseRevision: base, device: deviceName, values });

        if ('conflict' in result) {
          // Another device wrote between the read and the write. Take theirs and
          // let the next change push again — the alternative is overwriting work
          // that is only seconds old.
          await mutate((instance) => instance.importState(result.current.values));
          await writeMeta({ revision: result.current.revision, lastSyncedAt: new Date().toISOString() });
        } else {
          await writeMeta({ revision: result.revision, lastSyncedAt: result.updatedAt });
        }

        pulled.current = true;
        setState('synced');
      } catch (error) {
        if (error instanceof ApiRequestError && error.isTransient) {
          setState('offline');
          if (initial) setMessage('Studying offline — this device will catch up when it can.');
        } else {
          setState('error');
          setMessage(error instanceof Error ? error.message : 'Sync failed.');
        }
      } finally {
        running.current = false;
      }
    },
    [accountId, api, deviceName, engine, mutate, readMeta, token, user?.id, writeMeta],
  );

  // First sync when an account appears, and a reset when it goes away.
  useEffect(() => {
    pulled.current = false;
    if (status !== 'signed-in' || !token) {
      setState('idle');
      setLastSyncedAt(undefined);
      return;
    }
    void sync({ initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, token, engine]);

  /**
   * Push after changes settle.
   *
   * Debounced rather than immediate: a review session is thirty state changes in
   * two minutes, and uploading the account thirty times would be thirty times
   * the traffic for the same end state.
   */
  useEffect(() => {
    if (status !== 'signed-in' || !pulled.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void sync(), PUSH_DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, status]);

  // Coming back to the app is the moment another device's changes matter.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && status === 'signed-in') void sync();
    });
    return () => subscription.remove();
  }, [status, sync]);

  const value = useMemo<SyncContextValue>(
    () => ({
      state,
      ...(lastSyncedAt ? { lastSyncedAt } : {}),
      ...(message ? { message } : {}),
      syncNow: () => sync(),
    }),
    [state, lastSyncedAt, message, sync],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used inside a SyncProvider');
  return context;
}
