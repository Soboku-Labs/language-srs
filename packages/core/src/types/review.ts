import type { Card, CardState, Timestamp } from './card';

/**
 * How well the learner recalled a card.
 *
 * Four buttons rather than the three the original prototype used. FSRS needs
 * "Again" to be distinct from "Hard": the first is a failure that resets
 * stability, the second is a success with a penalty. Collapsing them loses the
 * signal the scheduler depends on most.
 */
export type Rating = 1 | 2 | 3 | 4;

export const RATING_AGAIN: Rating = 1;
export const RATING_HARD: Rating = 2;
export const RATING_GOOD: Rating = 3;
export const RATING_EASY: Rating = 4;

export const RATING_LABELS: Record<Rating, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
};

/** Where a grading came from. Widget gradings are logged separately so the
 *  stats screen can show how much study happens without opening the app. */
export type ReviewSource = 'app' | 'widget' | 'import';

/** An immutable record of one grading, kept for stats and FSRS optimisation. */
export interface ReviewLog {
  id: string;
  cardId: string;
  entryId: string;
  reviewedAt: Timestamp;
  rating: Rating;
  /** Card state before the grading. */
  stateBefore: CardState;
  stateAfter: CardState;
  stabilityBefore: number;
  stabilityAfter: number;
  difficultyBefore: number;
  difficultyAfter: number;
  /** Days the card was actually waiting, which is rarely the days scheduled. */
  elapsedDays: number;
  /** Days until the next showing, as decided by this grading. */
  scheduledDays: number;
  /** Recall probability the scheduler predicted before seeing the answer. */
  predictedRetrievability: number;
  durationMs: number;
  source: ReviewSource;
}

/** The result of grading a card: the updated card plus the log entry to append. */
export interface GradeResult {
  card: Card;
  log: ReviewLog;
}
