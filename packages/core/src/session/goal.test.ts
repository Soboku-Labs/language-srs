import { describe, expect, it } from 'vitest';
import { getDailyGoal } from './goal';
import type { QueueBreakdown } from './queue';

const empty: QueueBreakdown = {
  learning: 0, due: 0, fresh: 0, heldByCap: 0, excluded: 0, total: 0,
};

const goal = (breakdown: Partial<QueueBreakdown>, done = { newCards: 0, reviews: 0 }) =>
  getDailyGoal({ breakdown: { ...empty, ...breakdown }, done });

describe("the day's goal", () => {
  it('asks for the work that was actually waiting', () => {
    const today = goal({ due: 12, fresh: 8 });
    expect(today.target).toBe(20);
    expect(today.remaining).toBe(20);
    expect(today.complete).toBe(false);
    expect(today.progress).toBe(0);
  });

  it('counts work already done into the same total', () => {
    const today = goal({ due: 5, fresh: 5 }, { newCards: 4, reviews: 6 });
    expect(today.done).toBe(10);
    expect(today.target).toBe(20);
    expect(today.progress).toBe(0.5);
  });

  it('completes exactly when the queue is clear', () => {
    const today = goal({}, { newCards: 9, reviews: 11 });
    expect(today.complete).toBe(true);
    expect(today.progress).toBe(1);
    expect(today.remaining).toBe(0);
  });

  it('does not move the finish line when a card comes back on a learning step', () => {
    // The dishonest version counts learning re-reps into the target, so the
    // total grows every time the learner answers and the goal recedes.
    const before = goal({ due: 10, fresh: 10 });
    const after = goal({ due: 8, fresh: 10, learning: 2 }, { newCards: 0, reviews: 2 });
    expect(after.target).toBe(before.target);
    expect(after.progress).toBeGreaterThan(before.progress);
  });

  it('calls a day with nothing scheduled complete, not nought per cent', () => {
    const today = goal({});
    expect(today.target).toBe(0);
    expect(today.complete).toBe(true);
    expect(today.progress).toBe(1);
  });

  it('says what is left over without counting it against the goal', () => {
    const today = goal({ learning: 3 }, { newCards: 5, reviews: 0 });
    expect(today.complete).toBe(true);
    expect(today.drillsLeft).toBe(3);
  });

  it('ignores cards held back by the cap, which are not today’s problem', () => {
    const today = goal({ due: 4, heldByCap: 90 }, { newCards: 0, reviews: 0 });
    expect(today.target).toBe(4);
  });
});
