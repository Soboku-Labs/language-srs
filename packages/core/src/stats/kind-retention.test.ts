import { describe, expect, it } from 'vitest';
import type { ReviewLog } from '../types/review';
import { addDays } from '../utils/date';
import { computeRetentionByKind } from './metrics';

const NOW = '2026-03-01T09:00:00.000Z';

function log(overrides: Partial<ReviewLog> & { cardId: string; rating: 1 | 2 | 3 | 4 }): ReviewLog {
  return {
    id: `${overrides.cardId}-${Math.random()}`,
    entryId: overrides.cardId.split(':')[0]!,
    reviewedAt: NOW,
    stateBefore: 'review',
    stateAfter: 'review',
    stabilityBefore: 5,
    stabilityAfter: 8,
    difficultyBefore: 5,
    difficultyAfter: 5,
    elapsedDays: 1,
    scheduledDays: 8,
    predictedRetrievability: 0.9,
    durationMs: 3000,
    source: 'app',
    ...overrides,
  };
}

/** `count` gradings of one kind, `failures` of them missed. */
function runOf(kind: string, count: number, failures: number, at = NOW): ReviewLog[] {
  return Array.from({ length: count }, (_, index) =>
    log({ cardId: `zh-w${index}:${kind}`, rating: index < failures ? 1 : 3, reviewedAt: at }),
  );
}

describe('retention by card kind', () => {
  it('separates a weak skill from a strong one', () => {
    const logs = [...runOf('listening', 10, 3), ...runOf('recognition', 10, 0)];
    const byKind = computeRetentionByKind(logs, { now: NOW });

    expect(byKind).toHaveLength(2);
    // Weakest first: the list is read to find what to work on.
    expect(byKind[0]!.kind).toBe('listening');
    expect(byKind[0]!.trueRetention).toBeCloseTo(0.7, 5);
    expect(byKind[1]!.kind).toBe('recognition');
    expect(byKind[1]!.trueRetention).toBe(1);
  });

  it('ignores a kind with too few gradings to mean anything', () => {
    // Two reviews of one listening card is 0% or 100% and neither is a fact.
    const logs = [...runOf('recognition', 10, 1), ...runOf('listening', 2, 2)];
    expect(computeRetentionByKind(logs, { now: NOW }).map((row) => row.kind)).toEqual(['recognition']);
  });

  it('excludes learning-state gradings, which were never retained over an interval', () => {
    const logs = [
      ...runOf('recognition', 6, 0),
      ...Array.from({ length: 6 }, () =>
        log({ cardId: 'zh-x:recognition', rating: 1, stateBefore: 'learning' }),
      ),
    ];
    const byKind = computeRetentionByKind(logs, { now: NOW });
    expect(byKind[0]!.reviews).toBe(6);
    expect(byKind[0]!.trueRetention).toBe(1);
  });

  it('respects the window', () => {
    const old = addDays(NOW, -90);
    const logs = [...runOf('recognition', 10, 10, old), ...runOf('recognition', 10, 0)];
    const byKind = computeRetentionByKind(logs, { now: NOW, windowDays: 30 });

    expect(byKind[0]!.reviews).toBe(10);
    expect(byKind[0]!.trueRetention).toBe(1);
  });

  it('skips a log whose card id predates the current scheme', () => {
    const logs = [...runOf('recognition', 6, 0), log({ cardId: 'legacy-no-kind', rating: 1 })];
    const byKind = computeRetentionByKind(logs, { now: NOW });
    expect(byKind).toHaveLength(1);
    expect(byKind[0]!.reviews).toBe(6);
  });

  it('returns nothing rather than zeroes for an empty history', () => {
    expect(computeRetentionByKind([], { now: NOW })).toEqual([]);
  });
});
