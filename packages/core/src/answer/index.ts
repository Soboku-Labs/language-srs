import type { Rating } from '../types/review';
import type { AnswerAttempt } from './types';

export * from './types';
export * from './options';
export * from './check';

/**
 * Turn an answer into a suggested rating.
 *
 * A wrong answer is Again and there is nothing to ask about — the learner did not
 * know it, and putting a four-button dialog in front of them is a ceremony with
 * one sensible outcome.
 *
 * A right answer is where the judgement lives, and only the learner has it: the
 * app can see that it took eleven seconds but not whether that was hesitation or
 * a distraction. So a rating is *suggested* from speed and the buttons stay
 * available. Fast and confident suggests Easy, laboured suggests Hard, and
 * everything between is Good.
 *
 * The thresholds are per-mode because the modes cost different amounts of time.
 * Typing an answer on a phone is slow in a way that says nothing about recall.
 */
export function suggestRating(attempt: AnswerAttempt): Rating {
  if (!attempt.correct) return 1;

  const seconds = attempt.durationMs / 1000;

  if (attempt.mode === 'typed') {
    if (seconds <= 6) return 4;
    if (seconds >= 20) return 2;
    return 3;
  }

  if (seconds <= 3) return 4;
  if (seconds >= 10) return 2;
  return 3;
}

/**
 * Whether a wrong answer should skip straight to being graded.
 *
 * True for the modes where the app knows the answer was wrong. In self-graded
 * mode it does not, so nothing is assumed.
 */
export function isAutoGraded(attempt: AnswerAttempt): boolean {
  return attempt.mode !== 'self' && !attempt.correct;
}
