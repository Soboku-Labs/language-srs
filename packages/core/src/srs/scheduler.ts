import type { Card, CardState, DateOnly, Timestamp } from '../types/card';
import type { GradeResult, Rating, ReviewLog, ReviewSource } from '../types/review';
import { RATING_LABELS } from '../types/review';
import { addDays, addMinutes, calendarDaysBetween, daysBetween, formatInterval, systemClock } from '../utils/date';
import { reviewLogId } from '../utils/id';
import {
  initialDifficulty,
  initialStability,
  intervalForRetention,
  nextMemoryState,
  retrievability,
} from './fsrs';
import { DEFAULT_SCHEDULER_CONFIG, resolveSchedulerConfig, type SchedulerConfig } from './params';

export interface GradeOptions {
  /** Defaults to the system clock. */
  now?: Timestamp;
  config?: Partial<SchedulerConfig>;
  /** Booked exam date. Present, it switches on exam-mode tightening. */
  examDate?: DateOnly;
  /** Time the learner spent on this card, for stats. */
  durationMs?: number;
  source?: ReviewSource;
  /** Injectable randomness so fuzzed intervals are reproducible in tests. */
  rng?: () => number;
}

/**
 * How the exam date bends the schedule.
 *
 * This is the piece that makes the app exam-shaped rather than a generic SRS.
 * Ordinary FSRS optimises for durable knowledge on an open-ended horizon, which
 * is the wrong objective when there is a paper on a known date: a card
 * scheduled 200 days out is not going to be fresh in six weeks' time when it
 * matters. Inside the ramp window the scheduler raises target retention and
 * caps intervals so every card gets another showing before exam day.
 */
export interface ExamPressure {
  /** Calendar days until the exam; negative once it has passed. */
  daysToExam: number;
  /** 0 outside the ramp window, 1 on exam day. */
  urgency: number;
  /** Retention actually targeted, after the ramp is applied. */
  effectiveRetention: number;
  /** Ceiling on any interval, in days. */
  intervalCapDays: number;
  active: boolean;
}

export function getExamPressure(
  now: Timestamp,
  config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
  examDate?: DateOnly,
): ExamPressure {
  if (!examDate) {
    return {
      daysToExam: Number.POSITIVE_INFINITY,
      urgency: 0,
      effectiveRetention: config.desiredRetention,
      intervalCapDays: config.maximumIntervalDays,
      active: false,
    };
  }

  const daysToExam = calendarDaysBetween(now, examDate);

  // The exam has been sat. Stop cramming and go back to ordinary retention —
  // the learner has probably moved on to the next level anyway.
  if (daysToExam <= 0) {
    return {
      daysToExam,
      urgency: 0,
      effectiveRetention: config.desiredRetention,
      intervalCapDays: config.maximumIntervalDays,
      active: false,
    };
  }

  const urgency = clamp01(1 - daysToExam / config.examRampDays);
  const effectiveRetention =
    config.desiredRetention + (config.examPeakRetention - config.desiredRetention) * urgency;

  // Leave slack rather than scheduling everything to land on the exam itself.
  const cap = Math.max(1, Math.floor(daysToExam * config.examIntervalCapRatio));

  return {
    daysToExam,
    urgency,
    effectiveRetention: Math.min(config.examPeakRetention, effectiveRetention),
    intervalCapDays: Math.min(config.maximumIntervalDays, cap),
    active: urgency > 0,
  };
}

/** A card as it would look after a given rating, without committing anything. */
export interface IntervalPreview {
  rating: Rating;
  label: string;
  intervalDays: number;
  due: Timestamp;
  /** Compact form for buttons and the widget, e.g. "10m", "4d", "1.2y". */
  display: string;
  stateAfter: CardState;
}

/**
 * What each button would do, for showing intervals on the four grade buttons.
 *
 * Computed with fuzz disabled so the number on the button is the number the
 * model actually chose; the committed due date may be a day or two either side.
 */
export function previewIntervals(card: Card, options: GradeOptions = {}): Record<Rating, IntervalPreview> {
  const ratings: Rating[] = [1, 2, 3, 4];
  const entries = ratings.map((rating) => {
    const { card: next } = gradeCard(card, rating, {
      ...options,
      config: { ...options.config, fuzz: false },
      source: 'app',
    });
    const intervalDays = daysBetween(options.now ?? systemClock(), next.due);
    return [
      rating,
      {
        rating,
        label: RATING_LABELS[rating],
        intervalDays,
        due: next.due,
        display: formatInterval(intervalDays),
        stateAfter: next.state,
      } satisfies IntervalPreview,
    ] as const;
  });
  return Object.fromEntries(entries) as Record<Rating, IntervalPreview>;
}

/**
 * Apply a grading to a card.
 *
 * Pure: it returns a new card and the log entry to append, and touches nothing
 * else. Persisting them together is the caller's job, which is what lets the
 * widget grade a card offline and hand the pair to the app to store later.
 */
export function gradeCard(card: Card, rating: Rating, options: GradeOptions = {}): GradeResult {
  const config = resolveSchedulerConfig(options.config);
  const now = options.now ?? systemClock();
  const rng = options.rng ?? Math.random;
  const pressure = getExamPressure(now, config, options.examDate);

  const isFirstReview = card.reps === 0 || card.state === 'new';
  const elapsedDays = card.lastReviewedAt ? Math.max(0, daysBetween(card.lastReviewedAt, now)) : 0;

  const memory = isFirstReview
    ? {
        stability: initialStability(rating, config),
        difficulty: initialDifficulty(rating, config),
        retrievability: 0,
      }
    : nextMemoryState({ stability: card.stability, difficulty: card.difficulty }, rating, elapsedDays, config);

  const lapsed = rating === 1;
  const wasInReview = card.state === 'review';

  let state: CardState;
  let step: number;
  let due: Timestamp;
  let scheduledDays: number;

  if (lapsed) {
    // A failure sends the card back through the step ladder. Cards that were in
    // review relearn; cards still in learning simply restart their steps.
    state = wasInReview ? 'relearning' : 'learning';
    step = 0;
    const steps = state === 'relearning' ? config.relearningStepsMinutes : config.learningStepsMinutes;
    const minutes = steps[0] ?? 10;
    due = addMinutes(now, minutes);
    scheduledDays = minutes / (60 * 24);
  } else if (card.state === 'review') {
    state = 'review';
    step = 0;
    scheduledDays = computeReviewInterval(memory.stability, elapsedDays, config, pressure, rng);
    due = addDays(now, scheduledDays);
  } else {
    // In learning or relearning: walk the step ladder, or graduate out of it.
    const steps = card.state === 'relearning' ? config.relearningStepsMinutes : config.learningStepsMinutes;
    const currentStep = Math.min(Math.max(card.step, 0), steps.length - 1);

    if (rating === 4) {
      // Easy graduates immediately, however many steps are left.
      state = 'review';
      step = 0;
      scheduledDays = computeReviewInterval(memory.stability, elapsedDays, config, pressure, rng);
      due = addDays(now, scheduledDays);
    } else if (rating === 3 && currentStep + 1 >= steps.length) {
      state = 'review';
      step = 0;
      scheduledDays = computeReviewInterval(memory.stability, elapsedDays, config, pressure, rng);
      due = addDays(now, scheduledDays);
    } else if (rating === 3) {
      state = card.state === 'relearning' ? 'relearning' : 'learning';
      step = currentStep + 1;
      const minutes = steps[step] ?? 10;
      due = addMinutes(now, minutes);
      scheduledDays = minutes / (60 * 24);
    } else {
      // Hard repeats the current step. With more than one step left, the delay
      // is the midpoint of this step and the next, matching Anki's behaviour;
      // otherwise the step is simply stretched.
      state = card.state === 'relearning' ? 'relearning' : 'learning';
      step = currentStep;
      const thisStep = steps[currentStep] ?? 10;
      const nextStep = steps[currentStep + 1];
      const minutes = nextStep !== undefined ? (thisStep + nextStep) / 2 : thisStep * 1.5;
      due = addMinutes(now, minutes);
      scheduledDays = minutes / (60 * 24);
    }
  }

  const lapses = card.lapses + (lapsed && wasInReview ? 1 : 0);

  const nextCard: Card = {
    ...card,
    state,
    step,
    due,
    scheduledDays,
    stability: memory.stability,
    difficulty: memory.difficulty,
    lastReviewedAt: now,
    reps: card.reps + 1,
    lapses,
    elapsedMs: card.elapsedMs + (options.durationMs ?? 0),
    leech: lapses >= config.leechThreshold ? true : card.leech,
  };

  const log: ReviewLog = {
    id: reviewLogId(Date.parse(now)),
    cardId: card.id,
    entryId: card.entryId,
    reviewedAt: now,
    rating,
    stateBefore: card.state,
    stateAfter: state,
    stabilityBefore: card.stability,
    stabilityAfter: memory.stability,
    difficultyBefore: card.difficulty,
    difficultyAfter: memory.difficulty,
    elapsedDays,
    scheduledDays,
    predictedRetrievability: isFirstReview ? 0 : memory.retrievability,
    durationMs: options.durationMs ?? 0,
    source: options.source ?? 'app',
  };

  return { card: nextCard, log };
}

function computeReviewInterval(
  stability: number,
  elapsedDays: number,
  config: SchedulerConfig,
  pressure: ExamPressure,
  rng: () => number,
): number {
  const ideal = intervalForRetention(stability, pressure.effectiveRetention);
  const ceiling = Math.min(config.maximumIntervalDays, pressure.intervalCapDays);
  const bounded = Math.min(Math.max(1, ideal), ceiling);
  if (!config.fuzz) return Math.max(1, Math.round(bounded));
  return applyFuzz(bounded, elapsedDays, ceiling, rng);
}

/**
 * Spread due dates a little.
 *
 * Without this, a batch of cards learned on the same day comes back on the same
 * day forever, and the daily load turns into a sawtooth. The bands are the
 * standard FSRS ones: proportionally more scatter on short intervals, where a
 * day either way matters least.
 */
const FUZZ_BANDS = [
  { start: 2.5, end: 7, factor: 0.15 },
  { start: 7, end: 20, factor: 0.1 },
  { start: 20, end: Number.POSITIVE_INFINITY, factor: 0.05 },
];

export function applyFuzz(intervalDays: number, elapsedDays: number, maxIntervalDays: number, rng: () => number): number {
  if (intervalDays < 2.5) return Math.max(1, Math.round(intervalDays * 1000) / 1000);

  const interval = Math.round(intervalDays);
  let delta = 1;
  for (const band of FUZZ_BANDS) {
    delta += band.factor * Math.max(Math.min(interval, band.end) - band.start, 0);
  }

  let min = Math.max(2, Math.round(interval - delta));
  const max = Math.min(Math.round(interval + delta), Math.round(maxIntervalDays));
  // When the model chose an interval longer than the card has already been
  // waiting, fuzz must not undercut that wait — scattering downwards would
  // schedule a card sooner than an interval it has already survived. An interval
  // genuinely shorter than the wait (an overdue card answered Hard) is left
  // alone; that is the model correcting itself, not fuzz.
  if (interval > elapsedDays) min = Math.max(min, Math.floor(elapsedDays) + 1);
  min = Math.min(min, max);

  return min + Math.floor(rng() * (max - min + 1));
}

/** Current recall probability for a card, used by stats, sorting and the widget. */
export function cardRetrievability(card: Card, now: Timestamp): number {
  if (card.state === 'new' || !card.lastReviewedAt) return 0;
  return retrievability(card.stability, Math.max(0, daysBetween(card.lastReviewedAt, now)));
}

/**
 * Recall probability projected to a future date, without scheduling anything.
 *
 * Assumes no further reviews, which is exactly the question exam readiness asks:
 * if I stopped studying now, how much of this would survive to exam day?
 */
export function projectedRetrievability(card: Card, at: Timestamp): number {
  if (card.state === 'new' || !card.lastReviewedAt) return 0;
  return retrievability(card.stability, Math.max(0, daysBetween(card.lastReviewedAt, at)));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
