import { gradeCard, type GradeOptions } from '../srs/scheduler';
import type { Card, StudyProfile, Timestamp } from '../types/card';
import type { Rating, ReviewLog } from '../types/review';
import { toEpochMs } from '../utils/date';

/**
 * A grading made on the home screen, queued for the app to apply.
 *
 * An interactive widget can grade a card while the app is not running. It could
 * try to run the scheduler itself, but that would mean a second implementation
 * of FSRS in Swift and a third in Kotlin, and they would disagree. Instead the
 * widget appends one of these to shared storage — a card id, a rating, and when
 * it happened, which is all it actually knows — and the app replays them through
 * the real scheduler next time it opens.
 *
 * The cost is that the interval shown on the widget button is a prediction that
 * the app confirms later. Since the widget got that prediction from
 * `previewIntervals` in the same payload, it agrees with what the app computes
 * unless the card was also graded elsewhere in between.
 */
export interface PendingWidgetGrade {
  cardId: string;
  rating: Rating;
  gradedAt: Timestamp;
  durationMs?: number;
}

export interface ApplyPendingResult {
  /** Cards that changed, keyed by id, ready to be written back. */
  updated: Map<string, Card>;
  logs: ReviewLog[];
  applied: number;
  /** Gradings dropped, with the reason, so the app can report rather than silently lose them. */
  skipped: { grade: PendingWidgetGrade; reason: 'card-not-found' | 'stale' | 'duplicate' }[];
}

export interface ApplyPendingOptions {
  profile: StudyProfile;
  config?: GradeOptions['config'];
}

/**
 * Replay queued widget gradings through the real scheduler.
 *
 * Ordered by grading time, so a card graded twice from the widget walks its step
 * ladder in the order the taps happened.
 *
 * Conflict rule: a grading is dropped as stale if the card has already been
 * reviewed at or after the moment the widget recorded it. That happens when the
 * learner grades a card in the app and only later opens it on the device holding
 * the widget's queue. Applying the older tap would rewind fresher memory state,
 * so the newer review wins.
 */
export function applyPendingGrades(
  cards: Card[],
  pending: PendingWidgetGrade[],
  options: ApplyPendingOptions,
): ApplyPendingResult {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const updated = new Map<string, Card>();
  const logs: ReviewLog[] = [];
  const skipped: ApplyPendingResult['skipped'] = [];
  const seen = new Set<string>();

  const ordered = [...pending].sort((a, b) => toEpochMs(a.gradedAt) - toEpochMs(b.gradedAt));

  for (const grade of ordered) {
    const fingerprint = `${grade.cardId}@${grade.gradedAt}`;
    if (seen.has(fingerprint)) {
      skipped.push({ grade, reason: 'duplicate' });
      continue;
    }
    seen.add(fingerprint);

    const card = updated.get(grade.cardId) ?? byId.get(grade.cardId);
    if (!card) {
      skipped.push({ grade, reason: 'card-not-found' });
      continue;
    }

    if (card.lastReviewedAt && toEpochMs(card.lastReviewedAt) >= toEpochMs(grade.gradedAt)) {
      skipped.push({ grade, reason: 'stale' });
      continue;
    }

    const result = gradeCard(card, grade.rating, {
      now: grade.gradedAt,
      ...(options.config ? { config: options.config } : {}),
      ...(options.profile.examDate ? { examDate: options.profile.examDate } : {}),
      ...(grade.durationMs !== undefined ? { durationMs: grade.durationMs } : {}),
      source: 'widget',
    });

    updated.set(result.card.id, result.card);
    logs.push(result.log);
  }

  return { updated, logs, applied: logs.length, skipped };
}
