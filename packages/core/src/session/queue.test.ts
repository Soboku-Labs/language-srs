import { describe, expect, it } from 'vitest';
import { generateCards } from '../cards/factory';
import { MANDARIN_SEED } from '../data/seed/mandarin';
import { JAPANESE_SEED } from '../data/seed/japanese';
import { gradeCard } from '../srs/scheduler';
import { DEFAULT_STUDY_PROFILE, type Card, type LexicalEntry, type StudyProfile } from '../types/card';
import type { ReviewLog } from '../types/review';
import { addDays } from '../utils/date';
import { buildStudyQueue, countTodaysWork, interleaveByKindWeights } from './queue';

const NOW = '2026-03-01T09:00:00.000Z';

function profile(overrides: Partial<StudyProfile> = {}): StudyProfile {
  return {
    ...DEFAULT_STUDY_PROFILE,
    languageCode: 'zh',
    examTrackId: 'hsk3',
    targetLevelId: 'hsk3-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function seedCards(entries: LexicalEntry[], scope: string[]): Card[] {
  return generateCards(entries, scope, { now: NOW });
}

describe('daily counts', () => {
  const log = (overrides: Partial<ReviewLog>): ReviewLog => ({
    id: 'r1',
    cardId: 'c1',
    entryId: 'e1',
    reviewedAt: NOW,
    rating: 3,
    stateBefore: 'review',
    stateAfter: 'review',
    stabilityBefore: 5,
    stabilityAfter: 8,
    difficultyBefore: 5,
    difficultyAfter: 5,
    elapsedDays: 5,
    scheduledDays: 8,
    predictedRetrievability: 0.9,
    durationMs: 1000,
    source: 'app',
    ...overrides,
  });

  it('separates new introductions from reviews', () => {
    const counts = countTodaysWork([log({ stateBefore: 'new' }), log({}), log({})], NOW);
    expect(counts).toEqual({ newCards: 1, reviews: 2 });
  });

  it('ignores work from previous study days', () => {
    const counts = countTodaysWork([log({ reviewedAt: addDays(NOW, -2) })], NOW);
    expect(counts.reviews).toBe(0);
  });

  it('counts a 1am session against the day it started in', () => {
    // 01:00 on the 2nd is still the 1st's study day with a 4am rollover.
    const counts = countTodaysWork([log({ reviewedAt: '2026-03-02T01:00:00.000Z' })], '2026-03-01T23:00:00.000Z');
    expect(counts.reviews).toBe(1);
  });

  it('does not count learning-step gradings as reviews', () => {
    const counts = countTodaysWork([log({ stateBefore: 'learning' }), log({ stateBefore: 'relearning' })], NOW);
    expect(counts).toEqual({ newCards: 0, reviews: 0 });
  });
});

describe('queue construction', () => {
  it('serves new cards up to the daily limit', () => {
    const cards = seedCards(MANDARIN_SEED, ['hsk3-1']);
    const queue = buildStudyQueue({ now: NOW, profile: profile({ dailyNewLimit: 5 }), cards, entries: MANDARIN_SEED });
    expect(queue.breakdown.fresh).toBe(5);
    expect(queue.cards).toHaveLength(5);
  });

  it('accounts for work already done today', () => {
    const cards = seedCards(MANDARIN_SEED, ['hsk3-1']);
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyNewLimit: 5 }),
      cards,
      entries: MANDARIN_SEED,
      done: { newCards: 4, reviews: 0 },
    });
    expect(queue.breakdown.fresh).toBe(1);
  });

  it('excludes cards from other languages', () => {
    const cards = [...seedCards(MANDARIN_SEED, ['hsk3-1']), ...seedCards(JAPANESE_SEED, ['jlpt-n5'])];
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyNewLimit: 500 }),
      cards,
      entries: [...MANDARIN_SEED, ...JAPANESE_SEED],
    });
    expect(queue.cards.every(({ card }) => card.languageCode === 'zh')).toBe(true);
  });

  it('excludes levels above the target', () => {
    const cards = seedCards(MANDARIN_SEED, ['hsk3-1', 'hsk3-2']);
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ targetLevelId: 'hsk3-1', dailyNewLimit: 500 }),
      cards,
      entries: MANDARIN_SEED,
    });
    expect(queue.cards.every(({ card }) => card.levelId === 'hsk3-1')).toBe(true);
  });

  it('excludes suspended cards and reports them', () => {
    const cards = seedCards(MANDARIN_SEED, ['hsk3-1']).map((card, index) =>
      index < 3 ? { ...card, suspended: true } : card,
    );
    const queue = buildStudyQueue({ now: NOW, profile: profile({ dailyNewLimit: 500 }), cards, entries: MANDARIN_SEED });
    expect(queue.breakdown.excluded).toBe(3);
    expect(queue.cards.some(({ card }) => card.suspended)).toBe(false);
  });

  it('excludes buried cards until the bury expires', () => {
    const cards = seedCards(MANDARIN_SEED, ['hsk3-1']).map((card) => ({
      ...card,
      buriedUntil: addDays(NOW, 1),
    }));
    expect(
      buildStudyQueue({ now: NOW, profile: profile(), cards, entries: MANDARIN_SEED }).cards,
    ).toHaveLength(0);
    expect(
      buildStudyQueue({ now: addDays(NOW, 2), profile: profile(), cards, entries: MANDARIN_SEED }).cards.length,
    ).toBeGreaterThan(0);
  });

  it('holds back reviews over the daily cap and says how many', () => {
    const graduated = seedCards(MANDARIN_SEED, ['hsk3-1']).map((card) => ({
      ...card,
      state: 'review' as const,
      stability: 5,
      difficulty: 5,
      reps: 2,
      lastReviewedAt: addDays(NOW, -6),
      due: addDays(NOW, -1),
    }));

    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyReviewLimit: 10, dailyNewLimit: 0 }),
      cards: graduated,
      entries: MANDARIN_SEED,
    });

    expect(queue.breakdown.due).toBe(10);
    expect(queue.breakdown.heldByCap).toBe(graduated.length - 10);
  });

  it('serves learning cards first and exempts them from the caps', () => {
    const all = seedCards(MANDARIN_SEED, ['hsk3-1']);
    const learning = all.slice(0, 3).map((card) => ({
      ...card,
      state: 'learning' as const,
      step: 0,
      reps: 1,
      lastReviewedAt: addDays(NOW, -1),
      due: addDays(NOW, -0.01),
    }));
    const cards = [...all.slice(3), ...learning];

    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyNewLimit: 0, dailyReviewLimit: 0 }),
      cards,
      entries: MANDARIN_SEED,
    });

    expect(queue.breakdown.learning).toBe(3);
    expect(queue.cards.slice(0, 3).every(({ card }) => card.state === 'learning')).toBe(true);
  });

  it('reports when the next card comes due if nothing is ready', () => {
    const cards = seedCards(MANDARIN_SEED, ['hsk3-1']).map((card) => ({
      ...card,
      state: 'review' as const,
      stability: 10,
      difficulty: 5,
      reps: 2,
      lastReviewedAt: NOW,
      due: addDays(NOW, 3),
    }));

    const queue = buildStudyQueue({ now: NOW, profile: profile({ dailyNewLimit: 0 }), cards, entries: MANDARIN_SEED });
    expect(queue.cards).toHaveLength(0);
    expect(queue.nextDueAt).toBe(addDays(NOW, 3));
  });

  it('honours a session limit', () => {
    const cards = seedCards(MANDARIN_SEED, ['hsk3-1']);
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyNewLimit: 500 }),
      cards,
      entries: MANDARIN_SEED,
      sessionLimit: 7,
    });
    expect(queue.cards).toHaveLength(7);
  });

  it('respects an explicit card-kind allowlist', () => {
    const cards = seedCards(MANDARIN_SEED, ['hsk3-1']);
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyNewLimit: 500, enabledCardKinds: ['recognition'] }),
      cards,
      entries: MANDARIN_SEED,
    });
    expect(queue.cards.every(({ card }) => card.kind === 'recognition')).toBe(true);
  });
});

describe('review ordering', () => {
  function dueReviews(): Card[] {
    const base = seedCards(MANDARIN_SEED, ['hsk3-1']).filter((card) => card.kind === 'recognition');
    // Same due date, very different memory strength.
    return base.slice(0, 3).map((card, index) => ({
      ...card,
      state: 'review' as const,
      difficulty: 5,
      reps: 3,
      stability: [2, 40, 10][index]!,
      lastReviewedAt: addDays(NOW, -2),
      due: addDays(NOW, -1),
    }));
  }

  it('orders by weakest memory rather than by due date', () => {
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyNewLimit: 0 }),
      cards: dueReviews(),
      entries: MANDARIN_SEED,
    });
    const stabilities = queue.cards.map(({ card }) => card.stability);
    expect(stabilities).toEqual([...stabilities].sort((a, b) => a - b));
  });

  it('reorders by recall projected to exam day once an exam is booked', () => {
    // Stability 40 is comfortable today but will have decayed by a distant exam;
    // ordering by projected recall is what surfaces it.
    const cards = dueReviews();
    const withExam = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyNewLimit: 0, examDate: '2026-06-01' }),
      cards,
      entries: MANDARIN_SEED,
    });
    const projected = withExam.cards.map(({ card }) => card.stability);
    expect(projected[0]).toBe(2);
    expect(projected).toEqual([...projected].sort((a, b) => a - b));
  });
});

describe('kind interleaving', () => {
  it('approximates the exam weights in the session mix', () => {
    const cards = seedCards(MANDARIN_SEED, ['hsk3-1']);
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyNewLimit: 60 }),
      cards,
      entries: MANDARIN_SEED,
    });

    // HSK 3.0 level 1 weights recognition heaviest, then listening and tone.
    const mix = queue.kindMix;
    expect((mix.recognition ?? 0)).toBeGreaterThan(0);
    expect(Object.keys(mix).length).toBeGreaterThan(1);
    expect((mix.recognition ?? 0)).toBeGreaterThanOrEqual(mix.script ?? 0);
  });

  it('does not put every card of one kind together', () => {
    const cards = seedCards(MANDARIN_SEED, ['hsk3-1']);
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyNewLimit: 60 }),
      cards,
      entries: MANDARIN_SEED,
    });
    const kinds = queue.cards.slice(0, 8).map(({ card }) => card.kind);
    expect(new Set(kinds).size).toBeGreaterThan(1);
  });

  it('keeps the input order when only one kind carries weight', () => {
    const cards = seedCards(MANDARIN_SEED, ['hsk3-1']).slice(0, 4);
    const pairs = cards.map((card) => ({ card, entry: MANDARIN_SEED[0]! }));
    expect(interleaveByKindWeights(pairs, { recognition: 1 })).toEqual(pairs);
  });

  it('degrades gracefully when a weighted kind has no cards left', () => {
    const cards = seedCards(MANDARIN_SEED, ['hsk3-1']).filter((card) => card.kind === 'recognition');
    const pairs = cards.map((card) => ({ card, entry: MANDARIN_SEED[0]! }));
    const result = interleaveByKindWeights(pairs, { recognition: 1, listening: 5, tone: 5 });
    expect(result).toHaveLength(pairs.length);
  });
});

describe('end-to-end session', () => {
  it('drains the queue as cards are graded and does not re-serve them the same day', () => {
    let cards = seedCards(MANDARIN_SEED, ['hsk3-1']);
    const settings = profile({ dailyNewLimit: 4 });
    const logs: ReviewLog[] = [];

    const first = buildStudyQueue({ now: NOW, profile: settings, cards, entries: MANDARIN_SEED });
    expect(first.cards).toHaveLength(4);

    for (const { card } of first.cards) {
      const result = gradeCard(card, 3, { now: NOW, config: { fuzz: false } });
      cards = cards.map((candidate) => (candidate.id === card.id ? result.card : candidate));
      logs.push(result.log);
    }

    const second = buildStudyQueue({
      now: NOW,
      profile: settings,
      cards,
      entries: MANDARIN_SEED,
      done: countTodaysWork(logs, NOW),
    });

    // Allowance spent, so no new cards; the four graded ones are on minute-scale
    // learning steps and not yet due.
    expect(second.breakdown.fresh).toBe(0);
    expect(second.breakdown.learning).toBe(0);
  });
});

describe('study modes', () => {
  /** A deck where every card is in review state and none is due for days. */
  function matureDeck(): Card[] {
    return seedCards(MANDARIN_SEED, ['hsk3-1']).map((card, index) => ({
      ...card,
      state: 'review' as const,
      reps: 4,
      stability: 10 + index,
      difficulty: 5,
      lastReview: NOW,
      due: addDays(NOW, 5 + index),
    }));
  }

  it('serves nothing in the default mode when nothing is due', () => {
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile(),
      cards: matureDeck(),
      entries: MANDARIN_SEED,
    });
    expect(queue.cards).toHaveLength(0);
    expect(queue.nextDueAt).toBeDefined();
  });

  it('reaches past the due date when cramming', () => {
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile(),
      cards: matureDeck(),
      entries: MANDARIN_SEED,
      mode: 'cram',
    });
    expect(queue.cards.length).toBeGreaterThan(0);
  });

  it('orders a cram session weakest first', () => {
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile(),
      cards: matureDeck(),
      entries: MANDARIN_SEED,
      mode: 'cram',
      // One kind only, so the exam-weight interleave cannot reorder the result
      // and hide what is being asserted.
      kinds: ['recognition'],
    });

    const stabilities = queue.cards.map(({ card }) => card.stability);
    expect(stabilities).toEqual([...stabilities].sort((a, b) => a - b));
  });

  it('ignores the daily review cap when cramming, but not the new-card cap', () => {
    const cards = matureDeck();
    const settings = profile({ dailyReviewLimit: 2, dailyNewLimit: 0 });

    const crammed = buildStudyQueue({
      now: NOW,
      profile: settings,
      cards,
      entries: MANDARIN_SEED,
      mode: 'cram',
    });

    expect(crammed.cards.length).toBeGreaterThan(2);
    expect(crammed.breakdown.heldByCap).toBe(0);
    expect(crammed.breakdown.fresh).toBe(0);
  });

  it('leaves unseen words out of a cram session', () => {
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyNewLimit: 20 }),
      cards: seedCards(MANDARIN_SEED, ['hsk3-1']),
      entries: MANDARIN_SEED,
      mode: 'cram',
    });
    expect(queue.cards).toHaveLength(0);
  });

  it('serves only new cards when learning', () => {
    const cards = [...matureDeck().slice(0, 3), ...seedCards(MANDARIN_SEED, ['hsk3-2'])];
    const queue = buildStudyQueue({
      now: NOW,
      // Targeting level 2 puts level 1 in scope too, so the mature cards are
      // genuinely available to serve and their absence means the mode excluded
      // them rather than the syllabus scope doing it.
      profile: profile({ targetLevelId: 'hsk3-2', dailyNewLimit: 50 }),
      cards,
      entries: MANDARIN_SEED,
      mode: 'learn',
    });

    expect(queue.cards.length).toBeGreaterThan(0);
    expect(queue.cards.every(({ card }) => card.state === 'new')).toBe(true);
  });

  it('still respects the daily new-card limit when learning', () => {
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyNewLimit: 3 }),
      cards: seedCards(MANDARIN_SEED, ['hsk3-1']),
      entries: MANDARIN_SEED,
      mode: 'learn',
    });
    expect(queue.cards).toHaveLength(3);
  });

  it('narrows to one card kind when asked, and counts the rest as excluded', () => {
    const queue = buildStudyQueue({
      now: NOW,
      profile: profile({ dailyNewLimit: 50 }),
      cards: seedCards(MANDARIN_SEED, ['hsk3-1']),
      entries: MANDARIN_SEED,
      kinds: ['listening'],
    });

    expect(queue.cards.length).toBeGreaterThan(0);
    expect(queue.cards.every(({ card }) => card.kind === 'listening')).toBe(true);
    expect(queue.breakdown.excluded).toBeGreaterThan(0);
  });
});
