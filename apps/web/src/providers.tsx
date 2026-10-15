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
import { api, deviceName, hasBackend } from './api';
import {
  adoptDeck,
  createDeviceAccount,
  forgetAccount,
  isRemote,
  loadAccount,
  saveAccount,
  storeFor,
  type StoredAccount,
} from './accounts';
import { webStore } from './storage';

/**
 * Who is using this browser, and their study engine.
 *
 * Auth sits above the engine, because which account you are decides which slice
 * of storage the engine reads, and the engine is rebuilt when that changes.
 *
 * The account is local — see `accounts.ts` for why there is no email form yet.
 */

export type AuthMode = 'register' | 'signIn';

interface AuthValue {
  account?: StoredAccount;
  isSignedIn: boolean;
  /** True when this account's progress is carried off the device. */
  synced: boolean;
  /** False when this build has no backend, so the UI offers no password field. */
  canSignIn: boolean;
  /** The slice of storage this account's engine reads and writes. */
  store: KeyValueStore;
  /** The bearer token, for the sync layer. */
  token?: string;
  /** Use the app on this device only. */
  useThisDevice(displayName?: string): Promise<void>;
  /** Create or join a server account. Throws `ApiRequestError` for the form to read. */
  authenticate(
    mode: AuthMode,
    credentials: { email: string; password: string; displayName?: string },
    onWaking?: () => void,
  ): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<StoredAccount | undefined>();
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
      synced: isRemote(account),
      canSignIn: hasBackend,
      store: storeFor(account),
      ...(account?.token ? { token: account.token } : {}),

      useThisDevice: async (displayName) => {
        setAccount(await createDeviceAccount(displayName ?? 'This device'));
      },

      /*
       * Sign in, and adopt the server's id as this account's storage prefix.
       *
       * That is the part that makes an account mean anything: the same account
       * on a second browser resolves to the same slice of storage, so the deck
       * that syncs down lands where the deck that syncs up came from.
       */
      authenticate: async (mode, credentials, onWaking) => {
        const device = deviceName();
        const result =
          mode === 'register'
            ? await api().register(
                {
                  email: credentials.email,
                  password: credentials.password,
                  ...(credentials.displayName ? { displayName: credentials.displayName } : {}),
                  device,
                },
                onWaking,
              )
            : await api().signIn({ email: credentials.email, password: credentials.password, device }, onWaking);

        const next: StoredAccount = {
          id: result.user.id,
          displayName: result.user.displayName,
          createdAt: result.user.createdAt,
          email: result.user.email,
          token: result.token,
          expiresAt: result.expiresAt,
        };

        /*
         * Bring any work done before this along.
         *
         * Nothing stands between a visitor and studying any more, so the common
         * path is to try the app first and sign in once it is worth keeping. An
         * account reads its deck from its own prefix, so without this that
         * studying would quietly stop being visible the moment they did.
         *
         * Only from a deck with nowhere else to live — a device profile, or no
         * account at all. Signing in as somebody else must not drag the
         * previous account's deck across; that one belongs on its own server.
         *
         * Written before the account changes, so the engine that mounts for it
         * reads the adopted state rather than seeding an empty deck over it.
         */
        if (!isRemote(account)) await adoptDeck(storeFor(account), storeFor(next));

        setAccount(await saveAccount(next));
      },

      signOut: async () => {
        /*
         * Told, then forgotten — and never blocked on being told.
         *
         * Signing out has to work with no network: somebody handing their laptop
         * over cannot be asked to wait for a server. The token is revoked when
         * the request lands and expires on its own if it never does.
         *
         * The deck stays behind under this account's own prefix, so signing back
         * in finds it rather than an empty one.
         */
        const token = account?.token;
        if (token) void api().signOut(token).catch(() => undefined);
        await forgetAccount();
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
