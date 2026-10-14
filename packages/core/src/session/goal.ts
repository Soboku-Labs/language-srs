import type { DailyCounts, QueueBreakdown } from './queue';

/**
 * The day's goal.
 *
 * One ring, one number, and an end. The mechanic worth keeping from the apps that
 * do this well is the daily close: a clear point at which today is finished and
 * the app stops asking. The mechanic worth refusing is the one underneath it —
 * the goal that grows, the next tier, the "one more lesson" that means there is
 * never a moment where you have done enough.
 *
 * So the target is not a number the app picked to keep you here. It is the work
 * that was actually waiting when the day started: everything due, plus the new
 * words today's limit allows. Clear it and you are done, and the screen says so
 * and offers nothing further.
 *
 * Counting is per card, once. A card met as new this morning and now walking its
 * ten-minute learning steps is already counted in `done`; counting its re-reps in
 * the target as well would move the finish line every time the learner answered,
 * which is the exact dishonesty this is meant to avoid.
 */
export interface DailyGoal {
  /** Cards the day asked for: done plus still waiting. */
  target: number;
  /** Cards credited so far today. */
  done: number;
  /** Cards still to clear. */
  remaining: number;
  complete: boolean;
  /** 0-1. Exactly 1 when the queue is clear. */
  progress: number;
  /**
   * Learning-step repetitions still pending once the goal is met.
   *
   * Not part of the goal, but worth saying rather than hiding: "done for today,
   * a few drills left if you want them" is true, and a queue that still has
   * cards in it while the app claims completion would otherwise look like a bug.
   */
  drillsLeft: number;
}

export function getDailyGoal(input: { breakdown: QueueBreakdown; done: DailyCounts }): DailyGoal {
  const done = input.done.newCards + input.done.reviews;
  // Learning cards are excluded on purpose — see the note above.
  const remaining = input.breakdown.due + input.breakdown.fresh;
  const target = done + remaining;

  return {
    target,
    done,
    remaining,
    complete: remaining === 0,
    // A day with nothing scheduled is complete, not zero percent complete.
    progress: target === 0 ? 1 : done / target,
    drillsLeft: input.breakdown.learning,
  };
}
