import { describe, expect, it } from 'vitest';
import { MemoryServerStore } from '../store/memory.ts';
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  demoLoginRefusal,
  demoLoginRequested,
  seedDemoAccount,
} from './demo.ts';
import { AuthService } from './auth.ts';

describe('the development login', () => {
  it('does nothing unless it is asked for', () => {
    expect(demoLoginRequested({})).toBe(false);
    expect(demoLoginRequested({ DEMO_LOGIN: '0' })).toBe(false);
    expect(demoLoginRequested({ DEMO_LOGIN: 'true' })).toBe(false);
    expect(demoLoginRequested({ DEMO_LOGIN: '1' })).toBe(true);
  });

  it('refuses to be switched on in production', () => {
    // The one case that must never be a warning. "admin" is the first pair
    // anybody tries, and a log line is not a control.
    expect(demoLoginRefusal({ DEMO_LOGIN: '1', NODE_ENV: 'production' })).toBeDefined();
    expect(demoLoginRefusal({ DEMO_LOGIN: '1' })).toBeUndefined();
    expect(demoLoginRefusal({ NODE_ENV: 'production' })).toBeUndefined();
  });

  it('signs in through the ordinary path, with no special case', async () => {
    const store = new MemoryServerStore();
    await seedDemoAccount(store);

    // `AuthService` has never heard of this account. If this passes, the
    // password was hashed and verified like anybody else's.
    const auth = new AuthService({ store });
    const result = await auth.signIn({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe(DEMO_EMAIL);
  });

  it('still rejects the wrong password for it', async () => {
    const store = new MemoryServerStore();
    await seedDemoAccount(store);
    const auth = new AuthService({ store });

    // It is an account, not a bypass: there is no branch that lets anything
    // else through just because the email is `admin`.
    await expect(auth.signIn({ email: DEMO_EMAIL, password: 'admin1' })).rejects.toThrow();
    await expect(auth.signIn({ email: DEMO_EMAIL, password: '' })).rejects.toThrow();
  });

  it('does not exist when it was never seeded', async () => {
    const store = new MemoryServerStore();
    const auth = new AuthService({ store });

    // The whole safety argument: off means the credential is absent, not
    // merely unadvertised.
    await expect(auth.signIn({ email: DEMO_EMAIL, password: DEMO_PASSWORD })).rejects.toThrow();
  });

  it('is idempotent and never rewrites an existing account', async () => {
    const store = new MemoryServerStore();
    expect(await seedDemoAccount(store)).toBe(true);
    expect(await seedDemoAccount(store)).toBe(false);

    const before = await store.findUserByEmail(DEMO_EMAIL);
    await seedDemoAccount(store);
    const after = await store.findUserByEmail(DEMO_EMAIL);
    // Rewriting somebody's credentials on every boot would be worse than
    // having no demo login at all.
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(after?.id).toBe(before?.id);
  });

  it('is a password the app would not otherwise allow', async () => {
    // Which is why it is seeded rather than registered: the rules stay intact
    // for everybody, and this account cannot be created through the API.
    const { validatePassword } = await import('@language-srs/core');
    expect(validatePassword(DEMO_PASSWORD)).toBeDefined();
  });
});
