import {
  AuthStore,
  DeviceAccountProvider,
  HttpAuthProvider,
  PrefixedStore,
  SEED_ENTRIES,
  STORAGE_KEYS,
  StudyEngine,
  type Account,
  type AuthProvider as AuthProviderPort,
  type AuthProviderId,
  type Credentials,
  type KeyValueStore,
  type LanguageCode,
  type Rating,
  type ReviewSource,
} from '@mon/core';
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
import { webStore } from './storage';

/**
 * Accounts and the study engine.
 *
 * Both ports from the Expo app with the React Native removed; the logic is
 * unchanged because it was never platform-specific — which is the whole point of
 * keeping it in `@mon/core` and only the wiring here.
 *
 * Auth sits above the engine, because which account you are decides which slice
 * of storage the engine reads, and the engine is rebuilt when that changes.
 */

const AUTH_URL = import.meta.env.VITE_AUTH_URL as string | undefined;

interface AuthValue {
  account?: Account;
  isSignedIn: boolean;
  store: KeyValueStore;
  providers: AuthProviderPort[];
  signIn(provider: AuthProviderId, credentials?: Credentials): Promise<void>;
  register(provider: AuthProviderId, credentials: Credentials): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

const storeCache = new Map<string, KeyValueStore>();

/** The store for one account, memoised so returning to it does not remount the engine. */
function storeFor(prefix: string): KeyValueStore {
  if (prefix === '') return webStore;
  const cached = storeCache.get(prefix);
  if (cached) return cached;

  // The widget snapshot stays global: it is written for whoever is signed in now.
  const store = new PrefixedStore(webStore, prefix, { passthrough: (key) => key === STORAGE_KEYS.widget });
  storeCache.set(prefix, store);
  return store;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthStore | undefined>();
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const providers: AuthProviderPort[] = [new DeviceAccountProvider()];
      if (AUTH_URL) providers.push(new HttpAuthProvider({ baseUrl: AUTH_URL }));

      const store = await AuthStore.create({ store: webStore, providers, onChanged: bump });
      // One quiet attempt to renew an expired token. Failure is not a sign-out:
      // the local deck is the learner's either way.
      if (store.isExpired) await store.refresh();
      if (!cancelled) setAuth(store);
    })();

    return () => {
      cancelled = true;
    };
  }, [bump]);

  const value = useMemo<AuthValue | undefined>(() => {
    if (!auth) return undefined;
    void revision;

    return {
      ...(auth.account ? { account: auth.account } : {}),
      isSignedIn: auth.isSignedIn,
      store: storeFor(auth.storagePrefix),
      providers: auth.providers,
      signIn: async (provider, credentials) => void (await auth.signIn(provider, credentials)),
      register: async (provider, credentials) => void (await auth.register(provider, credentials)),
      signOut: async () => auth.signOut(),
    };
  }, [auth, revision]);

  if (!value) return null;
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
