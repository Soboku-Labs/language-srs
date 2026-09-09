import { findExamLevel, getVocabularyDelta } from '../exams';
import { projectedRetrievability } from '../srs/scheduler';
import type { Card, DateOnly, StudyProfile, Timestamp } from '../types/card';
import { calendarDaysBetween } from '../utils/date';
import { computeCoverage, type CoverageStats } from './metrics';

export type ReadinessVerdict = 'no-exam-set' | 'not-started' | 'behind' | 'on-track' | 'ready' | 'exam-passed';

export interface ExamReadiness {
  levelId: string;
  levelName: string;
  examDate?: DateOnly;
  daysToExam?: number;

  /**
   * Overall readiness, 0-1. The product of the two components below, because
   * they are both necessary and neither substitutes for the other: knowing 40%
   * of the syllabus perfectly and knowing 100% of it at 40% recall are both
   * roughly 40% ready.
   */
  score: number;

  /** Share of the words the deck holds for this level that are known. */
  coverage: number;
  /** Share of the exam's own vocabulary target that is known. */
  syllabusCoverage: number;
  /**
   * Words the exam expects that the deck does not contain.
   *
   * The honest caveat on every other number here. With a seed deck of a few dozen
   * words against a syllabus of hundreds, a learner can finish everything the app
   * has and still be nowhere near the paper — and the app has to say so rather
   * than let a full progress bar imply otherwise.
   */
  syllabusShortfall: number;
  /**
   * Mean recall probability on exam day across everything studied, assuming no
   * further reviews. This is what makes the number honest — it decays if the
   * learner stops, rather than freezing at whatever was once learned.
   */
  projectedRecall: number;

  /** New words per day needed from now to cover the level by exam day. */
  requiredNewPerDay: number;
  /** New words per day the current daily limit actually allows. */
  plannedNewPerDay: number;
  /** Whether the daily limit is enough to finish the syllabus in time. */
  paceIsSufficient: boolean;
  /** Words in the level's scope not yet started. */
  wordsRemaining: number;

  verdict: ReadinessVerdict;
  /** One-line summary suitable for the dashboard and the widget. */
  headline: string;
}

/** Hour of exam day to project recall to. Most of these papers start mid-morning. */
const EXAM_START_HOUR = 9;

/**
 * How ready the learner is for their booked exam.
 *
 * Deliberately pessimistic in one specific way: recall is projected forward with
 * no further reviews assumed. A learner three months out with a booked exam
 * should see a number that reflects what would happen if they stopped today,
 * because the alternative — counting scheduled-but-not-yet-done reviews as
 * knowledge — is how study apps end up telling people they are ready when they
 * are not.
 */
export function computeExamReadiness(
  cards: Card[],
  profile: StudyProfile,
  now: Timestamp,
  /** Words the deck holds in this level's scope. Defaults to what the cards imply. */
  available?: number,
): ExamReadiness {
  const level = findExamLevel(profile.targetLevelId);
  const levelName = level?.name ?? profile.targetLevelId;
  const syllabusTarget = level?.vocabularyTarget ?? 0;

  const inScope = cards.filter((card) => !card.suspended);
  // Falling back to the distinct entries the cards cover keeps this correct for
  // callers that have not counted the deck themselves.
  const deckSize = available ?? new Set(inScope.map((card) => card.entryId)).size;
  const coverage = computeCoverage(inScope, { available: deckSize, syllabusTarget });

  const wordsRemaining = Math.max(0, deckSize - coverage.entriesStarted);
  const syllabusShortfall = Math.max(0, syllabusTarget - deckSize);

  if (!profile.examDate) {
    return {
      levelId: profile.targetLevelId,
      levelName,
      score: coverage.fraction,
      coverage: coverage.fraction,
      syllabusCoverage: coverage.syllabusFraction,
      syllabusShortfall,
      projectedRecall: 0,
      requiredNewPerDay: 0,
      plannedNewPerDay: profile.dailyNewLimit,
      paceIsSufficient: true,
      wordsRemaining,
      verdict: 'no-exam-set',
      headline: describeDeckProgress({ levelName, coverage, syllabusShortfall }),
    };
  }

  const daysToExam = calendarDaysBetween(now, profile.examDate);

  if (daysToExam < 0) {
    return {
      levelId: profile.targetLevelId,
      levelName,
      examDate: profile.examDate,
      daysToExam,
      score: coverage.fraction,
      coverage: coverage.fraction,
      syllabusCoverage: coverage.syllabusFraction,
      syllabusShortfall,
      projectedRecall: 0,
      requiredNewPerDay: 0,
      plannedNewPerDay: profile.dailyNewLimit,
      paceIsSufficient: true,
      wordsRemaining,
      verdict: 'exam-passed',
      headline: `${levelName} exam date has passed. Set the next one to keep the schedule tuned.`,
    };
  }

  const examInstant = `${profile.examDate}T${String(EXAM_START_HOUR).padStart(2, '0')}:00:00.000Z`;
  const studied = inScope.filter((card) => card.state !== 'new');
  const projectedRecall =
    studied.length > 0
      ? studied.reduce((sum, card) => sum + projectedRetrievability(card, examInstant), 0) / studied.length
      : 0;

  const effectiveDays = Math.max(1, daysToExam);
  // Paced against the words that exist. Dividing the exam's own target by the
  // days left demanded 30 new words a day from a deck holding 27 in total, and
  // then called the learner "behind" for not doing it.
  const requiredNewPerDay = wordsRemaining / effectiveDays;
  const paceIsSufficient = profile.dailyNewLimit >= requiredNewPerDay;

  /**
   * Readiness for the paper, not for the deck.
   *
   * Grounded in `syllabusFraction` on purpose. Someone who has mastered all 27
   * words the app holds is 100% through their deck and is not ready for a
   * 500-word exam, and this is the number that has to keep saying so.
   */
  const score = clamp01(coverage.syllabusFraction * projectedRecall);

  const verdict = decideVerdict({
    score,
    coverage: coverage.fraction,
    started: coverage.entriesStarted,
    paceIsSufficient,
    daysToExam,
  });

  return {
    levelId: profile.targetLevelId,
    levelName,
    examDate: profile.examDate,
    daysToExam,
    score,
    coverage: coverage.fraction,
    syllabusCoverage: coverage.syllabusFraction,
    syllabusShortfall,
    projectedRecall,
    requiredNewPerDay,
    plannedNewPerDay: profile.dailyNewLimit,
    paceIsSufficient,
    wordsRemaining,
    verdict,
    headline: buildHeadline({
      levelName,
      daysToExam,
      score,
      verdict,
      requiredNewPerDay,
      plannedNewPerDay: profile.dailyNewLimit,
      syllabusShortfall,
    }),
  };
}

/**
 * The no-exam headline.
 *
 * Says what was learned out of what is here, then names the gap to the real
 * syllabus rather than leaving "100%" to be read as "ready".
 */
function describeDeckProgress(input: {
  levelName: string;
  coverage: CoverageStats;
  syllabusShortfall: number;
}): string {
  const { entriesKnown, available, syllabusTarget } = input.coverage;

  if (available === 0) {
    return `No ${input.levelName} words in your deck yet. Import a word list to start this level.`;
  }

  const progress = `${entriesKnown} of ${available} ${input.levelName} words in your deck known.`;
  if (input.syllabusShortfall > 0 && syllabusTarget > 0) {
    return `${progress} The exam covers ${syllabusTarget.toLocaleString()} — ${input.syllabusShortfall.toLocaleString()} are not in the deck.`;
  }
  return `${progress} Set an exam date to track readiness.`;
}

function decideVerdict(input: {
  score: number;
  coverage: number;
  started: number;
  paceIsSufficient: boolean;
  daysToExam: number;
}): ReadinessVerdict {
  if (input.started === 0) return 'not-started';
  if (input.score >= 0.85) return 'ready';
  if (!input.paceIsSufficient) return 'behind';
  // Close to the exam, "on track" stops being meaningful — the score is the score.
  if (input.daysToExam <= 14 && input.score < 0.6) return 'behind';
  return 'on-track';
}

function buildHeadline(input: {
  levelName: string;
  daysToExam: number;
  score: number;
  verdict: ReadinessVerdict;
  requiredNewPerDay: number;
  plannedNewPerDay: number;
  syllabusShortfall: number;
}): string {
  const percent = Math.round(input.score * 100);
  const days = input.daysToExam === 0 ? 'today' : `in ${input.daysToExam} day${input.daysToExam === 1 ? '' : 's'}`;

  switch (input.verdict) {
    case 'not-started':
      return `${input.levelName} ${days}. Nothing studied yet — start with today's new words.`;
    case 'behind':
      // When the deck cannot reach the syllabus, "study faster" is not the
      // advice — no daily limit closes a gap made of words that are not there.
      if (input.syllabusShortfall > 0) {
        return `${percent}% ready for ${input.levelName} ${days}. Your deck is ${input.syllabusShortfall.toLocaleString()} words short of the syllabus — import more to close it.`;
      }
      return `${percent}% ready for ${input.levelName} ${days}. Needs ${Math.ceil(
        input.requiredNewPerDay,
      )} new words a day; the limit is ${input.plannedNewPerDay}.`;
    case 'ready':
      return `${percent}% ready for ${input.levelName} ${days}. Keep reviews clear and hold the line.`;
    default:
      return `${percent}% ready for ${input.levelName} ${days}. On pace at ${input.plannedNewPerDay} new words a day.`;
  }
}

/**
 * Suggested daily new-card limit to finish by exam day.
 *
 * Uses the level's delta rather than the cumulative target, on the assumption
 * that a learner sitting N2 already has N3 behind them. Padded by 15% for the
 * days nobody studies.
 *
 * Capped at the words actually available when the caller knows that number. The
 * uncapped version suggested a pace drawn from the size of the real syllabus,
 * which on a deck of a few dozen words meant recommending a daily limit an order
 * of magnitude beyond anything the app could serve.
 */
export function suggestDailyNewLimit(
  levelId: string,
  now: Timestamp,
  examDate: DateOnly,
  available?: number,
): number {
  const days = Math.max(1, calendarDaysBetween(now, examDate));
  const delta = getVocabularyDelta(levelId);
  const words = available !== undefined ? Math.min(delta, available) : delta;
  return Math.max(1, Math.ceil((words / days) * 1.15));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
