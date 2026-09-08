import { describe, expect, it, vi } from 'vitest';
import { MemoryStore, PrefixedStore } from '../storage/port';
import { fixedClock } from '../utils/date';
import { AuthStore } from './store';
import { DeviceAccountProvider } from './device';
import { HttpAuthProvider } from './http';
import { AuthError, storagePrefixFor, type Account, type AuthSession } from './types';

const NOW = '2026-03-01T09:00:00.000Z';

function deviceProvider(id = 'device-1') {
  return new DeviceAccountProvider({ clock: fixedClock(NOW), generateId: () => id });
}

async function storeWith(providers = [deviceProvider()], store = new MemoryStore()) {
  return { store, auth: await AuthStore.create({ store, providers, clock: fixedClock(NOW) }) };
}

/** A fetch double that answers one canned response and records what it was sent. */
function fakeFetch(response: { status?: number; body?: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      json: async () => response.body,
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('device profile', () => {
  it('signs in with no network and no credentials', async () => {
    const { auth } = await storeWith();
    const session = await auth.signIn('device');

    expect(session.account.provider).toBe('device');
    expect(session.token).toBeUndefined();
    expect(auth.isSignedIn).toBe(true);
  });

  it('takes a display name when one is offered', async () => {
    const { auth } = await storeWith();
    const session = await auth.signIn('device', { email: '', password: '', displayName: '  Vish ' });
    expect(session.account.displayName).toBe('Vish');
  });

  it('survives a relaunch', async () => {
    const { store, auth } = await storeWith();
    await auth.signIn('device');

    const restored = await AuthStore.create({ store, providers: [deviceProvider()] });
    expect(restored.account?.id).toBe('device-1');
  });

  it('is forgotten on sign out', async () => {
    const { store, auth } = await storeWith();
    await auth.signIn('device');
    await auth.signOut();

    expect(auth.isSignedIn).toBe(false);
    const restored = await AuthStore.create({ store, providers: [deviceProvider()] });
    expect(restored.isSignedIn).toBe(false);
  });

  it('refuses a provider it was not given', async () => {
    const { auth } = await storeWith();
    await expect(auth.signIn('email', { email: 'a@b.co', password: 'x' })).rejects.toThrow(AuthError);
  });
});

describe('storage namespacing', () => {
  it('leaves the device account on the keys it already used', () => {
    // Moving these on first launch would have read as progress being deleted.
    const account: Account = {
      id: 'device-1',
      provider: 'device',
      displayName: 'This device',
      createdAt: NOW,
    };
    expect(storagePrefixFor(account)).toBe('');
    expect(storagePrefixFor(undefined)).toBe('');
  });

  it('gives a signed-in account its own namespace', () => {
    const account: Account = {
      id: 'acc-9',
      provider: 'email',
      displayName: 'Vish',
      createdAt: NOW,
    };
    expect(storagePrefixFor(account)).toBe('acct:acc-9:');
  });

  it('keeps two accounts from reading each other', async () => {
    const shared = new MemoryStore();
    const a = new PrefixedStore(shared, 'acct:one:');
    const b = new PrefixedStore(shared, 'acct:two:');

    await a.set('srs:v1:cards', '[1]');
    await b.set('srs:v1:cards', '[2]');

    expect(await a.get('srs:v1:cards')).toBe('[1]');
    expect(await b.get('srs:v1:cards')).toBe('[2]');
    expect(await shared.get('acct:one:srs:v1:cards')).toBe('[1]');
  });

  it('reports its own keys unprefixed, and only its own', async () => {
    const shared = new MemoryStore();
    const a = new PrefixedStore(shared, 'acct:one:');
    await a.set('srs:v1:cards', '[]');
    await shared.set('acct:two:srs:v1:cards', '[]');

    expect(await a.keys()).toEqual(['srs:v1:cards']);
  });

  it('lets a key opt out of the namespace', async () => {
    // The widget snapshot is one shared slot: the home screen shows whoever is
    // signed in now, and the native widget reads a fixed key.
    const shared = new MemoryStore();
    const scoped = new PrefixedStore(shared, 'acct:one:', {
      passthrough: (key) => key.endsWith(':widget'),
    });

    await scoped.set('srs:v1:widget', '{}');
    expect(await shared.get('srs:v1:widget')).toBe('{}');

    await scoped.remove('srs:v1:widget');
    expect(await shared.get('srs:v1:widget')).toBeNull();
  });
});

describe('email provider', () => {
  const body = {
    account: { id: 'acc-9', email: 'vish@example.com', displayName: 'Vish', createdAt: NOW },
    token: 'tok',
    refreshToken: 'ref',
  };

  it('signs in and keeps the token', async () => {
    const { impl, calls } = fakeFetch({ body });
    const provider = new HttpAuthProvider({ baseUrl: 'https://api.example.com/', fetch: impl });

    const session = await provider.signIn({ email: 'vish@example.com', password: 'hunter2!!' });

    expect(session.account.id).toBe('acc-9');
    expect(session.token).toBe('tok');
    // A trailing slash on the base URL must not produce a double slash.
    expect(calls[0]!.url).toBe('https://api.example.com/sign-in');
  });

  it('rejects a malformed address before making a request', async () => {
    const { impl, calls } = fakeFetch({ body });
    const provider = new HttpAuthProvider({ baseUrl: 'https://api.example.com', fetch: impl });

    await expect(provider.signIn({ email: 'not-an-email', password: 'hunter2!!' })).rejects.toMatchObject(
      { code: 'invalid-email' },
    );
    expect(calls).toHaveLength(0);
  });

  it('rejects a short password before making a request', async () => {
    const { impl, calls } = fakeFetch({ body });
    const provider = new HttpAuthProvider({ baseUrl: 'https://api.example.com', fetch: impl });

    await expect(
      provider.register({ email: 'vish@example.com', password: 'short' }),
    ).rejects.toMatchObject({ code: 'weak-password' });
    expect(calls).toHaveLength(0);
  });

  it('maps status codes to codes the screen can act on', async () => {
    const cases: [number, string][] = [
      [401, 'invalid-credentials'],
      [409, 'email-taken'],
      [500, 'server'],
    ];

    for (const [status, code] of cases) {
      const { impl } = fakeFetch({ status, body: {} });
      const provider = new HttpAuthProvider({ baseUrl: 'https://api.example.com', fetch: impl });
      await expect(
        provider.signIn({ email: 'vish@example.com', password: 'hunter2!!' }),
      ).rejects.toMatchObject({ code });
    }
  });

  it('reports an unreachable server as a network problem, not a wrong password', async () => {
    const impl = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;
    const provider = new HttpAuthProvider({ baseUrl: 'https://api.example.com', fetch: impl });

    await expect(
      provider.signIn({ email: 'vish@example.com', password: 'hunter2!!' }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('refuses a response with no account id rather than corrupting the namespace', async () => {
    const { impl } = fakeFetch({ body: { token: 'tok', account: {} } });
    const provider = new HttpAuthProvider({ baseUrl: 'https://api.example.com', fetch: impl });

    await expect(
      provider.signIn({ email: 'vish@example.com', password: 'hunter2!!' }),
    ).rejects.toMatchObject({ code: 'server' });
  });

  it('signs out locally even when the server call fails', async () => {
    const impl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const provider = new HttpAuthProvider({ baseUrl: 'https://api.example.com', fetch: impl });
    const session: AuthSession = {
      account: { id: 'acc-9', provider: 'email', displayName: 'Vish', createdAt: NOW },
      token: 'tok',
    };

    await expect(provider.signOut(session)).resolves.toBeUndefined();
  });
});

describe('sessions', () => {
  it('treats a session with no expiry as current', async () => {
    const { auth } = await storeWith();
    await auth.signIn('device');
    expect(auth.isExpired).toBe(false);
  });

  it('notices an expiry that has passed', async () => {
    const store = new MemoryStore();
    const expired: AuthSession = {
      account: { id: 'acc-9', provider: 'email', displayName: 'Vish', createdAt: NOW },
      token: 'tok',
      expiresAt: '2026-02-01T09:00:00.000Z',
    };
    await store.set('srs:v1:auth', JSON.stringify(expired));

    const auth = await AuthStore.create({ store, providers: [], clock: fixedClock(NOW) });
    expect(auth.isExpired).toBe(true);
  });

  it('reports a failed refresh rather than throwing', async () => {
    const store = new MemoryStore();
    const session: AuthSession = {
      account: { id: 'acc-9', provider: 'email', displayName: 'Vish', createdAt: NOW },
      token: 'tok',
      refreshToken: 'ref',
    };
    await store.set('srs:v1:auth', JSON.stringify(session));

    const impl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const auth = await AuthStore.create({
      store,
      providers: [new HttpAuthProvider({ baseUrl: 'https://api.example.com', fetch: impl })],
    });

    await expect(auth.refresh()).resolves.toBe(false);
    // The local session survives: a failed refresh must not lock someone out of
    // their own offline deck.
    expect(auth.isSignedIn).toBe(true);
  });

  it('announces every change once', async () => {
    const onChanged = vi.fn();
    const store = new MemoryStore();
    const auth = await AuthStore.create({ store, providers: [deviceProvider()], onChanged });

    await auth.signIn('device');
    await auth.setDisplayName('Vish');
    await auth.signOut();

    expect(onChanged).toHaveBeenCalledTimes(3);
  });

  it('ignores an empty rename', async () => {
    const { auth } = await storeWith();
    await auth.signIn('device');
    await auth.setDisplayName('   ');
    expect(auth.account?.displayName).toBe('This device');
  });
});
