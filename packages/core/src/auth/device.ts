import type { Clock } from '../utils/date';
import { systemClock } from '../utils/date';
import type { Account, AuthProvider, AuthSession, Credentials } from './types';

/**
 * The local profile.
 *
 * No server, no password, no claim to be either. It exists so that a learner who
 * never signs in still has an identity — a name on the settings screen, and
 * something for a future sync to attach to if they change their mind — and so
 * that "not signed in" is a state the app can name rather than a hole.
 *
 * Calling this authentication would be a lie: anyone holding the unlocked phone
 * is already past it. It is a profile, and the UI says profile.
 */
export class DeviceAccountProvider implements AuthProvider {
  readonly id = 'device' as const;
  readonly label = 'Use this device only';
  readonly requiresNetwork = false;

  constructor(
    private readonly options: {
      clock?: Clock;
      /** Injectable so tests get a stable id; defaults to a random one. */
      generateId?: () => string;
    } = {},
  ) {}

  async signIn(credentials?: Credentials): Promise<AuthSession> {
    const clock = this.options.clock ?? systemClock;
    const account: Account = {
      id: this.options.generateId?.() ?? randomId(),
      provider: 'device',
      displayName: credentials?.displayName?.trim() || 'This device',
      createdAt: clock(),
    };
    return { account };
  }
}

/**
 * A random identifier.
 *
 * `crypto.randomUUID` where the platform has it — Hermes and older browsers do
 * not, and core cannot assume either, so the fallback is plain `Math.random`.
 * That is fine here and would not be if this id were a secret: it identifies a
 * local profile, it does not protect anything.
 */
function randomId(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof globalCrypto?.randomUUID === 'function') return globalCrypto.randomUUID();
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
