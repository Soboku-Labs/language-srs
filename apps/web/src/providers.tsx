import {
  SEED_ENTRIES,
  StudyEngine,
  type KeyValueStore,
  type LanguageCode,
  type Rating,
  type ReviewSource,
} from '@language-srs/core';
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
import { createAccount, loadAccount, signOutAccount, storeFor, type LocalAccount } from './accounts';
import { webStore } from './storage';

/**
 * Who is using this browser, and their study engine.
 *
 * Auth sits above the engine, because which account you are decides which slice
 * of storage the engine reads, and the engine is rebuilt when that changes.
 *
 * The account is local — see `accounts.ts` for why there is no email form yet.
 */

interface AuthValue {
  account?: LocalAccount;
  isSignedIn: boolean;
  /** The slice of storage this account's engine reads and writes. */
  store: KeyValueStore;
  /** Start using the app under a name. */
  signIn(displayName?: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<LocalAccount | undefined>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const found = await loadAccount();
      if (cancelled) return;
      setAccount(found);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ...(account ? { account } : {}),
      isSignedIn: Boolean(account),
      store: storeFor(account),
      signIn: async (displayName) => {
        setAccount(await createAccount(displayName ?? 'This device'));
      },
      signOut: async () => {
        await signOutAccount();
        setAccount(undefined);
      },
    }),
    [account],
  );

  // Nothing is rendered until the stored account has been read, because showing
  // the sign-in screen for one frame to somebody who is already signed in reads
  // as being logged out.
  if (!ready) return null;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

interface EngineValue {
  engine: StudyEngine;
  /**
   * Bumped on every mutation.
   *
   * The engine holds mutable state rather than immutable snapshots, so React
   * cannot diff it. Screens read what they need during render and depend on this
   * counter to know when to read again.
   */
  revision: number;
  grade(cardId: string, rating: Rating, options?: { durationMs?: number; source?: ReviewSource }): Promise<void>;
  setActiveLanguage(code: LanguageCode): Promise<void>;
  mutate<T>(action: (engine: StudyEngine) => Promise<T>): Promise<T>;
}

const EngineContext = createContext<EngineValue | undefined>(undefined);

export function EngineProvider({ children }: { children: ReactNode }) {
  const { store } = useAuth();
  const [engine, setEngine] = useState<StudyEngine | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((value) => value + 1), []);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Cleared first so switching accounts cannot show the previous account's
    // queue while the next one loads.
    setEngine(undefined);

    void (async () => {
      try {
        const instance = await StudyEngine.create({
          store,
          seedEntries: SEED_ENTRIES,
          onStateChanged: async () => {
            if (!cancelled) bump();
          },
        });
        if (!cancelled) setEngine(instance);
      } catch (cause) {
        if (!cancelled) setError(cause as Error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bump, store]);

  const value = useMemo<EngineValue | undefined>(() => {
    if (!engine) return undefined;

    return {
      engine,
      revision,
      async grade(cardId, rating, options) {
        await engine.grade(cardId, rating, options ?? {});
        bump();
      },
      async setActiveLanguage(code) {
        await engine.setActiveLanguage(code);
        bump();
      },
      async mutate(action) {
        const result = await action(engine);
        bump();
        return result;
      },
    };
  }, [engine, revision, bump]);

  if (error) throw error;
  if (!value) return null;
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineValue {
  const context = useContext(EngineContext);
  if (!context) throw new Error('useEngine must be used inside an EngineProvider');
  return context;
}
