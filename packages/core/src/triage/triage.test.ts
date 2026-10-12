import { describe, expect, it } from 'vitest';
import { generateCards } from '../cards/factory';
import { MANDARIN_SEED } from '../data/seed/mandarin';
import type { Card } from '../types/card';
import type { ReviewLog } from '../types/review';
import { describeStruggle, findStrugglingCards } from './index';

const NOW = '2026-03-01T09:00:00.000Z';
const cards = generateCards(MANDARIN_SEED, ['hsk3-1'], { now: NOW });

function log(cardId: string, rating: 1 | 2 | 3 | 4, reviewedAt = NOW): ReviewLog {
  return {
    id: `${cardId}-${reviewedAt}-${Math.random()}`,
    cardId,
    entryId: cardId.split(':')[0]!,
    reviewedAt,
    rating,
    stateBefore: 'review',
    stateAfter: rating === 1 ? 'relearning' : 'review',
    stabilityBefore: 5,
    stabilityAfter: rating === 1 ? 1 : 8,
    difficultyBefore: 5,
    difficultyAfter: 5,
    elapsedDays: 1,
    scheduledDays: 8,
    predictedRetrievability: 0.9,
    durationMs: 4000,
    source: 'app',
  };
}

function withLapses(card: Card, lapses: number, extra: Partial<Card> = {}): Card {
  return { ...card, state: 'review', reps: lapses + 2, lapses, stability: 2, difficulty: 8, ...extra };
}

describe('finding struggling cards', () => {
  it('finds nothing in a deck nobody has failed', () => {
    const struggling = findStrugglingCards({ cards, entries: MANDARIN_SEED, logs: [] });
    expect(struggling).toEqual([]);
  });

  it('reports a flagged leech', () => {
    const leech = withLapses(cards[0]!, 9, { leech: true });
    const struggling = findStrugglingCards({
      cards: [leech, ...cards.slice(1)],
      entries: MANDARIN_SEED,
      logs: [],
    });

    expect(struggling).toHaveLength(1);
    expect(struggling[0]!.reason).toBe('leech');
    expect(struggling[0]!.lapses).toBe(9);
  });

  it('treats a card past the threshold as a leech even before the flag is written', () => {
    // The flag is set by the scheduler on the grading that crosses the line, so a
    // card imported or migrated past it would otherwise never be reported.
    const past = withLapses(cards[0]!, 8);
    const struggling = findStrugglingCards({
      cards: [past],
      entries: MANDARIN_SEED,
      logs: [],
      leechThreshold: 8,
    });
    expect(struggling[0]!.reason).toBe('leech');
  });

  it('warns while a card is still worth saving', () => {
    // Half the threshold: clearly not sticking, four lapses before anything would
    // have been said about it.
    const lapsing = withLapses(cards[0]!, 4);
    const struggling = findStrugglingCards({
      cards: [lapsing],
      entries: MANDARIN_SEED,
      logs: [],
      leechThreshold: 8,
    });
    expect(struggling[0]!.reason).toBe('lapsing');
  });

  it('catches a card with few lapses but a bad hit rate', () => {
    const card = { ...cards[0]!, state: 'review' as const, reps: 4, lapses: 1 };
    const logs = [log(card.id, 1), log(card.id, 1), log(card.id, 3), log(card.id, 1)];

    const struggling = findStrugglingCards({ cards: [card], entries: MANDARIN_SEED, logs });
    expect(struggling[0]!.reason).toBe('failing');
    expect(struggling[0]!.failureRate).toBeCloseTo(0.75, 2);
  });

  it('ignores one bad answer on a card the learner has barely met', () => {
    // Otherwise a single Again reads as a 100% failure rate and the list fills
    // with words nobody has had a chance to learn yet.
    const card = { ...cards[0]!, state: 'review' as const, reps: 1, lapses: 1 };
    const struggling = findStrugglingCards({
      cards: [card],
      entries: MANDARIN_SEED,
      logs: [log(card.id, 1)],
    });
    expect(struggling).toEqual([]);
  });

  it('leaves suspended cards alone', () => {
    const settled = withLapses(cards[0]!, 9, { leech: true, suspended: true });
    const struggling = findStrugglingCards({ cards: [settled], entries: MANDARIN_SEED, logs: [] });
    expect(struggling).toEqual([]);
  });

  it('puts the worst card first', () => {
    const bad = withLapses(cards[0]!, 9, { leech: true });
    const worse = withLapses(cards[1]!, 14, { leech: true });
    const mild = withLapses(cards[2]!, 4);

    const struggling = findStrugglingCards({
      cards: [bad, mild, worse],
      entries: MANDARIN_SEED,
      logs: [],
    });
    expect(struggling.map((row) => row.card.id)).toEqual([worse.id, bad.id, mild.id]);
  });

  it('honours a limit and a time window', () => {
    const old = '2025-01-01T09:00:00.000Z';
    const card = { ...cards[0]!, state: 'review' as const, reps: 5, lapses: 0 };
    const logs = [log(card.id, 1, old), log(card.id, 1, old), log(card.id, 1, old)];

    // All the failures are outside the window, so nothing is reported.
    expect(
      findStrugglingCards({ cards: [card], entries: MANDARIN_SEED, logs, since: NOW }),
    ).toEqual([]);

    const many = [0, 1, 2].map((index) => withLapses(cards[index]!, 9, { leech: true }));
    expect(
      findStrugglingCards({ cards: many, entries: MANDARIN_SEED, logs: [], limit: 2 }),
    ).toHaveLength(2);
  });

  it('drops a card whose entry has gone', () => {
    const orphan = withLapses({ ...cards[0]!, entryId: 'zh-deleted' }, 9, { leech: true });
    expect(findStrugglingCards({ cards: [orphan], entries: MANDARIN_SEED, logs: [] })).toEqual([]);
  });

  it('describes each reason in terms the learner can act on', () => {
    const leech = findStrugglingCards({
      cards: [withLapses(cards[0]!, 9, { leech: true })],
      entries: MANDARIN_SEED,
      logs: [],
    })[0]!;
    expect(describeStruggle(leech)).toContain('9 times');

    const card = { ...cards[0]!, state: 'review' as const, reps: 4, lapses: 1 };
    const failing = findStrugglingCards({
      cards: [card],
      entries: MANDARIN_SEED,
      logs: [log(card.id, 1), log(card.id, 1), log(card.id, 3), log(card.id, 1)],
    })[0]!;
    expect(describeStruggle(failing)).toContain('75%');
  });
});
