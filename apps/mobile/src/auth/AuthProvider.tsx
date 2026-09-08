import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AuthStore,
  DeviceAccountProvider,
  HttpAuthProvider,
  PrefixedStore,
  STORAGE_KEYS,
  type Account,
  type AuthProvider as AuthProviderPort,
  type AuthProviderId,
  type Credentials,
  type KeyValueStore,
} from '@language-srs/core';
import { appStore } from '../storage/adapter';

/**
 * Accounts, above the engine.
 *
 * This provider decides two things and nothing else: who is signed in, and which
 * slice of storage that means. The engine below it is handed a store and never
 * learns that accounts exist.
 *
 * Studying is not gated on any of it. An SRS that stops working because a token
 * expired is worse than one with no accounts at all, so a learner who never signs
 * in gets the device profile and the full app.
 */

/**
 * The backend, if there is one.
 *
 * Read from the environment at build time. With nothing configured the email
 * option is absent rather than present-and-broken — a password field with no
 * server behind it is a lie told to whoever types into it.
 */
const AUTH_URL = process.env.EXPO_PUBLIC_AUTH_URL;

interface AuthContextValue {
  account?: Account;
  isSignedIn: boolean;
  /** True once the stored session has been read; screens wait for it. */
  ready: boolean;
  /** The store the engine should use for the current account. */
  store: KeyValueStore;
  providers: AuthProviderPort[];
  signIn(provider: AuthProviderId, credentials?: Credentials): Promise<void>;
  register(provider: AuthProviderId, credentials: Credentials): Promise<void>;
  signOut(): Promise<void>;
  rename(displayName: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthStore | undefined>();
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const providers: AuthProviderPort[] = [new DeviceAccountProvider()];
      if (AUTH_URL) providers.push(new HttpAuthProvider({ baseUrl: AUTH_URL }));

      const store = await AuthStore.create({ store: appStore, providers, onChanged: bump });
      // An expired token is worth one quiet attempt to renew at launch. Failure
      // is not treated as a sign-out: the local deck is the learner's either way.
      if (store.isExpired) await store.refresh();
      if (!cancelled) setAuth(store);
    })();

    return () => {
      cancelled = true;
    };
  }, [bump]);

  const value = useMemo<AuthContextValue | undefined>(() => {
    if (!auth) return undefined;
    void revision;

    return {
      ...(auth.account ? { account: auth.account } : {}),
      isSignedIn: auth.isSignedIn,
      ready: true,
      store: storeFor(auth.storagePrefix),
      providers: auth.providers,
      async signIn(provider, credentials) {
        await auth.signIn(provider, credentials);
      },
      async register(provider, credentials) {
        await auth.register(provider, credentials);
      },
      async signOut() {
        await auth.signOut();
      },
      async rename(displayName) {
        await auth.setDisplayName(displayName);
      },
    };
  }, [auth, revision]);

  if (!value) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * The store for one account.
 *
 * Memoised by prefix so switching back to an account does not hand the engine a
 * new object for the same data, which would remount it for no reason.
 *
 * The widget snapshot is exempt from the prefix: the home screen shows whoever is
 * signed in now, and the native widget reads it at a fixed key it has no way of
 * being told about.
 */
const storeCache = new Map<string, KeyValueStore>();

function storeFor(prefix: string): KeyValueStore {
  if (prefix === '') return appStore;

  const cached = storeCache.get(prefix);
  if (cached) return cached;

  const store = new PrefixedStore(appStore, prefix, {
    passthrough: (key) => key === STORAGE_KEYS.widget,
  });
  storeCache.set(prefix, store);
  return store;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
