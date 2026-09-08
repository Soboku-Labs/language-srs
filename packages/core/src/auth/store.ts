import { readJson, writeJson, type KeyValueStore } from '../storage/port';
import { systemClock, toEpochMs, type Clock } from '../utils/date';
import {
  AuthError,
  storagePrefixFor,
  type AuthProvider,
  type AuthProviderId,
  type AuthSession,
  type Credentials,
} from './types';

const AUTH_KEY = 'srs:v1:auth';

/**
 * Holds the signed-in session and puts it back after a relaunch.
 *
 * Deliberately not part of `StudyEngine`. Which account you are is orthogonal to
 * what is due, and folding the two together would mean every scheduling test had
 * to know about tokens.
 *
 * The session is persisted at an unprefixed key on purpose: it is the thing that
 * decides which prefix to use, so it cannot live behind one.
 */
export class AuthStore {
  private session: AuthSession | undefined;

  private constructor(
    private readonly options: {
      store: KeyValueStore;
      providers: AuthProvider[];
      clock?: Clock;
      onChanged?: (store: AuthStore) => void | Promise<void>;
    },
    session: AuthSession | undefined,
  ) {
    this.session = session;
  }

  static async create(options: {
    store: KeyValueStore;
    providers: AuthProvider[];
    clock?: Clock;
    onChanged?: (store: AuthStore) => void | Promise<void>;
  }): Promise<AuthStore> {
    const restored = await readJson<AuthSession | null>(options.store, AUTH_KEY, null);
    return new AuthStore(options, restored ?? undefined);
  }

  get currentSession(): AuthSession | undefined {
    return this.session;
  }

  get account() {
    return this.session?.account;
  }

  get isSignedIn(): boolean {
    return this.session !== undefined;
  }

  /** The storage prefix the engine should run under for the current account. */
  get storagePrefix(): string {
    return storagePrefixFor(this.session?.account);
  }

  get providers(): AuthProvider[] {
    return this.options.providers;
  }

  provider(id: AuthProviderId): AuthProvider | undefined {
    return this.options.providers.find((candidate) => candidate.id === id);
  }

  /**
   * Whether the stored token has passed its expiry.
   *
   * Only ever used to decide whether to try a refresh. It is not a permission
   * check — the app has no server to keep anyone out of, and treating a stale
   * token as a reason to hide someone's own local deck would be theatre.
   */
  get isExpired(): boolean {
    const expiresAt = this.session?.expiresAt;
    if (!expiresAt) return false;
    return toEpochMs(expiresAt) <= toEpochMs((this.options.clock ?? systemClock)());
  }

  async signIn(providerId: AuthProviderId, credentials?: Credentials): Promise<AuthSession> {
    const provider = this.provider(providerId);
    if (!provider) throw new AuthError('not-configured', 'That sign-in method is not available.');

    const session = await provider.signIn(credentials);
    await this.adopt(session);
    return session;
  }

  async register(providerId: AuthProviderId, credentials: Credentials): Promise<AuthSession> {
    const provider = this.provider(providerId);
    if (!provider?.register) {
      throw new AuthError('not-configured', 'That sign-in method cannot create accounts.');
    }

    const session = await provider.register(credentials);
    await this.adopt(session);
    return session;
  }

  /**
   * Renew an expired session.
   *
   * Returns false rather than throwing when it cannot: a failed refresh at launch
   * is an ordinary event, and the caller's response is to show the sign-in screen,
   * not to handle an exception.
   */
  async refresh(): Promise<boolean> {
    const session = this.session;
    if (!session) return false;

    const provider = this.provider(session.account.provider);
    if (!provider?.refresh) return false;

    try {
      await this.adopt(await provider.refresh(session));
      return true;
    } catch {
      return false;
    }
  }

  async signOut(): Promise<void> {
    const session = this.session;
    if (!session) return;

    // Told before forgotten, since telling it needs the token.
    await this.provider(session.account.provider)?.signOut?.(session);

    this.session = undefined;
    await this.options.store.remove(AUTH_KEY);
    await this.options.onChanged?.(this);
  }

  /** Rename the current account locally. */
  async setDisplayName(displayName: string): Promise<void> {
    const session = this.session;
    const trimmed = displayName.trim();
    if (!session || trimmed.length === 0) return;

    await this.adopt({ ...session, account: { ...session.account, displayName: trimmed } });
  }

  private async adopt(session: AuthSession): Promise<void> {
    this.session = session;
    await writeJson(this.options.store, AUTH_KEY, session);
    await this.options.onChanged?.(this);
  }
}

export { AUTH_KEY };
