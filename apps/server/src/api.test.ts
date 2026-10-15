import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { MemoryServerStore } from './store/memory.ts';

/**
 * The API, exercised over a real socket.
 *
 * Handlers are called through HTTP rather than invoked directly, because half of
 * what this file is checking lives in the layer a direct call skips: status
 * codes, the bearer header, CORS, body limits and the shape of an error body.
 */

const running: Server[] = [];

interface Harness {
  url: string;
  clock: { now: Date };
  store: MemoryServerStore;
  call(method: string, path: string, options?: { body?: unknown; token?: string }): Promise<{ status: number; body: any }>;
}

function start(options: Parameters<typeof createApp>[0] extends never ? never : Partial<Parameters<typeof createApp>[0]> = {}): Harness {
  const store = options.store instanceof MemoryServerStore ? options.store : new MemoryServerStore();
  const clock = { now: new Date('2026-07-31T09:00:00.000Z') };

  const server = createApp({
    ...options,
    store,
    now: () => clock.now,
  });
  server.listen(0);
  running.push(server);

  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    clock,
    store,
    async call(method, path, { body, token } = {}) {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : undefined };
    },
  };
}

async function withAccount(harness: Harness, email = 'learner@example.com') {
  const result = await harness.call('POST', '/auth/register', {
    body: { email, password: 'a long enough password', displayName: 'Learner', device: 'test' },
  });
  return result.body as { user: { id: string }; token: string };
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('registration', () => {
  it('creates an account and signs the device in', async () => {
    const harness = start();
    const { status, body } = await harness.call('POST', '/auth/register', {
      body: { email: 'Learner@Example.com ', password: 'a long enough password', displayName: 'Ha-eun' },
    });

    expect(status).toBe(201);
    expect(body.user).toMatchObject({ email: 'learner@example.com', displayName: 'Ha-eun' });
    expect(body.token).toBeTypeOf('string');
    expect(body.expiresAt).toBeTypeOf('string');
  });

  it('never returns the password or its hash', async () => {
    const harness = start();
    const { body } = await harness.call('POST', '/auth/register', {
      body: { email: 'a@example.com', password: 'a long enough password' },
    });
    expect(JSON.stringify(body)).not.toContain('a long enough password');
    expect(JSON.stringify(body)).not.toContain('scrypt');
  });

  it('refuses a second account on the same email', async () => {
    const harness = start();
    await withAccount(harness);
    const { status, body } = await harness.call('POST', '/auth/register', {
      body: { email: 'LEARNER@example.com', password: 'another long password' },
    });

    expect(status).toBe(409);
    expect(body.error).toBe('email_taken');
  });

  it('enforces the same password rule the app shows', async () => {
    const harness = start();
    const { status, body } = await harness.call('POST', '/auth/register', {
      body: { email: 'a@example.com', password: 'short' },
    });

    expect(status).toBe(400);
    expect(body.error).toBe('weak_password');
    expect(body.message).toContain('10');
  });

  it('rejects an address that is not one', async () => {
    const harness = start();
    const { status, body } = await harness.call('POST', '/auth/register', {
      body: { email: 'not-an-email', password: 'a long enough password' },
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_email');
  });

  it('names a missing field rather than failing obscurely', async () => {
    const harness = start();
    const { status, body } = await harness.call('POST', '/auth/register', { body: { email: 'a@example.com' } });
    expect(status).toBe(400);
    expect(body.message).toContain('password');
  });
});

describe('signing in', () => {
  it('issues a new token for the right password', async () => {
    const harness = start();
    const created = await withAccount(harness);

    const { status, body } = await harness.call('POST', '/auth/login', {
      body: { email: 'learner@example.com', password: 'a long enough password', device: 'iPhone' },
    });

    expect(status).toBe(200);
    expect(body.token).not.toBe(created.token);
    expect(body.user.id).toBe(created.user.id);
  });

  it('rejects the wrong password', async () => {
    const harness = start();
    await withAccount(harness);
    const { status, body } = await harness.call('POST', '/auth/login', {
      body: { email: 'learner@example.com', password: 'the wrong password' },
    });

    expect(status).toBe(401);
    expect(body.error).toBe('invalid_credentials');
  });

  /**
   * The same answer whether the account exists or not. A different message for
   * "no such user" turns the sign-in form into a way of enumerating who has an
   * account here.
   */
  it('answers identically for an unknown email and a wrong password', async () => {
    const harness = start();
    await withAccount(harness);

    const unknown = await harness.call('POST', '/auth/login', {
      body: { email: 'nobody@example.com', password: 'a long enough password' },
    });
    const wrong = await harness.call('POST', '/auth/login', {
      body: { email: 'learner@example.com', password: 'not the password' },
    });

    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('closes the door after repeated failures and says for how long', async () => {
    const harness = start({ authOptions: { maxFailedAttempts: 3, lockoutMinutes: 15 } });
    await withAccount(harness);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await harness.call('POST', '/auth/login', {
        body: { email: 'learner@example.com', password: 'wrong' },
      });
    }

    const locked = await harness.call('POST', '/auth/login', {
      body: { email: 'learner@example.com', password: 'a long enough password' },
    });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('rate_limited');
    expect(locked.body.message).toMatch(/minutes/);
  });

  it('opens again once the lockout has passed', async () => {
    const harness = start({ authOptions: { maxFailedAttempts: 2, lockoutMinutes: 15 } });
    await withAccount(harness);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await harness.call('POST', '/auth/login', { body: { email: 'learner@example.com', password: 'wrong' } });
    }
    harness.clock.now = new Date('2026-07-31T09:30:00.000Z');

    const { status } = await harness.call('POST', '/auth/login', {
      body: { email: 'learner@example.com', password: 'a long enough password' },
    });
    expect(status).toBe(200);
  });
});

describe('bearer authentication', () => {
  it('identifies the caller', async () => {
    const harness = start();
    const account = await withAccount(harness);

    const { status, body } = await harness.call('GET', '/auth/me', { token: account.token });
    expect(status).toBe(200);
    expect(body.user.id).toBe(account.user.id);
  });

  it('refuses a missing, malformed or invented token', async () => {
    const harness = start();
    await withAccount(harness);

    for (const token of [undefined, 'not-a-token', 'a'.repeat(43)]) {
      const { status } = await harness.call('GET', '/auth/me', token ? { token } : {});
      expect(status).toBe(401);
    }
  });

  it('refuses a token past its expiry, and forgets it', async () => {
    const harness = start();
    const account = await withAccount(harness);

    harness.clock.now = new Date('2026-10-31T09:00:00.000Z');
    expect((await harness.call('GET', '/auth/me', { token: account.token })).status).toBe(401);

    // Expired sessions are cleaned up on use rather than left to accumulate.
    harness.clock.now = new Date('2026-07-31T09:00:00.000Z');
    expect((await harness.call('GET', '/auth/me', { token: account.token })).status).toBe(401);
  });

  /**
   * Sliding expiry: using the app keeps you signed in, a month away does not.
   * Without this, everyone is signed out on the same day regardless of whether
   * they have been studying daily.
   */
  it('extends a session that is being used', async () => {
    const harness = start();
    const created = await harness.call('POST', '/auth/register', {
      body: { email: 'learner@example.com', password: 'a long enough password' },
    });
    const originalExpiry = Date.parse(created.body.expiresAt);

    harness.clock.now = new Date('2026-08-20T09:00:00.000Z');
    const refreshed = await harness.call('GET', '/auth/me', { token: created.body.token });

    expect(Date.parse(refreshed.body.expiresAt)).toBeGreaterThan(originalExpiry);
  });

  it('does not write to the store on every single request', async () => {
    const harness = start();
    const account = await withAccount(harness);

    const before = (await harness.store.listSessionsForUser(account.user.id))[0]!;
    await harness.call('GET', '/auth/me', { token: account.token });
    const after = (await harness.store.listSessionsForUser(account.user.id))[0]!;

    expect(after.lastSeenAt).toBe(before.lastSeenAt);
  });
});

describe('devices', () => {
  it('lists every signed-in device and marks the one asking', async () => {
    const harness = start();
    const first = await withAccount(harness);
    await harness.call('POST', '/auth/login', {
      body: { email: 'learner@example.com', password: 'a long enough password', device: 'iPad' },
    });

    const { body } = await harness.call('GET', '/auth/sessions', { token: first.token });
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.filter((session: any) => session.current)).toHaveLength(1);
    expect(body.sessions.map((session: any) => session.device)).toContain('iPad');
  });

  /** A list endpoint that hands back credentials turns one leak into all of them. */
  it('never includes a token in the device list', async () => {
    const harness = start();
    const account = await withAccount(harness);
    const { body } = await harness.call('GET', '/auth/sessions', { token: account.token });

    expect(JSON.stringify(body)).not.toContain(account.token);
    for (const session of body.sessions) expect(session.token).toBeUndefined();
  });

  it('signs this device out without touching the others', async () => {
    const harness = start();
    const first = await withAccount(harness);
    const second = await harness.call('POST', '/auth/login', {
      body: { email: 'learner@example.com', password: 'a long enough password', device: 'iPad' },
    });

    expect((await harness.call('POST', '/auth/logout', { token: first.token })).status).toBe(204);
    expect((await harness.call('GET', '/auth/me', { token: first.token })).status).toBe(401);
    expect((await harness.call('GET', '/auth/me', { token: second.body.token })).status).toBe(200);
  });

  it('signs out everywhere else, keeping the device that asked', async () => {
    const harness = start();
    const first = await withAccount(harness);
    const second = await harness.call('POST', '/auth/login', {
      body: { email: 'learner@example.com', password: 'a long enough password', device: 'iPad' },
    });

    const result = await harness.call('POST', '/auth/logout-others', { token: first.token });
    expect(result.body.revoked).toBe(1);
    expect((await harness.call('GET', '/auth/me', { token: first.token })).status).toBe(200);
    expect((await harness.call('GET', '/auth/me', { token: second.body.token })).status).toBe(401);
  });

  it('revokes one device by id', async () => {
    const harness = start();
    const account = await withAccount(harness);
    const other = await harness.call('POST', '/auth/login', {
      body: { email: 'learner@example.com', password: 'a long enough password', device: 'iPad' },
    });

    const list = await harness.call('GET', '/auth/sessions', { token: account.token });
    const target = list.body.sessions.find((session: any) => !session.current);

    expect((await harness.call('DELETE', `/auth/sessions/${target.id}`, { token: account.token })).status).toBe(204);
    expect((await harness.call('GET', '/auth/me', { token: other.body.token })).status).toBe(401);
  });

  /** One account must not be able to sign another's devices out. */
  it('will not revoke a session belonging to somebody else', async () => {
    const harness = start();
    const mine = await withAccount(harness, 'me@example.com');
    const theirs = await withAccount(harness, 'them@example.com');

    const theirSessions = await harness.call('GET', '/auth/sessions', { token: theirs.token });
    const victim = theirSessions.body.sessions[0];

    const { status } = await harness.call('DELETE', `/auth/sessions/${victim.id}`, { token: mine.token });
    expect(status).toBe(404);
    expect((await harness.call('GET', '/auth/me', { token: theirs.token })).status).toBe(200);
  });
});

describe('account state', () => {
  it('starts empty at revision zero', async () => {
    const harness = start();
    const account = await withAccount(harness);

    const { body } = await harness.call('GET', '/state', { token: account.token });
    expect(body).toMatchObject({ revision: 0, values: {} });
  });

  it('stores and returns state, bumping the revision', async () => {
    const harness = start();
    const account = await withAccount(harness);

    const put = await harness.call('PUT', '/state', {
      token: account.token,
      body: { baseRevision: 0, device: 'iPhone', values: { 'srs:v1:meta': '{"activeLanguage":"ko"}' } },
    });
    expect(put.body.revision).toBe(1);

    const got = await harness.call('GET', '/state', { token: account.token });
    expect(got.body.values['srs:v1:meta']).toBe('{"activeLanguage":"ko"}');
    expect(got.body.device).toBe('iPhone');
  });

  /**
   * The rule that keeps two devices from silently overwriting each other. A
   * stale write is refused, and the refusal carries the state to reconcile
   * against — a 409 with nothing in it leaves the client guessing.
   */
  it('refuses a write based on a revision that has moved, and says what is current', async () => {
    const harness = start();
    const account = await withAccount(harness);

    await harness.call('PUT', '/state', {
      token: account.token,
      body: { baseRevision: 0, device: 'iPhone', values: { a: '1' } },
    });

    const stale = await harness.call('PUT', '/state', {
      token: account.token,
      body: { baseRevision: 0, device: 'iPad', values: { a: '2' } },
    });

    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('conflict');
    expect(stale.body.current.revision).toBe(1);
    expect(stale.body.current.values.a).toBe('1');
  });

  it('keeps one account state entirely out of another', async () => {
    const harness = start();
    const mine = await withAccount(harness, 'me@example.com');
    const theirs = await withAccount(harness, 'them@example.com');

    await harness.call('PUT', '/state', {
      token: mine.token,
      body: { baseRevision: 0, device: 'mine', values: { secret: 'mine' } },
    });

    const { body } = await harness.call('GET', '/state', { token: theirs.token });
    expect(body.values).toEqual({});
  });

  it('rejects non-string state values rather than storing them', async () => {
    const harness = start();
    const account = await withAccount(harness);

    const { status, body } = await harness.call('PUT', '/state', {
      token: account.token,
      body: { baseRevision: 0, device: 'x', values: { cards: [1, 2, 3] } },
    });
    expect(status).toBe(400);
    expect(body.message).toContain('cards');
  });

  it('needs a token', async () => {
    const harness = start();
    expect((await harness.call('GET', '/state')).status).toBe(401);
    expect((await harness.call('PUT', '/state', { body: { baseRevision: 0, values: {} } })).status).toBe(401);
  });
});

describe('study sittings', () => {
  const sitting = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    languageCode: 'zh',
    startedAt: '2026-07-31T09:00:00.000Z',
    endedAt: '2026-07-31T09:12:00.000Z',
    reviewed: 20,
    recalled: 17,
    activeMs: 720_000,
    device: 'iPhone',
    ...overrides,
  });

  it('records a sitting and lists it back', async () => {
    const harness = start();
    const account = await withAccount(harness);

    const posted = await harness.call('POST', '/study-sessions', {
      token: account.token,
      body: sitting('s1'),
    });
    expect(posted.status).toBe(200);

    const { body } = await harness.call('GET', '/study-sessions', { token: account.token });
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({ id: 's1', reviewed: 20, device: 'iPhone' });
  });

  it('accepts a batch, which is how a device catches up after being offline', async () => {
    const harness = start();
    const account = await withAccount(harness);

    await harness.call('POST', '/study-sessions', {
      token: account.token,
      body: { sessions: [sitting('s1'), sitting('s2'), sitting('s3')] },
    });

    const { body } = await harness.call('GET', '/study-sessions', { token: account.token });
    expect(body.sessions).toHaveLength(3);
  });

  it('merges rather than duplicating when the same sitting is sent twice', async () => {
    const harness = start();
    const account = await withAccount(harness);

    await harness.call('POST', '/study-sessions', { token: account.token, body: sitting('s1') });
    await harness.call('POST', '/study-sessions', { token: account.token, body: sitting('s1') });

    const { body } = await harness.call('GET', '/study-sessions', { token: account.token });
    expect(body.sessions).toHaveLength(1);
  });

  /** An account screen reporting 130% accuracy is a bug nobody can act on later. */
  it('clamps counts that cannot be true', async () => {
    const harness = start();
    const account = await withAccount(harness);

    const { body } = await harness.call('POST', '/study-sessions', {
      token: account.token,
      body: sitting('s1', { reviewed: 10, recalled: 99, activeMs: -5 }),
    });

    expect(body.sessions[0]).toMatchObject({ reviewed: 10, recalled: 10, activeMs: 0 });
  });

  it('keeps one account history out of another', async () => {
    const harness = start();
    const mine = await withAccount(harness, 'me@example.com');
    const theirs = await withAccount(harness, 'them@example.com');

    await harness.call('POST', '/study-sessions', { token: mine.token, body: sitting('s1') });

    const { body } = await harness.call('GET', '/study-sessions', { token: theirs.token });
    expect(body.sessions).toEqual([]);
  });
});

describe('the HTTP surface itself', () => {
  it('answers preflight so a browser will make the real call', async () => {
    const harness = start();
    const response = await fetch(`${harness.url}/auth/login`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:8081' },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('reflects only allowed origins when a list is configured', async () => {
    const harness = start({ allowedOrigins: ['https://app.example.com'] });

    const allowed = await fetch(`${harness.url}/health`, { headers: { Origin: 'https://app.example.com' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example.com');

    const denied = await fetch(`${harness.url}/health`, { headers: { Origin: 'https://evil.example.com' } });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('tells caches to keep none of this', async () => {
    const harness = start();
    const response = await fetch(`${harness.url}/health`);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('separates an unknown path from a wrong method', async () => {
    const harness = start();
    expect((await harness.call('GET', '/nope')).status).toBe(404);
    expect((await harness.call('GET', '/auth/login')).status).toBe(405);
  });

  it('rejects a body larger than the limit instead of buffering it', async () => {
    const harness = start({ maxBodyBytes: { default: 512, state: 1024 } });
    const { status, body } = await harness.call('POST', '/auth/register', {
      body: { email: 'a@example.com', password: 'a long enough password', displayName: 'n'.repeat(2_000) },
    });

    expect(status).toBe(413);
    expect(body.error).toBe('payload_too_large');
  });

  it('reports malformed JSON as a bad request', async () => {
    const harness = start();
    const response = await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('bad_request');
  });

  it('serves a health check without a token', async () => {
    const harness = start();
    const { status, body } = await harness.call('GET', '/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

describe('settings, kept apart from the state blob', () => {
  it('answers with defaults before anybody has chosen anything', async () => {
    const harness = start();
    const account = await withAccount(harness);

    const { status, body } = await harness.call('GET', '/settings', { token: account.token });

    expect(status).toBe(200);
    // Never a 404: an account that has set nothing still has settings.
    expect(body).toMatchObject({ appearance: 'system', backdrop: 'calm', dayStartHour: 4 });
  });

  it('stores what it is sent, and leaves the rest alone', async () => {
    const harness = start();
    const account = await withAccount(harness);

    await harness.call('PUT', '/settings', { token: account.token, body: { appearance: 'dark' } });
    const { body } = await harness.call('PUT', '/settings', {
      token: account.token,
      body: { backdrop: 'living' },
    });

    // A patch is a patch: setting the backdrop must not reset the appearance.
    expect(body).toMatchObject({ appearance: 'dark', backdrop: 'living', dayStartHour: 4 });
  });

  it('clamps rather than refusing, so one bad field cannot brick the screen', async () => {
    const harness = start();
    const account = await withAccount(harness);

    const { status, body } = await harness.call('PUT', '/settings', {
      token: account.token,
      body: { dayStartHour: 99, appearance: 'neon' },
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ dayStartHour: 23, appearance: 'system' });
  });

  it('gives a language its own settings, defaulted from that language', async () => {
    const harness = start();
    const account = await withAccount(harness);

    const { status, body } = await harness.call('GET', '/settings/languages/ja', {
      token: account.token,
    });

    expect(status).toBe(200);
    // Not HSK: the track comes from the language rather than from a constant.
    expect(body).toMatchObject({ languageCode: 'ja', examTrackId: 'jlpt' });
  });

  it('keeps one language out of another', async () => {
    const harness = start();
    const account = await withAccount(harness);

    const mandarin = await harness.call('PUT', '/settings/languages/zh', {
      token: account.token,
      body: { dailyNewLimit: 25, examDate: '2026-06-01' },
    });
    const japanese = await harness.call('GET', '/settings/languages/ja', { token: account.token });

    // Asserted so the test cannot pass by the write silently failing: if the
    // PUT 404'd, Japanese would still be at its defaults and the real check
    // below would look satisfied.
    expect(mandarin.status).toBe(200);
    expect(mandarin.body).toMatchObject({ dailyNewLimit: 25, examDate: '2026-06-01' });

    // This is the whole point of the split: an exam booked for Mandarin is not
    // an exam booked for Japanese.
    expect(japanese.body).toMatchObject({ dailyNewLimit: 10 });
    expect((japanese.body as { examDate?: string }).examDate).toBeUndefined();
  });

  it('lists only the languages that have been set', async () => {
    const harness = start();
    const account = await withAccount(harness);

    await harness.call('PUT', '/settings/languages/ko', {
      token: account.token,
      body: { dailyReviewLimit: 60 },
    });
    const { body } = await harness.call('GET', '/settings/languages', { token: account.token });

    const languages = (body as { languages: { languageCode: string }[] }).languages;
    expect(languages.map((entry) => entry.languageCode)).toEqual(['ko']);
  });

  it('404s a language the app does not teach', async () => {
    const harness = start();
    const account = await withAccount(harness);

    const { status } = await harness.call('GET', '/settings/languages/xx', {
      token: account.token,
    });

    // Not a 400: the code is part of the path, so an unknown one means the
    // resource is not there.
    expect(status).toBe(404);
  });

  it('keeps one account out of another account\u2019s settings', async () => {
    const harness = start();
    const mine = await withAccount(harness, 'mine@example.com');
    const theirs = await withAccount(harness, 'theirs@example.com');

    const written = await harness.call('PUT', '/settings', {
      token: mine.token,
      body: { appearance: 'dark' },
    });
    const { body } = await harness.call('GET', '/settings', { token: theirs.token });

    // Again: assert the write landed, or a broken PUT would make the isolation
    // check pass for the wrong reason.
    expect(written.body).toMatchObject({ appearance: 'dark' });
    expect(body).toMatchObject({ appearance: 'system' });
  });

  it('needs a token', async () => {
    const harness = start();
    const { status } = await harness.call('GET', '/settings');
    expect(status).toBe(401);
  });

  it('does not touch the state blob', async () => {
    const harness = start();
    const account = await withAccount(harness);

    await harness.call('PUT', '/settings', { token: account.token, body: { appearance: 'dark' } });
    const { body } = await harness.call('GET', '/state', { token: account.token });

    // Settings live beside the deck, not inside it. If changing a preference
    // moved the state revision, every settings change would make every other
    // device's next push conflict.
    expect(body).toMatchObject({ revision: 0, values: {} });
  });
});
