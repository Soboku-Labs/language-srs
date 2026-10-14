import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

/**
 * The API, exercised over a real socket.
 *
 * Through `fetch` rather than by calling handlers, because the things most
 * likely to break are the parts a direct call skips: status codes, the bearer
 * header, JSON parsing, and the route table itself.
 */

let dataDir: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let base: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'srs-server-'));
  server = createApp({ dataDir, allowedOrigins: ['*'] }).listen(0);
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dataDir, { recursive: true, force: true });
});

const call = async (
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
) => {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
};

async function signedIn(email = 'vish@example.com') {
  const { body } = await call('/auth/register', { body: { email, password: 'hunter2!!' } });
  return body.token as string;
}

describe('accounts', () => {
  it('registers, and hands back a usable session', async () => {
    const { status, body } = await call('/auth/register', {
      body: { email: 'vish@example.com', password: 'hunter2!!', displayName: 'Vish' },
    });

    expect(status).toBe(201);
    expect(body.account.email).toBe('vish@example.com');
    expect(body.account.displayName).toBe('Vish');
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });

  it('never stores the password', async () => {
    await signedIn();
    const { body } = await call('/auth/sign-in', {
      body: { email: 'vish@example.com', password: 'hunter2!!' },
    });
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('refuses a weak password and a malformed address before creating anything', async () => {
    expect((await call('/auth/register', { body: { email: 'a@b.co', password: 'short' } })).status).toBe(422);
    expect((await call('/auth/register', { body: { email: 'nope', password: 'hunter2!!' } })).status).toBe(400);
  });

  it('refuses a second account on the same email', async () => {
    await signedIn();
    const { status, body } = await call('/auth/register', {
      body: { email: 'vish@example.com', password: 'hunter2!!' },
    });
    expect(status).toBe(409);
    expect(body.code).toBe('email-taken');
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    // Different answers turn the endpoint into an oracle for which addresses
    // are registered.
    await signedIn();
    const wrong = await call('/auth/sign-in', { body: { email: 'vish@example.com', password: 'nope12345' } });
    const absent = await call('/auth/sign-in', { body: { email: 'ghost@example.com', password: 'nope12345' } });

    expect(wrong.status).toBe(401);
    expect(absent.status).toBe(401);
    expect(wrong.body.code).toBe(absent.body.code);
    expect(wrong.body.message).toBe(absent.body.message);
  });

  it('rotates the refresh token, so a leaked one stops working', async () => {
    const { body: first } = await call('/auth/register', {
      body: { email: 'vish@example.com', password: 'hunter2!!' },
    });

    const { status, body: second } = await call('/auth/refresh', {
      body: { refreshToken: first.refreshToken },
    });
    expect(status).toBe(200);
    expect(second.token).not.toBe(first.token);

    expect((await call('/auth/refresh', { body: { refreshToken: first.refreshToken } })).status).toBe(401);
  });

  it('ends a session on sign-out', async () => {
    const token = await signedIn();
    expect((await call('/study/state', { token })).status).toBe(200);

    // Asserted, because a 500 here still destroyed the session and the test
    // that only checked the next request passed while the response was broken.
    expect((await call('/auth/sign-out', { method: 'POST', token })).status).toBe(204);
    expect((await call('/study/state', { token })).status).toBe(401);
  });

  it('turns away an unauthenticated or forged caller', async () => {
    expect((await call('/study/state')).status).toBe(401);
    expect((await call('/study/state', { token: 'made-up' })).status).toBe(401);
  });
});

describe('the study surface', () => {
  it('answers a home screen in one round trip', async () => {
    const token = await signedIn();
    const { status, body } = await call('/study/state', { token });

    expect(status).toBe(200);
    // Everything the dashboard renders, so a client on a train shows one
    // loading state rather than six.
    expect(body.profile.languageCode).toBe('zh');
    expect(body.journey.stage.native).toBe('立春');
    expect(body.goal.target).toBeGreaterThan(0);
    expect(body.stats.coverage.available).toBeGreaterThan(0);
    expect(body.queue.breakdown.fresh).toBeGreaterThan(0);
  });

  it('serves cards with their entries, so the client needs no second lookup', async () => {
    const token = await signedIn();
    const { body } = await call('/study/queue?limit=3', { token });

    expect(body.cards).toHaveLength(3);
    expect(body.cards[0].card.id).toBeTruthy();
    expect(body.cards[0].entry.target).toBeTruthy();
  });

  it('records a grading and moves the day along', async () => {
    const token = await signedIn();
    const { body: queue } = await call('/study/queue?limit=1', { token });
    const cardId = queue.cards[0].card.id;

    const { status, body } = await call('/study/grades', {
      token,
      body: { cardId, rating: 3, durationMs: 4200 },
    });

    expect(status).toBe(200);
    expect(body.applied).toBe(1);
    expect(body.goal.done).toBe(1);
    expect(body.journey).toBeTruthy();
  });

  it('keeps two accounts entirely apart', async () => {
    const mine = await signedIn('mine@example.com');
    const yours = await signedIn('yours@example.com');

    const { body: queue } = await call('/study/queue?limit=1', { token: mine });
    await call('/study/grades', { token: mine, body: { cardId: queue.cards[0].card.id, rating: 3 } });

    expect((await call('/study/state', { token: mine })).body.goal.done).toBe(1);
    expect((await call('/study/state', { token: yours })).body.goal.done).toBe(0);
  });

  it('survives a restart', async () => {
    const token = await signedIn();
    const { body: queue } = await call('/study/queue?limit=1', { token });
    await call('/study/grades', { token, body: { cardId: queue.cards[0].card.id, rating: 3 } });

    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createApp({ dataDir, allowedOrigins: ['*'] }).listen(0);
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    expect((await call('/study/state', { token })).body.goal.done).toBe(1);
  });
});

describe('studying offline, and syncing later', () => {
  it('replays a batch at the instants it actually happened', async () => {
    // The whole reason the endpoint takes a batch. A commute's worth of reviews
    // graded at the moment the signal returned would tell the scheduler the
    // learner waited three hours between cards.
    const token = await signedIn();
    const { body: queue } = await call('/study/queue?limit=3', { token });

    const grades = queue.cards.map((pair: { card: { id: string } }, index: number) => ({
      cardId: pair.card.id,
      rating: 3,
      gradedAt: new Date(Date.now() - (30 - index) * 60_000).toISOString(),
      durationMs: 3000,
    }));

    const { status, body } = await call('/study/grades', { token, body: { grades } });
    expect(status).toBe(200);
    expect(body.applied).toBe(3);
    expect(body.failed).toEqual([]);
    expect(body.goal.done).toBe(3);
  });

  it('applies a batch in time order whatever order it arrived in', async () => {
    const token = await signedIn();
    const { body: queue } = await call('/study/queue?limit=1', { token });
    const cardId = queue.cards[0].card.id;

    const early = new Date(Date.now() - 60 * 60_000).toISOString();
    const late = new Date(Date.now() - 30 * 60_000).toISOString();

    // Sent newest first, as a client popping a stack would.
    await call('/study/grades', {
      token,
      body: { grades: [{ cardId, rating: 3, gradedAt: late }, { cardId, rating: 1, gradedAt: early }] },
    });

    // The later grading is the one that decides where the card ended up, so a
    // card failed then passed must not be left in the failed state.
    const { body: deck } = await call('/study/deck', { token });
    const row = deck.deck.find((candidate: { entry: { id: string } }) =>
      cardId.startsWith(candidate.entry.id),
    );
    expect(row.status).not.toBe('new');
  });

  it('keeps the rest of a batch when one card is unknown', async () => {
    const token = await signedIn();
    const { body: queue } = await call('/study/queue?limit=2', { token });

    const { body } = await call('/study/grades', {
      token,
      body: {
        grades: [
          { cardId: queue.cards[0].card.id, rating: 3 },
          { cardId: 'deleted:recognition', rating: 3 },
          { cardId: queue.cards[1].card.id, rating: 3 },
        ],
      },
    });

    expect(body.applied).toBe(2);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].cardId).toBe('deleted:recognition');
  });

  it('refuses a grading the scheduler could not use', async () => {
    const token = await signedIn();
    expect((await call('/study/grades', { token, body: { cardId: 'x', rating: 9 } })).status).toBe(400);
    expect((await call('/study/grades', { token, body: { rating: 3 } })).status).toBe(400);
    expect(
      (await call('/study/grades', { token, body: { cardId: 'x', rating: 3, gradedAt: 'soon' } })).status,
    ).toBe(400);
  });
});

describe('vocabulary', () => {
  it('parses a word list server-side, so no client needs a CSV reader', async () => {
    const token = await signedIn();
    const text = [
      'zh-pingguo,苹果,píngguǒ,apple,hsk3-1,noun,2;3,,,food,880',
      'zh-bad,,bǎd,nothing,hsk3-1,noun,,,,,',
    ].join('\n');

    const { status, body } = await call('/study/import', {
      token,
      body: { text, format: 'csv', languageCode: 'zh', defaultLevelId: 'hsk3-1' },
    });

    expect(status).toBe(200);
    expect(body.added).toBe(1);
    expect(body.rejected).toBe(1);
    // The row number is the part a learner can act on.
    expect(body.issues[0].row).toBe(2);
  });

  it('reports a list with nothing usable rather than failing the request', async () => {
    const token = await signedIn();
    const { status, body } = await call('/study/import', {
      token,
      body: { text: ',,,,\n', format: 'csv', languageCode: 'zh', defaultLevelId: 'hsk3-1' },
    });

    expect(status).toBe(200);
    expect(body.added).toBe(0);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('saves a note against a word', async () => {
    const token = await signedIn();
    const { body } = await call('/study/note', {
      token,
      body: { entryId: 'zh-nihao', note: 'knee how' },
    });
    expect(body.entry.mnemonic).toBe('knee how');
  });
});

describe('card actions', () => {
  it('suspends, buries and resets through one route', async () => {
    const token = await signedIn();
    const { body: queue } = await call('/study/queue?limit=1', { token });
    const cardId = queue.cards[0].card.id;
    const path = `/study/cards/${encodeURIComponent(cardId)}/action`;

    expect((await call(path, { token, body: { action: 'suspend' } })).status).toBe(200);
    expect((await call(path, { token, body: { action: 'unsuspend' } })).status).toBe(200);
    expect((await call(path, { token, body: { action: 'bury' } })).status).toBe(200);
    expect((await call(path, { token, body: { action: 'reset' } })).status).toBe(200);
  });

  it('names the actions it understands rather than failing silently', async () => {
    const token = await signedIn();
    const { status, body } = await call('/study/cards/x/action', { token, body: { action: 'explode' } });
    expect(status).toBe(400);
    expect(body.message).toContain('suspend');
  });
});

describe('the edges', () => {
  it('answers a health check without a token', async () => {
    expect((await call('/health')).status).toBe(200);
  });

  it('404s an unknown route', async () => {
    expect((await call('/nope', { token: await signedIn() })).status).toBe(404);
  });

  it('rejects a body that is not JSON', async () => {
    const response = await fetch(`${base}/auth/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    expect(response.status).toBe(400);
  });

  it('rejects an unknown language rather than silently using another', async () => {
    const token = await signedIn();
    expect((await call('/study/state?language=xx', { token })).status).toBe(400);
  });

  it('answers a CORS preflight', async () => {
    const response = await fetch(`${base}/study/state`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://example.com');
  });
});
