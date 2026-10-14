import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { readJson, writeJson, type AuthSessionInfo, type PublicUser } from '@language-srs/core';
import { appStore } from '../storage/adapter';
import { ApiRequestError, createApiClient, type ApiClient } from './client';

/**
 * Who is signed in.
 *
 * Sits above the engine, because the account decides *which* engine: signing in
 * switches the storage namespace under the domain, so two people sharing a phone
 * have separate decks, schedules and streaks. Signing out does not delete
 * anything — it moves back to the signed-out namespace, and signing in again
 * finds the account's cards where they were.
 *
 * The stored session lives outside every account's namespace, since it is what
 * decides which namespace to use.
 */
const SESSION_KEY = 'auth:v1:session';

interface StoredSession {
  token: string;
  user: PublicUser;
  expiresAt: string;
}

export type AuthStatus =
  /** Reading the stored session; nothing should render account state yet. */
  | 'loading'
  | 'signed-out'
  | 'signed-in';

interface AuthContextValue {
  status: AuthStatus;
  user?: PublicUser;
  token?: string;
  /** True when the last call to the API could not reach it. */
  offline: boolean;
  api: ApiClient;
  deviceName: string;
  /**
   * `onWaking` fires when the first attempt timed out and a longer one has
   * started — a free host cold-starting rather than anything being wrong. The
   * sign-in screen turns it into a sentence rather than leaving somebody
   * watching a button that appears stuck.
   */
  signIn(input: { email: string; password: string }, onWaking?: () => void): Promise<void>;
  register(
    input: { email: string; password: string; displayName?: string },
    onWaking?: () => void,
  ): Promise<void>;
  signOut(): Promise<void>;
  signOutOthers(): Promise<number>;
  listSessions(): Promise<AuthSessionInfo[]>;
  revokeSession(sessionId: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<StoredSession | undefined>();
  const [offline, setOffline] = useState(false);

  const api = useMemo(() => createApiClient(), []);
  const deviceName = useMemo(describeDevice, []);

  /**
   * Restore the session on launch.
   *
   * The token is trusted locally first and verified with the server second, so
   * opening the app on a train shows your own cards rather than a sign-in form.
   * Only an explicit 401 signs you out; an unreachable server means offline, and
   * offline is not a reason to lose your place.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await readJson<StoredSession | null>(appStore, SESSION_KEY, null);
      if (cancelled) return;

      if (!stored?.token) {
        setStatus('signed-out');
        return;
      }

      setSession(stored);
      setStatus('signed-in');

      try {
        const fresh = await api.me(stored.token);
        if (cancelled) return;
        setOffline(false);
        const updated: StoredSession = { ...stored, user: fresh.user, expiresAt: fresh.expiresAt };
        setSession(updated);
        await writeJson(appStore, SESSION_KEY, updated);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.isTransient) {
          setOffline(true);
          return;
        }
        // The server has revoked or expired this session — signing out here is
        // what makes "sign out everywhere" mean something on the other device.
        await appStore.remove(SESSION_KEY);
        setSession(undefined);
        setStatus('signed-out');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api]);

  const adopt = useCallback(async (result: { token: string; user: PublicUser; expiresAt: string }) => {
    const stored: StoredSession = { token: result.token, user: result.user, expiresAt: result.expiresAt };
    await writeJson(appStore, SESSION_KEY, stored);
    setSession(stored);
    setOffline(false);
    setStatus('signed-in');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      ...(session ? { user: session.user, token: session.token } : {}),
      offline,
      api,
      deviceName,

      async signIn({ email, password }, onWaking) {
        await adopt(await api.signIn({ email, password, device: deviceName }, onWaking));
      },

      async register({ email, password, displayName }, onWaking) {
        await adopt(
          await api.register(
            {
              email,
              password,
              device: deviceName,
              ...(displayName ? { displayName } : {}),
            },
            onWaking,
          ),
        );
      },

      /**
       * Sign out.
       *
       * The local session goes first and the server is told second. If the
       * request fails there is no way to tell the learner "you are still signed
       * in, sorry" that they would accept — the button has to work offline, and
       * the token expires on its own regardless.
       */
      async signOut() {
        const token = session?.token;
        await appStore.remove(SESSION_KEY);
        setSession(undefined);
        setStatus('signed-out');
        if (!token) return;
        try {
          await api.signOut(token);
        } catch {
          // See above.
        }
      },

      async signOutOthers() {
        if (!session) return 0;
        const { revoked } = await api.signOutOthers(session.token);
        return revoked;
      },

      async listSessions() {
        if (!session) return [];
        const { sessions } = await api.listSessions(session.token);
        return sessions;
      },

      async revokeSession(sessionId) {
        if (!session) return;
        await api.revokeSession(session.token, sessionId);
      },
    }),
    [status, session, offline, api, deviceName, adopt],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

/**
 * A label for this device, shown in the account's device list.
 *
 * Deliberately coarse. The list exists so somebody can recognise a session they
 * do not remember creating and revoke it, and "iOS" plus a sign-in date does
 * that; a device fingerprint would do it better and is not worth collecting for
 * the difference.
 */
function describeDevice(): string {
  switch (Platform.OS) {
    case 'ios':
      return 'iOS';
    case 'android':
      return 'Android';
    case 'web':
      return 'Web';
    default:
      return Platform.OS;
  }
}
