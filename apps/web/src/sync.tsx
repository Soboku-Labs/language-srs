import {
  createMonClient,
  describeSyncFailure,
  isRetryable,
  lastSyncedAt,
  sync as runSync,
  type MonClient,
  type SyncResult,
  type TokenStore,
} from '@mon/api';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiTransport, hasBackend } from './api';
import { useAuth, useEngine } from './providers';

/**
 * Sync.
 *
 * The web app keeps studying locally and sends its work to the backend in the
 * background. That ordering is the whole design: reviews are recorded the moment
 * the learner answers, and whether the network cooperates is a separate question
 * with a separate indicator.
 *
 * ## Why this app still runs the scheduler locally
 *
 * The architecture note says clients render and the backend computes, and for a
 * Swift or Kotlin client that is exactly right — the alternative is porting FSRS
 * twice and watching the three copies drift. A JavaScript client is a different
 * case: it runs `@mon/core` itself, the *same source* the backend runs, so there
 * is no port to drift. Calling over the network instead would buy nothing and
 * cost a loading state on every screen and an app that stops working in a
 * tunnel.
 *
 * So the backend is this app's sync peer rather than its brain, and the one
 * thing it is authoritative about is card state — because `applyFuzz` makes due
 * dates unreproducible, so somebody has to be the answer.
 */

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'error';

interface SyncValue {
  /** False when no backend is configured, which is most builds. */
  available: boolean;
  phase: SyncPhase;
  /** When the last complete sync finished. */
  syncedAt?: string;
  /** Reviews this device has not managed to send yet. */
  pending: number;
  lastError?: string;
  /** The result of the most recent successful sync, for showing what arrived. */
  lastResult?: SyncResult;
  syncNow(): Promise<void>;
}

const SyncContext = createContext<SyncValue | undefined>(undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { account, store, session, refresh, signOut } = useAuth();
  const { engine, revision } = useEngine();

  const [phase, setPhase] = useState<SyncPhase>('off');
  const [syncedAt, setSyncedAt] = useState<string | undefined>();
  const [lastError, setLastError] = useState<string | undefined>();
  const [lastResult, setLastResult] = useState<SyncResult | undefined>();
  const [pending, setPending] = useState(0);

  /** A sync in flight, so two triggers do not run the loop twice over one deck. */
  const running = useRef<Promise<void> | undefined>(undefined);

  // Only an email account syncs. A device account has no identity on any
  // backend, and pretending otherwise would show a learner a sync indicator
  // that can never move.
  const enabled = Boolean(apiTransport()) && account?.provider === 'email' && Boolean(session?.token);

  const client = useMemo<MonClient | undefined>(() => {
    const active = apiTransport();
    if (!active || !enabled) return undefined;

    const tokens: TokenStore = {
      get: () => session?.token,
      getRefresh: () => session?.refreshToken,
    };

    return createMonClient({
      transport: active,
      tokens,
      // Renewal goes through the auth store, which owns the session and persists
      // it. Letting the client do its own would be a second place a token is
      // written, and the one that wrote last would win by accident.
      renew: refresh,
      onSignedOut: () => void signOut(),
    });
  }, [enabled, session, refresh, signOut]);

  const syncNow = useCallback(async () => {
    if (!client || !enabled) return;
    if (running.current) return running.current;

    const attempt = (async () => {
      setPhase('syncing');
      try {
        const result = await runSync({ client, engine, store });
        setLastResult(result);
        setSyncedAt(result.syncedAt);
        setLastError(undefined);
        setPhase('idle');
      } catch (cause) {
        /*
         * A failure here is not an error the learner caused or can fix.
         *
         * It is almost always the network, and the reviews are safe on this
         * device either way — so it is reported quietly and retried, rather than
         * thrown at a screen that would have to explain it.
         */
        setLastError(describeSyncFailure(cause));
        setPhase(isRetryable(cause) ? 'idle' : 'error');
      }
    })();

    running.current = attempt.finally(() => {
      running.current = undefined;
    });
    return running.current;
  }, [client, enabled, engine, store]);

  // What is waiting to go out, recomputed whenever the engine changes. Shown
  // rather than hidden: "3 reviews not yet synced" is a fact a learner can act
  // on by finding a connection.
  useEffect(() => {
    void revision;
    let cancelled = false;

    void (async () => {
      const [stored, logs] = await Promise.all([
        lastSyncedAt(store),
        Promise.resolve(engine.getReviewLogs()),
      ]);
      if (cancelled) return;
      setSyncedAt((current) => current ?? stored);
      // Approximate on purpose: the exact set lives in the sync record and
      // reading it per render would be a file read per keystroke.
      setPending(stored ? logs.filter((log) => log.reviewedAt > stored).length : logs.length);
    })();

    return () => {
      cancelled = true;
    };
  }, [engine, revision, store]);

  useEffect(() => {
    setPhase(enabled ? 'idle' : 'off');
  }, [enabled]);

  // One sync on arrival, and one whenever the tab comes back. A learner who
  // studied on their phone expects the laptop to know by the time they look at
  // it, and "when you look at it" is exactly what a focus event is.
  useEffect(() => {
    if (!enabled) return;
    void syncNow();

    const onFocus = () => void syncNow();
    const onOnline = () => void syncNow();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, syncNow]);

  /*
   * And shortly after studying stops.
   *
   * Debounced rather than per-grading: a learner working through twenty cards
   * would otherwise send twenty requests, each one a batch of one, instead of
   * one batch of twenty when they pause.
   */
  useEffect(() => {
    if (!enabled || revision === 0) return;
    const timer = setTimeout(() => void syncNow(), 4000);
    return () => clearTimeout(timer);
  }, [enabled, revision, syncNow]);

  const value = useMemo<SyncValue>(
    () => ({
      available: hasBackend,
      phase,
      ...(syncedAt ? { syncedAt } : {}),
      pending,
      ...(lastError ? { lastError } : {}),
      ...(lastResult ? { lastResult } : {}),
      syncNow,
    }),
    [phase, syncedAt, pending, lastError, lastResult, syncNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used inside a SyncProvider');
  return context;
}
