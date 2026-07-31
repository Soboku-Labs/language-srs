import { describe, expect, it } from 'vitest';
import type { Card } from '../types/card';
import { intervalForRetention, retrievability } from './fsrs';
import { DEFAULT_SCHEDULER_CONFIG } from './params';
import {
  applyFuzz,
  cardRetrievability,
  getExamPressure,
  gradeCard,
  previewIntervals,
  projectedRetrievability,
} from './scheduler';
import { addDays, daysBetween } from '../utils/date';

const NOW = '2026-03-01T09:00:00.000Z';

function newCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'zh-nihao:recognition',
    entryId: 'zh-nihao',
    languageCode: 'zh',
    levelId: 'hsk3-1',
    kind: 'recognition',
    state: 'new',
    stability: 0,
    difficulty: 0,
    step: 0,
    due: NOW,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    elapsedMs: 0,
    createdAt: NOW,
    ...overrides,
  };
}

/** A card that has graduated, with a known memory state. */
function reviewCard(overrides: Partial<Card> = {}): Card {
  return newCard({
    state: 'review',
    stability: 10,
    difficulty: 5,
    reps: 3,
    lastReviewedAt: NOW,
    due: addDays(NOW, 10),
    scheduledDays: 10,
    ...overrides,
  });
}

const noFuzz = { fuzz: false };

describe('forgetting curve', () => {
  it('is 1 at zero elapsed time and 0.9 at one stability interval', () => {
    expect(retrievability(10, 0)).toBeCloseTo(1, 6);
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 6);
  });

  it('decays monotonically', () => {
    const values = [0, 5, 10, 30, 90, 365].map((days) => retrievability(10, days));
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]!).toBeLessThan(values[index - 1]!);
    }
  });

  it('inverts: the interval for 0.9 retention equals stability', () => {
    expect(intervalForRetention(20, 0.9)).toBeCloseTo(20, 6);
  });

  it('shortens intervals as desired retention rises', () => {
    expect(intervalForRetention(20, 0.95)).toBeLessThan(intervalForRetention(20, 0.9));
  });
});

describe('learning steps', () => {
  it('puts a new card on the first step, in minutes not days', () => {
    const { card } = gradeCard(newCard(), 3, { now: NOW, config: noFuzz });
    expect(card.state).toBe('learning');
    expect(card.step).toBe(1);
    expect(daysBetween(NOW, card.due)).toBeCloseTo(10 / (60 * 24), 6);
  });

  it('graduates to review after the last step', () => {
    const afterFirst = gradeCard(newCard(), 3, { now: NOW, config: noFuzz }).card;
    const graduated = gradeCard(afterFirst, 3, { now: NOW, config: noFuzz }).card;
    expect(graduated.state).toBe('review');
    expect(daysBetween(NOW, graduated.due)).toBeGreaterThanOrEqual(1);
  });

  it('graduates immediately on Easy', () => {
    const { card } = gradeCard(newCard(), 4, { now: NOW, config: noFuzz });
    expect(card.state).toBe('review');
    expect(card.stability).toBeGreaterThan(DEFAULT_SCHEDULER_CONFIG.weights[2]!);
  });

  it('repeats the current step on Hard without advancing', () => {
    const { card } = gradeCard(newCard(), 2, { now: NOW, config: noFuzz });
    expect(card.state).toBe('learning');
    expect(card.step).toBe(0);
  });

  it('sends a lapsed review card to relearning and counts the lapse', () => {
    const { card } = gradeCard(reviewCard(), 1, { now: NOW, config: noFuzz });
    expect(card.state).toBe('relearning');
    expect(card.lapses).toBe(1);
    expect(daysBetween(NOW, card.due)).toBeLessThan(1);
  });

  it('does not count a lapse for a card that was still in learning', () => {
    const { card } = gradeCard(newCard({ state: 'learning', reps: 1 }), 1, { now: NOW, config: noFuzz });
    expect(card.state).toBe('learning');
    expect(card.lapses).toBe(0);
  });
});

describe('memory state', () => {
  it('initialises stability and difficulty from the first rating', () => {
    const again = gradeCard(newCard(), 1, { now: NOW, config: noFuzz }).card;
    const easy = gradeCard(newCard(), 4, { now: NOW, config: noFuzz }).card;
    expect(again.stability).toBeLessThan(easy.stability);
    expect(again.difficulty).toBeGreaterThan(easy.difficulty);
  });

  it('keeps difficulty inside 1..10 under repeated Again', () => {
    let card = newCard();
    for (let index = 0; index < 40; index += 1) {
      card = gradeCard(card, 1, { now: addDays(NOW, index), config: noFuzz }).card;
    }
    expect(card.difficulty).toBeLessThanOrEqual(10);
    expect(card.difficulty).toBeGreaterThanOrEqual(1);
  });

  it('never increases stability on a lapse', () => {
    const before = reviewCard({ stability: 30 });
    const { card } = gradeCard(before, 1, { now: addDays(NOW, 30), config: noFuzz });
    expect(card.stability).toBeLessThanOrEqual(before.stability);
  });

  it('grows stability more when the card was answered at lower retrievability', () => {
    const soon = gradeCard(reviewCard(), 3, { now: addDays(NOW, 2), config: noFuzz }).card;
    const late = gradeCard(reviewCard(), 3, { now: addDays(NOW, 20), config: noFuzz }).card;
    expect(late.stability).toBeGreaterThan(soon.stability);
  });

  it('orders resulting intervals Again < Hard < Good < Easy', () => {
    const preview = previewIntervals(reviewCard(), { now: addDays(NOW, 10), config: noFuzz });
    expect(preview[1].intervalDays).toBeLessThan(preview[2].intervalDays);
    expect(preview[2].intervalDays).toBeLessThan(preview[3].intervalDays);
    expect(preview[3].intervalDays).toBeLessThan(preview[4].intervalDays);
  });
});

describe('exam pressure', () => {
  it('is inactive with no exam date', () => {
    const pressure = getExamPressure(NOW, DEFAULT_SCHEDULER_CONFIG);
    expect(pressure.active).toBe(false);
    expect(pressure.effectiveRetention).toBe(DEFAULT_SCHEDULER_CONFIG.desiredRetention);
  });

  it('is inactive outside the ramp window', () => {
    const pressure = getExamPressure(NOW, DEFAULT_SCHEDULER_CONFIG, '2026-12-01');
    expect(pressure.active).toBe(false);
    expect(pressure.effectiveRetention).toBe(DEFAULT_SCHEDULER_CONFIG.desiredRetention);
  });

  it('raises target retention as the exam approaches', () => {
    const far = getExamPressure(NOW, DEFAULT_SCHEDULER_CONFIG, '2026-04-15');
    const near = getExamPressure(NOW, DEFAULT_SCHEDULER_CONFIG, '2026-03-08');
    expect(near.effectiveRetention).toBeGreaterThan(far.effectiveRetention);
    expect(near.effectiveRetention).toBeLessThanOrEqual(DEFAULT_SCHEDULER_CONFIG.examPeakRetention);
  });

  it('caps intervals so a card is seen again before the exam', () => {
    const pressure = getExamPressure(NOW, DEFAULT_SCHEDULER_CONFIG, '2026-03-21');
    expect(pressure.daysToExam).toBe(20);
    expect(pressure.intervalCapDays).toBe(16);
  });

  it('stops applying pressure once the exam has passed', () => {
    const pressure = getExamPressure(NOW, DEFAULT_SCHEDULER_CONFIG, '2026-02-01');
    expect(pressure.active).toBe(false);
    expect(pressure.intervalCapDays).toBe(DEFAULT_SCHEDULER_CONFIG.maximumIntervalDays);
  });

  it('shortens a scheduled interval when the exam is close', () => {
    const card = reviewCard({ stability: 200, difficulty: 4 });
    const relaxed = gradeCard(card, 3, { now: NOW, config: noFuzz }).card;
    const pressured = gradeCard(card, 3, { now: NOW, config: noFuzz, examDate: '2026-03-21' }).card;
    expect(daysBetween(NOW, pressured.due)).toBeLessThan(daysBetween(NOW, relaxed.due));
    expect(daysBetween(NOW, pressured.due)).toBeLessThanOrEqual(16);
  });

  it('never schedules a card past the exam once inside the ramp', () => {
    let card = reviewCard({ stability: 500 });
    for (let day = 0; day < 30; day += 1) {
      const now = addDays(NOW, day);
      card = gradeCard(card, 4, { now, config: noFuzz, examDate: '2026-04-01' }).card;
      const daysToExam = daysBetween(now, '2026-04-01T00:00:00.000Z');
      if (daysToExam > 0) {
        expect(daysBetween(now, card.due)).toBeLessThanOrEqual(Math.ceil(daysToExam));
      }
      card = { ...card, state: 'review' };
    }
  });
});

describe('fuzz', () => {
  const rng = () => 0.5;

  it('leaves short intervals alone', () => {
    expect(applyFuzz(2, 0, 3650, rng)).toBe(2);
  });

  it('stays within a band around the requested interval', () => {
    for (const interval of [5, 15, 60, 400]) {
      for (const sample of [0, 0.25, 0.5, 0.75, 0.999]) {
        const fuzzed = applyFuzz(interval, 0, 3650, () => sample);
        expect(fuzzed).toBeGreaterThanOrEqual(Math.floor(interval * 0.7));
        expect(fuzzed).toBeLessThanOrEqual(Math.ceil(interval * 1.3) + 2);
      }
    }
  });

  it('respects the maximum interval', () => {
    expect(applyFuzz(4000, 0, 100, () => 0.999)).toBeLessThanOrEqual(100);
  });

  it('does not scatter below an interval the card has already survived', () => {
    // Chosen interval 30d, already waited 25d: fuzz may not land under 25d.
    expect(applyFuzz(30, 25, 3650, () => 0)).toBeGreaterThan(25);
  });

  it('still allows a shorter interval than the wait when the model chose one', () => {
    // Waited 40d but the model only wants 30d — that is a correction, not fuzz.
    expect(applyFuzz(30, 40, 3650, () => 0)).toBeLessThan(40);
  });
});

describe('retrievability helpers', () => {
  it('reports zero for a new card', () => {
    expect(cardRetrievability(newCard(), NOW)).toBe(0);
  });

  it('projects forward without scheduling', () => {
    const card = reviewCard({ stability: 10, lastReviewedAt: NOW });
    expect(projectedRetrievability(card, addDays(NOW, 10))).toBeCloseTo(0.9, 4);
    expect(projectedRetrievability(card, addDays(NOW, 60))).toBeLessThan(0.7);
  });
});

describe('review logs', () => {
  it('records the transition and the predicted retrievability', () => {
    const { log } = gradeCard(reviewCard(), 3, { now: addDays(NOW, 10), config: noFuzz, durationMs: 4200 });
    expect(log.stateBefore).toBe('review');
    expect(log.stateAfter).toBe('review');
    expect(log.elapsedDays).toBeCloseTo(10, 6);
    expect(log.predictedRetrievability).toBeCloseTo(0.9, 4);
    expect(log.durationMs).toBe(4200);
    expect(log.source).toBe('app');
  });

  it('reports zero predicted retrievability for a first review', () => {
    const { log } = gradeCard(newCard(), 3, { now: NOW, config: noFuzz });
    expect(log.stateBefore).toBe('new');
    expect(log.predictedRetrievability).toBe(0);
  });
});

describe('leeches', () => {
  it('flags a card once it passes the lapse threshold', () => {
    let card = reviewCard();
    for (let index = 0; index < DEFAULT_SCHEDULER_CONFIG.leechThreshold; index += 1) {
      card = gradeCard(card, 1, { now: addDays(NOW, index), config: noFuzz }).card;
      card = { ...card, state: 'review' };
    }
    expect(card.leech).toBe(true);
  });
});
