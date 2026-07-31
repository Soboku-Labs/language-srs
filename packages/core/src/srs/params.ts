/**
 * FSRS-4.5 parameters and scheduler configuration.
 *
 * The 17 weights are the published FSRS-4.5 defaults, fitted against a very
 * large corpus of Anki review logs. They are deliberately not tuned per
 * language: the right way to improve them is to refit against the learner's own
 * review history once there is enough of it, which is what `ReviewLog` is
 * accumulated for. Until then, the defaults beat anything hand-picked.
 */
export const FSRS_DEFAULT_WEIGHTS: readonly number[] = [
  0.4872, // w0  initial stability, Again
  1.4003, // w1  initial stability, Hard
  3.7145, // w2  initial stability, Good
  13.8206, // w3  initial stability, Easy
  5.1618, // w4  initial difficulty base
  1.2298, // w5  initial difficulty slope per rating
  0.8975, // w6  difficulty change per rating
  0.031, // w7  difficulty mean-reversion weight
  1.6474, // w8  stability growth factor
  0.1367, // w9  stability saturation exponent
  1.0461, // w10 retrievability term in stability growth
  2.1072, // w11 post-lapse stability base
  0.0793, // w12 post-lapse difficulty exponent
  0.3246, // w13 post-lapse stability exponent
  1.587, // w14 post-lapse retrievability term
  0.2272, // w15 Hard penalty
  2.8755, // w16 Easy bonus
];

/**
 * Forgetting-curve shape constants.
 *
 * FSRS models recall as a power function: R(t) = (1 + FACTOR * t/S) ^ DECAY.
 * FACTOR is fixed by the definition of stability — S is the interval at which
 * R falls to 0.9 — so FACTOR = 0.9^(1/DECAY) - 1 = 19/81.
 */
export const FSRS_DECAY = -0.5;
export const FSRS_FACTOR = 19 / 81;

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;
export const MIN_STABILITY = 0.1;

export interface SchedulerConfig {
  weights: readonly number[];
  /** Target recall probability when a card comes up, 0.7-0.98. */
  desiredRetention: number;
  /** Hard ceiling on any interval, in days. Ten years by default. */
  maximumIntervalDays: number;
  /** Minutes between showings while a new card is in learning. */
  learningStepsMinutes: number[];
  /** Minutes between showings after a lapse. */
  relearningStepsMinutes: number[];
  /** Spread due dates so reviews do not clump on one day. */
  fuzz: boolean;
  /** Lapses before a card is flagged as a leech and surfaced for rewriting. */
  leechThreshold: number;
  /**
   * How far out from the exam the scheduler starts tightening, in days.
   *
   * Inside this window desired retention ramps towards `examPeakRetention` and
   * intervals are capped, so material is fresh on exam day rather than merely
   * learned at some point. Outside it, scheduling is ordinary FSRS — cramming
   * three months early costs reviews and buys nothing.
   */
  examRampDays: number;
  /** Desired retention on exam day itself. */
  examPeakRetention: number;
  /**
   * Fraction of the remaining days-to-exam an interval may span.
   *
   * At 0.8, a card 30 days out is capped at a 24-day interval: it gets one more
   * showing with slack before the exam, instead of landing exactly on exam day
   * along with everything else.
   */
  examIntervalCapRatio: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  weights: FSRS_DEFAULT_WEIGHTS,
  desiredRetention: 0.9,
  maximumIntervalDays: 3650,
  learningStepsMinutes: [1, 10],
  relearningStepsMinutes: [10],
  fuzz: true,
  leechThreshold: 8,
  examRampDays: 60,
  examPeakRetention: 0.97,
  examIntervalCapRatio: 0.8,
};

export function resolveSchedulerConfig(overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
  const config = { ...DEFAULT_SCHEDULER_CONFIG, ...overrides };
  if (config.weights.length < 17) {
    throw new Error(`FSRS requires at least 17 weights, received ${config.weights.length}`);
  }
  if (config.desiredRetention <= 0.5 || config.desiredRetention >= 1) {
    throw new Error(`desiredRetention must be between 0.5 and 1, received ${config.desiredRetention}`);
  }
  if (config.learningStepsMinutes.length === 0) {
    throw new Error('learningStepsMinutes must contain at least one step');
  }
  return config;
}
