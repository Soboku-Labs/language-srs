import type { Rating } from '../types/review';
import {
  FSRS_DECAY,
  FSRS_FACTOR,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  MIN_STABILITY,
  type SchedulerConfig,
} from './params';

/**
 * The FSRS-4.5 memory model, as pure functions.
 *
 * Two numbers describe a memory: stability (how long it lasts) and difficulty
 * (how hard it is to make it last). This module does nothing but move those two
 * numbers in response to a grading. Learning steps, fuzz, exam pressure and
 * anything else calendar-shaped lives in `scheduler.ts`, so the model can be
 * checked against the published reference implementation line by line.
 */

/** Probability of recalling a memory of stability `stability` after `elapsedDays`. */
export function retrievability(stability: number, elapsedDays: number): number {
  if (stability <= 0) return 0;
  const days = Math.max(0, elapsedDays);
  return Math.pow(1 + (FSRS_FACTOR * days) / stability, FSRS_DECAY);
}

/** Days until recall probability decays to `desiredRetention`. */
export function intervalForRetention(stability: number, desiredRetention: number): number {
  return (stability / FSRS_FACTOR) * (Math.pow(desiredRetention, 1 / FSRS_DECAY) - 1);
}

/** Stability implied by wanting `intervalDays` at `desiredRetention`. Inverse of the above. */
export function stabilityForInterval(intervalDays: number, desiredRetention: number): number {
  return (intervalDays * FSRS_FACTOR) / (Math.pow(desiredRetention, 1 / FSRS_DECAY) - 1);
}

export function initialStability(rating: Rating, config: SchedulerConfig): number {
  return clampStability(config.weights[rating - 1] ?? MIN_STABILITY);
}

export function initialDifficulty(rating: Rating, config: SchedulerConfig): number {
  const w4 = config.weights[4] as number;
  const w5 = config.weights[5] as number;
  return clampDifficulty(w4 - (rating - 3) * w5);
}

/**
 * Difficulty after a grading.
 *
 * Moves by a fixed amount per rating, then reverts a little towards the
 * difficulty an Easy first answer would have implied. Without that reversion
 * difficulty ratchets upwards forever on any card the learner ever finds hard.
 */
export function nextDifficulty(difficulty: number, rating: Rating, config: SchedulerConfig): number {
  const w6 = config.weights[6] as number;
  const w7 = config.weights[7] as number;
  const moved = difficulty - w6 * (rating - 3);
  const reversionTarget = initialDifficulty(4, config);
  return clampDifficulty(w7 * reversionTarget + (1 - w7) * moved);
}

/**
 * Stability after a successful recall.
 *
 * Growth is largest when the card was answered at low retrievability — recalling
 * something you had nearly forgotten is what actually strengthens the memory —
 * and shrinks as stability and difficulty rise.
 */
export function nextStabilityOnRecall(
  stability: number,
  difficulty: number,
  retrievabilityNow: number,
  rating: Rating,
  config: SchedulerConfig,
): number {
  const w8 = config.weights[8] as number;
  const w9 = config.weights[9] as number;
  const w10 = config.weights[10] as number;
  const hardPenalty = rating === 2 ? (config.weights[15] as number) : 1;
  const easyBonus = rating === 4 ? (config.weights[16] as number) : 1;

  const growth =
    Math.exp(w8) *
    (11 - difficulty) *
    Math.pow(stability, -w9) *
    (Math.exp((1 - retrievabilityNow) * w10) - 1) *
    hardPenalty *
    easyBonus;

  return clampStability(stability * (1 + growth));
}

/**
 * Stability after a lapse.
 *
 * Clamped to never exceed the pre-lapse stability. The bare formula can return
 * a larger value for very low-stability cards, which would mean forgetting a
 * card made the memory stronger.
 */
export function nextStabilityOnLapse(
  stability: number,
  difficulty: number,
  retrievabilityNow: number,
  config: SchedulerConfig,
): number {
  const w11 = config.weights[11] as number;
  const w12 = config.weights[12] as number;
  const w13 = config.weights[13] as number;
  const w14 = config.weights[14] as number;

  const lapsed =
    w11 *
    Math.pow(difficulty, -w12) *
    (Math.pow(stability + 1, w13) - 1) *
    Math.exp((1 - retrievabilityNow) * w14);

  return clampStability(Math.min(lapsed, stability));
}

/** Memory state after one grading, for a card that has been seen before. */
export function nextMemoryState(
  current: { stability: number; difficulty: number },
  rating: Rating,
  elapsedDays: number,
  config: SchedulerConfig,
): { stability: number; difficulty: number; retrievability: number } {
  const retrievabilityNow = retrievability(current.stability, elapsedDays);
  const difficulty = nextDifficulty(current.difficulty, rating, config);
  const stability =
    rating === 1
      ? nextStabilityOnLapse(current.stability, current.difficulty, retrievabilityNow, config)
      : nextStabilityOnRecall(current.stability, current.difficulty, retrievabilityNow, rating, config);

  return { stability, difficulty, retrievability: retrievabilityNow };
}

export function clampDifficulty(value: number): number {
  if (!Number.isFinite(value)) return MIN_DIFFICULTY;
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, value));
}

export function clampStability(value: number): number {
  if (!Number.isFinite(value)) return MIN_STABILITY;
  return Math.max(MIN_STABILITY, value);
}
