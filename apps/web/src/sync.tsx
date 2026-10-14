import { mergeStateValues, readJson, writeJson, type StudySessionRecord } from '@language-srs/core';
import { ApiRequestError } from '@language-srs/client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, deviceName } from './api';
import { useAuth, useEngine } from './providers';

/**
 * Keeping an account the same in every browser it is signed in on.
 *
 * Study never waits for this. Reviews are recorded the moment the learner
 * answers, and whether the network cooperates is a separate question with its
 * own quiet indicator — an SRS that stops working on a train is a worse product
 * than one with no sync at all.
 *
 * ## Push, then pull, then merge
 *
 * 1. **Sittings merge both ways.** Append-only and immutable once finished, so a
 *    union is always right, and losing an evening's study to a sync rule is the
 *    one outcome worth extra code to prevent.
 * 2. **This device pushes its state**, carrying the revision it was based on, so
 *    a device that has fallen behind is told rather than allowed to overwrite.
 * 3. **On a conflict it merges and writes again.** This is the part the phone
 *    does differently today: it adopts the server's state wholesale, which is
 *    honest about cards and throws away the reviews this device just recorded.
 *    `mergeStateValues` keeps both — the server's cards, the union of the
 *    reviews — because a review log is append-only and nothing needs to lose.
 *
 * The merge rules live in `@language-srs/core` and are mirrored rule for rule by
 * the Kotlin and Swift clients, so three apps cannot resolve one conflict three
 * ways.
 */

/** Sync bookkeeping, inside the account's own storage namespace. */
const SYNC_KEY = 'sync:v1';

interface SyncMeta {
  /** The server revision this device last agreed with. */
  revision: number;
  lastSyncedAt?: string;
}

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

interface SyncValue {
  phase: SyncPhase;
  syncedAt?: string;
  /** Reviews that arrived from another device on the last sync. */
  arrived: number;
  message?: string;
  syncNow(): Promise<void>;
}

const SyncContext = createContext<SyncValue | undefined>(undefined);

/**
 * How long after studying stops before pushing.
 *
 * Per-grading would send twenty requests for twenty cards, each a batch of one.
 * Four seconds is past the gap between two answers and short enough that closing
 * the tab straight after a session still catches it.
 */
const QUIET_MS = 4000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const { token, synced, store } = useAuth();
  const { engine, revision, mutate } = useEngine();

  const [phase, setPhase] = useState<SyncPhase>('off');
  const [syncedAt, setSyncedAt] = useState<string | undefined>();
  const [arrived, setArrived] = useState(0);
  const [message, setMessage] = useState<string | undefined>();

  /** A sync in flight, so two triggers do not run the loop over one deck twice. */
  const running = useRef(false);

  const readMeta = useCallback(
    async (): Promise<SyncMeta> => readJson<SyncMeta>(store, SYNC_KEY, { revision: 0 }),
    [store],
  );

  const syncNow = useCallback(async () => {
    if (!token || !synced || running.current) return;

    /*
     * The engine and the account must agree before anything is written.
     *
     * Signing in changes the store, and the engine for that store is built
     * asynchronously — so for one commit this component holds the new account's
     * store and the *previous* engine. Effects flush child-first, so this one
     * runs in exactly that window, before the engine is rebuilt.
     *
     * Syncing there is not merely early, it loses data: the state pushed comes
     * from the old engine while the revision is recorded against the new
     * account's store. The next sync then reads that revision, finds its own
     * empty deck in agreement with it, and overwrites the account on the server
     * with nothing. Comparing the stores is cheap and makes the pairing
     * impossible; the effect re-runs when the right engine arrives.
     */
    if (engine.store !== store) return;

    running.current = true;
    setPhase('syncing');

    try {
      const client = api();

      // 1. Sittings, both ways. Theirs first, so the push below includes them.
      const remoteSessions = await client.listStudySessions(token);
      if (remoteSessions.sessions.length > 0) {
        await mutate((instance) => instance.mergeStudySessions(remoteSessions.sessions));
      }
      const known = new Set(remoteSessions.sessions.map((session) => session.id));
      const mine = engine
        .getStudySessions()
        .filter((session: StudySessionRecord) => !known.has(session.id));
      if (mine.length > 0) await client.pushStudySessions(token, mine);

      // 2. Push this device's state.
      let base = (await readMeta()).revision;
      let values = await engine.exportState();
      let newReviews = 0;

      /*
       * Bounded. One conflict is ordinary — another device wrote while this one
       * was composing. A second in the same pass means something is writing
       * continuously, and spinning would turn a busy account into a hot loop.
       */
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await client.putState(token, { baseRevision: base, device: deviceName(), values });

        if (!('conflict' in result)) {
          await writeJson(store, SYNC_KEY, { revision: result.revision, lastSyncedAt: result.updatedAt });
          setSyncedAt(result.updatedAt);
          setArrived(newReviews);
          setMessage(undefined);
          setPhase('idle');
          return;
        }

        // 3. Merge and write again, rather than discarding either side.
        const merged = mergeStateValues(values, result.current.values);
        newReviews += merged.remoteOnlyReviews;
        values = merged.values;
        base = result.current.revision;

        // Adopt the merged state locally too, so the next render shows what the
        // other device did instead of waiting for a reload.
        await mutate((instance) => instance.importState(values));
      }

      setPhase('error');
      setMessage('Another device is writing faster than this one can merge.');
    } catch (cause) {
      /*
       * A failure here is not something the learner caused or can fix, and their
       * reviews are safe on this device either way — so it is reported quietly
       * and retried, not thrown at a screen that would have to explain it.
       */
      const transient = cause instanceof ApiRequestError && cause.isTransient;
      setPhase(transient ? 'offline' : 'error');
      setMessage(
        transient
          ? 'Studying offline — this browser will catch up when it can.'
          : cause instanceof Error
            ? cause.message
            : 'Sync failed.',
      );
    } finally {
      running.current = false;
    }
  }, [token, synced, engine, mutate, readMeta, store]);

  // What the indicator shows before the first sync of a session.
  useEffect(() => {
    if (!synced) {
      setPhase('off');
      return;
    }
    setPhase('idle');
    void readMeta().then((meta) => setSyncedAt((current) => current ?? meta.lastSyncedAt));
  }, [synced, readMeta]);

  /*
   * On arrival, and whenever the tab comes back.
   *
   * A learner who studied on their phone expects the laptop to know by the time
   * they look at it, and "when you look at it" is exactly what a focus event is.
   */
  useEffect(() => {
    if (!synced) return;
    void syncNow();

    const onFocus = () => void syncNow();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [synced, syncNow]);

  /** And shortly after studying stops. */
  useEffect(() => {
    if (!synced || revision === 0) return;
    const timer = setTimeout(() => void syncNow(), QUIET_MS);
    return () => clearTimeout(timer);
  }, [synced, revision, syncNow]);

  const value = useMemo<SyncValue>(
    () => ({
      phase,
      ...(syncedAt ? { syncedAt } : {}),
      arrived,
      ...(message ? { message } : {}),
      syncNow,
    }),
    [phase, syncedAt, arrived, message, syncNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used inside a SyncProvider');
  return context;
}
