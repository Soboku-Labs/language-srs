import { describe, expect, it } from 'vitest';
import { SEED_ENTRIES } from '../data/seed';
import { DuplicateGradeError, StudyEngine } from '../engine';
import { MemoryStore } from '../storage/port';
import type { Card, LexicalEntry } from '../types/card';
import type { ReviewLog } from '../types/review';
import { addDays, fixedClock } from '../utils/date';
import { mergeRemoteState, prunePushed, unpushedReviews } from './index';

const NOW = '2026-03-01T09:00:00.000Z';

async function makeEngine(now = NOW) {
  return StudyEngine.create({
    store: new MemoryStore(),
    seedEntries: SEED_ENTRIES,
    clock: fixedClock(now),
  });
}

const log = (id: string, reviewedAt: string): ReviewLog => ({
  id,
  cardId: 'zh-nihao:recognition',
  entryId: 'zh-nihao',
  reviewedAt,
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
  durationMs: 3000,
  source: 'app',
});

const card = (id: string, due: string): Card => ({
  id,
  entryId: id.split(':')[0]!,
  languageCode: 'zh',
  levelId: 'hsk3-1',
  kind: 'recognition',
  state: 'review',
  stability: 10,
  difficulty: 5,
  step: 0,
  due,
  scheduledDays: 10,
  reps: 3,
  lapses: 0,
  elapsedMs: 9000,
  createdAt: NOW,
});

describe('mergeRemoteState', () => {
  it('lets the server’s card win, because the client cannot reproduce it', () => {
    const local = {
      cards: [card('zh-nihao:recognition', '2026-03-10T09:00:00.000Z')],
      logs: [],
      entries: [],
    };

    const merged = mergeRemoteState(local, {
      cards: [card('zh-nihao:recognition', '2026-03-14T09:00:00.000Z')],
      profiles: [],
      entries: [],
      reviews: [],
    });

    // Not "the later due date" or "the higher reps" — the server's, whatever it
    // says. Fuzzed due dates mean both sides are plausible and only one can be
    // the answer.
    expect(merged.cards).toHaveLength(1);
    expect(merged.cards[0]?.due).toBe('2026-03-14T09:00:00.000Z');
    expect(merged.result.cards).toBe(1);
  });

  it('unions reviews by id and keeps them in the order they happened', () => {
    const merged = mergeRemoteState(
      { cards: [], logs: [log('r_b', '2026-03-02T09:00:00.000Z')], entries: [] },
      {
        cards: [],
        profiles: [],
        entries: [],
        reviews: [log('r_a', '2026-03-01T09:00:00.000Z'), log('r_c', '2026-03-03T09:00:00.000Z')],
      },
    );

    expect(merged.logs.map((entry) => entry.id)).toEqual(['r_a', 'r_b', 'r_c']);
    expect(merged.result.reviews).toBe(2);
  });

  it('keeps a review the server has not seen, rather than dropping it', () => {
    // A pull can land before a push succeeds — a flaky connection, or a crash
    // between the two. Discarding the local-only review would delete work the
    // learner actually did, and nothing would report it.
    const merged = mergeRemoteState(
      { cards: [], logs: [log('r_local', '2026-03-04T09:00:00.000Z')], entries: [] },
      { cards: [], profiles: [], entries: [], reviews: [log('r_server', '2026-03-01T09:00:00.000Z')] },
    );

    expect(merged.logs.map((entry) => entry.id)).toEqual(['r_server', 'r_local']);
  });

  it('counts a review it already had as nothing new', () => {
    const existing = log('r_same', '2026-03-02T09:00:00.000Z');
    const merged = mergeRemoteState(
      { cards: [], logs: [existing], entries: [] },
      { cards: [], profiles: [], entries: [], reviews: [existing] },
    );

    expect(merged.logs).toHaveLength(1);
    expect(merged.result.reviews).toBe(0);
  });

  it('merges imported entries, which are the part of a deck a lost device loses', () => {
    const mine: LexicalEntry = {
      id: 'custom-1',
      languageCode: 'zh',
      target: '門口',
      reading: 'ménkǒu',
      meanings: ['doorway'],
      levelIds: ['hsk3-1'],
      examples: [],
      tags: [],
    };

    const merged = mergeRemoteState(
      { cards: [], logs: [], entries: [] },
      { cards: [], profiles: [], entries: [mine], reviews: [] },
    );

    expect(merged.entries).toHaveLength(1);
    expect(merged.result.entries).toBe(1);
  });
});

describe('unpushedReviews', () => {
  it('is everything when nothing has been pushed', () => {
    const logs = [log('r_a', NOW), log('r_b', NOW)];
    expect(unpushedReviews(logs, new Set())).toHaveLength(2);
  });

  it('skips what has been pushed', () => {
    const logs = [log('r_a', NOW), log('r_b', NOW)];
    expect(unpushedReviews(logs, new Set(['r_a'])).map((entry) => entry.id)).toEqual(['r_b']);
  });

  it('still sends a review that arrived out of order', () => {
    /*
     * The case a timestamp high-water mark silently loses.
     *
     * A widget tap is recorded offline and replayed later with its original
     * instant, so a review from three hours ago lands in the log after newer ones
     * have already been pushed. Under a mark it reads as "already sent" and is
     * never sent at all.
     */
    const logs = [
      log('r_new', '2026-03-01T12:00:00.000Z'),
      log('r_late', '2026-03-01T09:00:00.000Z'),
    ];

    expect(unpushedReviews(logs, new Set(['r_new'])).map((entry) => entry.id)).toEqual(['r_late']);
  });
});

describe('prunePushed', () => {
  it('forgets ids whose reviews have aged out of the local log', () => {
    const logs = [log('r_b', NOW)];
    expect([...prunePushed(['r_a', 'r_b'], logs)]).toEqual(['r_b']);
  });
});

describe('idempotent grading', () => {
  it('replays a grading under the id it was given elsewhere', async () => {
    const engine = await makeEngine();
    const cardId = engine.getQueue().cards[0]!.card.id;

    const result = await engine.grade(cardId, 3, { logId: 'r_from_the_phone' });

    expect(result.log.id).toBe('r_from_the_phone');
    expect(engine.hasReviewLog('r_from_the_phone')).toBe(true);
  });

  it('refuses the same grading twice, which is what makes a retry safe', async () => {
    const engine = await makeEngine();
    const cardId = engine.getQueue().cards[0]!.card.id;

    await engine.grade(cardId, 3, { logId: 'r_once' });
    await expect(engine.grade(cardId, 3, { logId: 'r_once' })).rejects.toThrow(DuplicateGradeError);

    // And the second attempt changed nothing: one review, one rep.
    expect(engine.getReviewLogs().filter((entry) => entry.id === 'r_once')).toHaveLength(1);
    const card = engine.getAllCards('zh').find((candidate) => candidate.id === cardId);
    expect(card?.reps).toBe(1);
  });

  it('still mints an id when none is supplied', async () => {
    const engine = await makeEngine();
    const cardId = engine.getQueue().cards[0]!.card.id;

    const result = await engine.grade(cardId, 3);
    expect(result.log.id).toMatch(/^r_/);
  });
});

describe('applyRemoteState', () => {
  it('takes the server’s cards, reviews and entries, and persists them', async () => {
    const store = new MemoryStore();
    const engine = await StudyEngine.create({ store, seedEntries: SEED_ENTRIES, clock: fixedClock(NOW) });
    const existing = engine.getAllCards('zh')[0]!;

    const result = await engine.applyRemoteState({
      cards: [{ ...existing, due: addDays(NOW, 30), reps: 9, stability: 42 }],
      profiles: [{ ...engine.getProfile('zh'), dailyNewLimit: 33 }],
      entries: [],
      reviews: [log('r_elsewhere', '2026-02-28T09:00:00.000Z')],
    });

    expect(result.cards).toBe(1);
    expect(result.reviews).toBe(1);

    const updated = engine.getAllCards('zh').find((card) => card.id === existing.id);
    expect(updated?.reps).toBe(9);
    expect(updated?.stability).toBe(42);
    expect(engine.getProfile('zh').dailyNewLimit).toBe(33);
    expect(engine.hasReviewLog('r_elsewhere')).toBe(true);

    // Persisted, not just held: a reload has to agree.
    const reopened = await StudyEngine.create({ store, seedEntries: SEED_ENTRIES, clock: fixedClock(NOW) });
    expect(reopened.getAllCards('zh').find((card) => card.id === existing.id)?.reps).toBe(9);
    expect(reopened.hasReviewLog('r_elsewhere')).toBe(true);
    expect(reopened.getProfile('zh').dailyNewLimit).toBe(33);
  });

  it('does not lose a card the remote deck did not mention', async () => {
    const engine = await makeEngine();
    const before = engine.getAllCards('zh').length;
    const one = engine.getAllCards('zh')[0]!;

    await engine.applyRemoteState({
      cards: [{ ...one, reps: 4 }],
      profiles: [],
      entries: [],
      reviews: [],
    });

    // A partial card list is a partial card list, not a deletion instruction.
    expect(engine.getAllCards('zh').length).toBe(before);
  });

  it('generates cards for vocabulary that arrived with the pull', async () => {
    const engine = await makeEngine();
    const before = engine.getAllCards('zh').length;

    await engine.applyRemoteState({
      cards: [],
      profiles: [],
      entries: [
        {
          id: 'pulled-1',
          languageCode: 'zh',
          target: '門票',
          reading: 'ménpiào',
          meanings: ['entrance ticket'],
          levelIds: ['hsk3-1'],
          examples: [],
          tags: [],
        },
      ],
      reviews: [],
    });

    // A word that arrives from another device has to become studiable here, or
    // syncing a deck would sync everything about it except the point.
    expect(engine.getAllCards('zh').length).toBeGreaterThan(before);
    expect(engine.getEntry('pulled-1')?.target).toBe('門票');
  });

  it('follows the active language the learner chose on another device', async () => {
    const engine = await makeEngine();
    expect(engine.activeLanguage).toBe('zh');

    await engine.applyRemoteState({
      cards: [],
      profiles: [{ ...engine.getProfile('zh'), languageCode: 'ja', examTrackId: 'jlpt', targetLevelId: 'jlpt-n5' }],
      activeLanguage: 'ja',
      entries: [],
      reviews: [],
    });

    expect(engine.activeLanguage).toBe('ja');
    expect(engine.studiedLanguages).toContain('ja');
  });
});
