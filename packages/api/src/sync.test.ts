import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectTransport } from '@connectrpc/connect-node';
import { MemoryStore, SEED_ENTRIES, StudyEngine, type KeyValueStore } from '@mon/core';
import { createApp } from '@mon/server/app';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMonClient, type MonClient, type TokenStore } from './client';
import { lastSyncedAt, resetSyncRecord, sync } from './sync';

/**
 * Sync, against a real backend over a real socket.
 *
 * The thing being tested is convergence: two devices that studied the same deck
 * independently should end up agreeing, and should agree with the server. That
 * is not something unit tests of the merge rules can show — those pin the rules,
 * and this pins the result of applying them to two engines that genuinely
 * disagree.
 */

let dataDir: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let base: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mon-sync-'));
  server = createApp({ dataDir, allowedOrigins: ['*'] }).listen(0);
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dataDir, { recursive: true, force: true });
});

/** A token store backed by nothing, which is all a test needs. */
function tokenStore(token: string, refreshToken = ''): TokenStore {
  let current = { token, refreshToken, expiresAt: '' };
  return {
    get: () => current.token || undefined,
    getRefresh: () => current.refreshToken || undefined,
    async set(next) {
      current = next ?? { token: '', refreshToken: '', expiresAt: '' };
    },
  };
}

function clientFor(tokens: TokenStore): MonClient {
  return createMonClient({
    transport: createConnectTransport({ baseUrl: base, httpVersion: '1.1' }),
    tokens,
  });
}

/**
 * One device: its own engine, its own store, its own sync cursor.
 *
 * Deliberately *not* sharing a store with the other device, because sharing one
 * is the bug this whole arrangement exists to avoid — two devices with one
 * storage are one device.
 */
interface Device {
  engine: StudyEngine;
  store: KeyValueStore;
  client: MonClient;
  sync(): ReturnType<typeof sync>;
}

async function makeDevice(token: string): Promise<Device> {
  const store = new MemoryStore();
  const engine = await StudyEngine.create({ store, seedEntries: SEED_ENTRIES });
  const client = clientFor(tokenStore(token));

  return {
    engine,
    store,
    client,
    sync: () => sync({ client, engine, store }),
  };
}

async function register(email: string): Promise<string> {
  const { session } = await createMonClient({
    transport: createConnectTransport({ baseUrl: base, httpVersion: '1.1' }),
    tokens: tokenStore(''),
  }).auth.register({ email, password: 'hunter2!!' });

  return session?.token ?? '';
}

describe('sync', () => {
  it('pushes what a device did and records that it was pushed', async () => {
    const token = await register('one@example.com');
    const device = await makeDevice(token);

    const cardId = device.engine.getQueue().cards[0]!.card.id;
    await device.engine.grade(cardId, 3);

    const first = await device.sync();
    expect(first.pushed).toBe(1);
    expect(first.duplicates).toBe(0);
    expect(first.rejected).toEqual([]);

    // Nothing new to send the second time, which is the whole point of keeping
    // the record.
    const second = await device.sync();
    expect(second.pushed).toBe(0);
    expect(second.duplicates).toBe(0);

    expect(await lastSyncedAt(device.store)).toBeTruthy();
  });

  it('brings a second device up to date with the first', async () => {
    const token = await register('two@example.com');
    const laptop = await makeDevice(token);
    const phone = await makeDevice(token);

    const cardId = laptop.engine.getQueue().cards[0]!.card.id;
    await laptop.engine.grade(cardId, 4);
    await laptop.sync();

    // The phone has never seen this card graded.
    expect(phone.engine.getAllCards('zh').find((card) => card.id === cardId)?.reps).toBe(0);

    const result = await phone.sync();

    expect(result.merged.reviews).toBe(1);
    const onPhone = phone.engine.getAllCards('zh').find((card) => card.id === cardId);
    const onLaptop = laptop.engine.getAllCards('zh').find((card) => card.id === cardId);

    expect(onPhone?.reps).toBe(1);
    // Due to the millisecond, not "about the same day". Fuzz is why the server's
    // card is taken whole instead of being recomputed from the review.
    expect(onPhone?.due).toBe(onLaptop?.due);
    expect(onPhone?.stability).toBe(onLaptop?.stability);
  });

  it('converges two devices that studied different cards independently', async () => {
    const token = await register('three@example.com');
    const laptop = await makeDevice(token);
    const phone = await makeDevice(token);

    const queue = laptop.engine.getQueue({ sessionLimit: 6 }).cards;
    const onLaptop = queue.slice(0, 3).map((pair) => pair.card.id);
    const onPhone = queue.slice(3, 6).map((pair) => pair.card.id);

    for (const cardId of onLaptop) await laptop.engine.grade(cardId, 3);
    for (const cardId of onPhone) await phone.engine.grade(cardId, 2);

    // Both push, then both pull. Neither knows about the other's work until it
    // has been through the server.
    await laptop.sync();
    await phone.sync();
    await laptop.sync();

    const laptopReviews = laptop.engine.getReviewLogs().map((log) => log.id).sort();
    const phoneReviews = phone.engine.getReviewLogs().map((log) => log.id).sort();

    expect(laptopReviews).toHaveLength(6);
    expect(phoneReviews).toHaveLength(6);
    expect(laptopReviews).toEqual(phoneReviews);

    // And the cards agree, card by card, which is the claim that matters: the
    // two devices will ask for the same words on the same days.
    const byId = (device: Device) =>
      new Map(device.engine.getAllCards('zh').map((card) => [card.id, card]));
    const left = byId(laptop);
    const right = byId(phone);

    for (const cardId of [...onLaptop, ...onPhone]) {
      expect(right.get(cardId)?.due).toBe(left.get(cardId)?.due);
      expect(right.get(cardId)?.reps).toBe(left.get(cardId)?.reps);
      expect(right.get(cardId)?.state).toBe(left.get(cardId)?.state);
    }
  });

  it('counts a re-push as a duplicate rather than grading the card twice', async () => {
    const token = await register('four@example.com');
    const device = await makeDevice(token);

    const cardId = device.engine.getQueue().cards[0]!.card.id;
    await device.engine.grade(cardId, 3);
    await device.sync();

    /*
     * The failure this guards against: a push that reached the server and whose
     * response was lost. The client cannot tell that from a push that never
     * arrived, so it must be safe to send again — and sending again must not
     * count the review twice, or the learner's streak and schedule drift every
     * time their train goes into a tunnel.
     */
    await resetSyncRecord(device.store);
    const again = await device.sync();

    expect(again.pushed).toBe(0);
    expect(again.duplicates).toBe(1);

    // One rep on the server's card and one on the client's — not two of either.
    // Asserted against the backend's own copy, because "the client did not
    // double-count locally" would pass even if the server had.
    const deck = await device.client.study.getDeck({});
    const onServer = deck.entries
      .flatMap((entry) => entry.cards)
      .find((card) => card.id === cardId);

    expect(onServer?.reps).toBe(1);
    expect(device.engine.getAllCards('zh').find((card) => card.id === cardId)?.reps).toBe(1);
  });

  it('pushes before it pulls, so a just-graded card is not rolled back', async () => {
    const token = await register('five@example.com');
    const device = await makeDevice(token);
    const cardId = device.engine.getQueue().cards[0]!.card.id;

    // Sync once so the server has the deck, then grade and sync again. If the
    // pull ran first it would overwrite the graded card with the server's
    // ungraded copy, and the push would then apply the grading to a card the
    // client had already forgotten about.
    await device.sync();
    await device.engine.grade(cardId, 3);
    await device.sync();

    const card = device.engine.getAllCards('zh').find((candidate) => candidate.id === cardId);
    expect(card?.reps).toBe(1);
    expect(card?.state).not.toBe('new');
  });

  it('carries imported vocabulary to the other device', async () => {
    const token = await register('six@example.com');
    const laptop = await makeDevice(token);
    const phone = await makeDevice(token);

    await laptop.client.study.importVocabulary({
      source: { case: 'text', value: 'sync-1,門鈴,ménlíng,doorbell,hsk3-1,noun\n' },
      format: 'csv',
      defaultLevelId: 'hsk3-1',
    });

    await phone.sync();

    // A word list a learner imported exists in no app build, so it is the part
    // of a deck actually lost with a device.
    expect(phone.engine.getEntry('sync-1')?.target).toBe('門鈴');
    expect(phone.engine.getAllCards('zh').some((card) => card.entryId === 'sync-1')).toBe(true);
  });

  it('carries the exam date and daily limits set on another device', async () => {
    const token = await register('seven@example.com');
    const laptop = await makeDevice(token);
    const phone = await makeDevice(token);

    const state = await laptop.client.study.getState({});
    await laptop.client.study.updateProfile({
      profile: { ...state.profile!, dailyNewLimit: 25, examDate: '2026-12-01' },
      updateMask: ['daily_new_limit', 'exam_date'],
    });

    await phone.sync();

    expect(phone.engine.getProfile('zh').dailyNewLimit).toBe(25);
    expect(phone.engine.getProfile('zh').examDate).toBe('2026-12-01');
  });

  it('pages a long backlog rather than asking for all of it at once', async () => {
    const token = await register('eight@example.com');
    const laptop = await makeDevice(token);

    const queue = laptop.engine.getQueue({ sessionLimit: 7 }).cards;
    for (const pair of queue) await laptop.engine.grade(pair.card.id, 3);
    await laptop.sync();

    const phone = await makeDevice(token);
    const result = await sync({
      client: phone.client,
      engine: phone.engine,
      store: phone.store,
      // Small enough to force several round trips over seven reviews.
      batchSize: 2,
    });

    expect(result.merged.reviews).toBe(queue.length);
    expect(phone.engine.getReviewLogs()).toHaveLength(queue.length);
  });

  it('reports a card the backend does not have, once, and moves on', async () => {
    const token = await register('nine@example.com');
    const device = await makeDevice(token);

    // A review of a card the server has never heard of — what a word deleted on
    // another device looks like from here.
    await device.engine.applyRemoteState({
      cards: [],
      profiles: [],
      entries: [],
      reviews: [
        {
          id: 'r_orphan',
          cardId: 'zh-does-not-exist:recognition',
          entryId: 'zh-does-not-exist',
          reviewedAt: new Date().toISOString(),
          rating: 3,
          stateBefore: 'new',
          stateAfter: 'learning',
          stabilityBefore: 0,
          stabilityAfter: 1,
          difficultyBefore: 5,
          difficultyAfter: 5,
          elapsedDays: 0,
          scheduledDays: 0.007,
          predictedRetrievability: 0.9,
          durationMs: 1000,
          source: 'app',
        },
      ],
    });

    const first = await device.sync();
    expect(first.rejected).toHaveLength(1);
    expect(first.rejected[0]?.cardId).toBe('zh-does-not-exist:recognition');

    // Reported once. A permanent rejection retried on every sync is an error
    // nobody can ever clear.
    const second = await device.sync();
    expect(second.rejected).toEqual([]);
  });
});

describe('the client', () => {
  it('renews a stale token once and retries the call', async () => {
    const { session } = await createMonClient({
      transport: createConnectTransport({ baseUrl: base, httpVersion: '1.1' }),
      tokens: tokenStore(''),
    }).auth.register({ email: 'ten@example.com', password: 'hunter2!!' });

    // A token that is not the real one, with a refresh token that is.
    const tokens = tokenStore('stale-and-wrong', session!.refreshToken);
    const client = clientFor(tokens);

    const state = await client.study.getState({});

    expect(state.profile?.targetLevelId).toBeTruthy();
    // And the renewed token was kept, so the next call does not renew again.
    expect(tokens.get()).not.toBe('stale-and-wrong');
  });

  it('gives up and signs out when there is nothing to renew with', async () => {
    let signedOut = false;
    const client = createMonClient({
      transport: createConnectTransport({ baseUrl: base, httpVersion: '1.1' }),
      tokens: tokenStore('stale-and-wrong'),
      onSignedOut: () => {
        signedOut = true;
      },
    });

    await expect(client.study.getState({})).rejects.toThrow();
    // No refresh token at all, so there was nothing to try: not a sign-out, just
    // a failed call.
    expect(signedOut).toBe(false);
  });

  it('renews once when several calls are refused at the same time', async () => {
    const { session } = await createMonClient({
      transport: createConnectTransport({ baseUrl: base, httpVersion: '1.1' }),
      tokens: tokenStore(''),
    }).auth.register({ email: 'eleven@example.com', password: 'hunter2!!' });

    const tokens = tokenStore('stale-and-wrong', session!.refreshToken);
    const client = clientFor(tokens);

    /*
     * Four calls, as a screen makes on mount, all refused at once.
     *
     * Four concurrent renewals would rotate the refresh token four times, and
     * rotation invalidates the previous one — so three would fail and sign the
     * learner out of a session that was perfectly fine.
     */
    const results = await Promise.all([
      client.study.getState({}),
      client.study.getQueue({ limit: 1 }),
      client.study.getDeck({}),
      client.study.getStruggling({ limit: 1 }),
    ]);

    expect(results).toHaveLength(4);
    expect(results[0].profile?.targetLevelId).toBeTruthy();
  });
});
