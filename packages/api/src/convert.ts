import type { MessageInitShape } from '@bufbuild/protobuf';
import type {
  Account,
  Card,
  DailyGoal,
  DeckEntry,
  ExamReadiness,
  ImportIssue,
  Journey,
  JourneyStage,
  LexicalEntry,
  Question,
  ReviewLog,
  StrugglingCard,
  StudyProfile,
} from '@mon/core';
import { describeStruggle } from '@mon/core';
import * as pb from './gen/mon/v1/mon_pb';
import {
  answerModeToPb,
  cardKindToPb,
  cardStateToPb,
  deckStatusToPb,
  languageToPb,
  ratingToPb,
} from './enums';

/**
 * A session, structurally.
 *
 * The backend's `Session` is declared in its own account store, which this
 * package must not depend on — the browser bundles this file, and nothing in a
 * browser should be able to reach for scrypt. The server's type satisfies this
 * one by shape, so the coupling runs the right way.
 */
export interface SessionLike {
  account: Account;
  token: string;
  refreshToken: string;
  expiresAt: string;
}

/**
 * Domain to wire.
 *
 * One direction only, and deliberately. Responses are built here; requests are
 * read field by field in the handlers, because a request is a few fields with
 * validation attached and a generic `fromPb` would have to decide what to do
 * with a missing one without knowing which RPC asked.
 *
 * The functions return init shapes rather than constructed messages. Connect
 * accepts either, and an init shape is a plain object — so these read as the
 * mapping they are, and an added proto field shows up as a type error here
 * rather than as a zero on a client.
 *
 * ## Why optionals mostly collapse to defaults
 *
 * In proto3 an absent scalar and its zero value are the same bytes, so
 * `buriedUntil ?? ''` loses nothing: the empty string *is* how "not buried" is
 * spelled on the wire. The exceptions are the places where zero is a real
 * measurement that must not be confused with no measurement — `weakest` on a
 * deck row — and those are `optional` in the proto so presence survives.
 */

export function accountToPb(account: Account): MessageInitShape<typeof pb.AccountSchema> {
  return {
    id: account.id,
    displayName: account.displayName,
    email: account.email ?? '',
    createdAt: account.createdAt,
  };
}

export function sessionToPb(session: SessionLike): MessageInitShape<typeof pb.SessionSchema> {
  return {
    account: accountToPb(session.account),
    token: session.token,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };
}

export function entryToPb(entry: LexicalEntry): MessageInitShape<typeof pb.LexicalEntrySchema> {
  return {
    id: entry.id,
    languageCode: languageToPb(entry.languageCode),
    target: entry.target,
    reading: entry.reading,
    meanings: entry.meanings,
    partOfSpeech: entry.partOfSpeech ?? '',
    levelIds: entry.levelIds,
    examples: entry.examples.map((example) => ({
      target: example.target,
      reading: example.reading ?? '',
      translation: example.translation,
    })),
    tones: entry.tones ?? [],
    components: entry.components ?? [],
    frequencyRank: entry.frequencyRank ?? 0,
    mnemonic: entry.mnemonic ?? '',
    tags: entry.tags,
  };
}

export function cardToPb(card: Card): MessageInitShape<typeof pb.CardSchema> {
  return {
    id: card.id,
    entryId: card.entryId,
    languageCode: languageToPb(card.languageCode),
    levelId: card.levelId,
    kind: cardKindToPb(card.kind),
    state: cardStateToPb(card.state),
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due,
    reps: card.reps,
    lapses: card.lapses,
    suspended: card.suspended ?? false,
    buriedUntil: card.buriedUntil ?? '',
    leech: card.leech ?? false,
    // The rest of the record, so a card survives a round trip. `step` is where a
    // learning card stands in its ladder; dropping it would restart every card
    // mid-learning on the way back.
    step: card.step,
    scheduledDays: card.scheduledDays,
    lastReviewedAt: card.lastReviewedAt ?? '',
    elapsedMs: card.elapsedMs,
    createdAt: card.createdAt,
  };
}

export function reviewLogToPb(log: ReviewLog): MessageInitShape<typeof pb.ReviewLogEntrySchema> {
  return {
    id: log.id,
    cardId: log.cardId,
    entryId: log.entryId,
    reviewedAt: log.reviewedAt,
    rating: ratingToPb(log.rating),
    durationMs: log.durationMs,
    source: log.source,
    stateBefore: cardStateToPb(log.stateBefore),
    stateAfter: cardStateToPb(log.stateAfter),
    stabilityBefore: log.stabilityBefore,
    stabilityAfter: log.stabilityAfter,
    difficultyBefore: log.difficultyBefore,
    difficultyAfter: log.difficultyAfter,
    elapsedDays: log.elapsedDays,
    scheduledDays: log.scheduledDays,
    predictedRetrievability: log.predictedRetrievability,
  };
}

export function questionToPb(question: Question): MessageInitShape<typeof pb.QuestionSchema> {
  return {
    card: {
      card: cardToPb(question.card.card),
      entry: entryToPb(question.card.entry),
    },
    mode: answerModeToPb(question.mode),
    options: question.options.map((option) => ({
      id: option.id,
      label: option.label,
      sublabel: option.sublabel ?? '',
      correct: option.correct,
    })),
    // Keyed by the rating's wire number, so a client reads previews[RATING_GOOD]
    // rather than knowing that Good happens to be 3.
    intervalPreviews: Object.fromEntries(
      Object.values(question.previews).map((preview) => [preview.rating, preview.display]),
    ),
  };
}

export function profileToPb(
  profile: StudyProfile,
): MessageInitShape<typeof pb.StudyProfileSchema> {
  return {
    languageCode: languageToPb(profile.languageCode),
    examTrackId: profile.examTrackId,
    targetLevelId: profile.targetLevelId,
    examDate: profile.examDate ?? '',
    dailyNewLimit: profile.dailyNewLimit,
    dailyReviewLimit: profile.dailyReviewLimit,
    desiredRetention: profile.desiredRetention,
    dayStartHour: profile.dayStartHour,
  };
}

export function goalToPb(goal: DailyGoal): MessageInitShape<typeof pb.DailyGoalSchema> {
  return {
    target: goal.target,
    done: goal.done,
    remaining: goal.remaining,
    complete: goal.complete,
    progress: goal.progress,
    drillsLeft: goal.drillsLeft,
  };
}

function stageToPb(stage: JourneyStage): MessageInitShape<typeof pb.JourneyStageSchema> {
  return {
    index: stage.index,
    native: stage.native,
    romanised: stage.romanised ?? '',
    meaning: stage.meaning,
    wordsRequired: stage.wordsRequired,
  };
}

export function journeyToPb(journey: Journey): MessageInitShape<typeof pb.JourneySchema> {
  return {
    languageCode: languageToPb(journey.languageCode),
    tradition: journey.tradition,
    stage: stageToPb(journey.stage),
    // Absent at the top of the ladder, which is also what makes `wordsToNext: 0`
    // unambiguous there.
    ...(journey.next ? { next: stageToPb(journey.next) } : {}),
    stageNumber: journey.stageNumber,
    totalStages: journey.totalStages,
    wordsKnown: journey.wordsKnown,
    wordsIntoStage: journey.wordsIntoStage,
    wordsToNext: journey.wordsToNext ?? 0,
    progress: journey.progress,
  };
}

/** The engine's `getStats` return, which is a structural type rather than a named one. */
type EngineStats = {
  streak: { current: number; longest: number };
  retention: {
    reviews: number;
    trueRetention: number;
    predictedRetention: number;
    averageSecondsPerCard: number;
  };
  retentionByKind: { kind: Parameters<typeof cardKindToPb>[0]; reviews: number; trueRetention: number }[];
  coverage: {
    entriesStarted: number;
    entriesKnown: number;
    available: number;
    syllabusTarget: number;
    fraction: number;
    syllabusFraction: number;
    newCards: number;
    learningCards: number;
    reviewCards: number;
    leeches: number;
  };
  forecast: { day: string; due: number; cumulative: number }[];
};

export function statsToPb(stats: EngineStats): MessageInitShape<typeof pb.StatsSchema> {
  return {
    currentStreak: stats.streak.current,
    longestStreak: stats.streak.longest,
    coverage: {
      entriesStarted: stats.coverage.entriesStarted,
      entriesKnown: stats.coverage.entriesKnown,
      available: stats.coverage.available,
      syllabusTarget: stats.coverage.syllabusTarget,
      fraction: stats.coverage.fraction,
      syllabusFraction: stats.coverage.syllabusFraction,
      newCards: stats.coverage.newCards,
      learningCards: stats.coverage.learningCards,
      reviewCards: stats.coverage.reviewCards,
      leeches: stats.coverage.leeches,
    },
    trueRetention: stats.retention.trueRetention,
    predictedRetention: stats.retention.predictedRetention,
    averageSecondsPerCard: stats.retention.averageSecondsPerCard,
    retentionReviews: stats.retention.reviews,
    retentionByKind: stats.retentionByKind.map((row) => ({
      kind: cardKindToPb(row.kind),
      reviews: row.reviews,
      trueRetention: row.trueRetention,
    })),
    forecast: stats.forecast.map((day) => ({
      day: day.day,
      due: day.due,
      cumulative: day.cumulative,
    })),
  };
}

export function readinessToPb(
  readiness: ExamReadiness,
): MessageInitShape<typeof pb.ReadinessSchema> {
  return {
    levelId: readiness.levelId,
    levelName: readiness.levelName,
    examDate: readiness.examDate ?? '',
    daysToExam: readiness.daysToExam ?? 0,
    score: readiness.score,
    coverage: readiness.coverage,
    syllabusCoverage: readiness.syllabusCoverage,
    syllabusShortfall: readiness.syllabusShortfall,
    projectedRecall: readiness.projectedRecall,
    wordsRemaining: readiness.wordsRemaining,
    paceIsSufficient: readiness.paceIsSufficient,
    /*
     * Rounded up, and an integer on the wire deliberately.
     *
     * The domain computes `wordsRemaining / daysRemaining`, which is 0.3 as
     * often as it is 12 — and "learn 0.3 new words a day" is not an instruction.
     * Ceiling is also the safe direction: rounding down tells a learner a pace
     * that misses the exam.
     *
     * It stays consistent with `paceIsSufficient`, which the domain computes as
     * `dailyNewLimit >= requiredNewPerDay`: for an integer limit,
     * `ceil(required) <= limit` is true exactly when `required <= limit` is.
     *
     * (The binary codec is what caught this — it refuses a fractional int32
     * outright, where JSON would have quietly shipped 0.3 to a Swift `Int32`.)
     */
    requiredNewPerDay: Math.ceil(readiness.requiredNewPerDay),
    plannedNewPerDay: readiness.plannedNewPerDay,
    verdict: readiness.verdict,
    headline: readiness.headline,
  };
}

export function deckEntryToPb(row: DeckEntry): MessageInitShape<typeof pb.DeckEntrySchema> {
  return {
    entry: entryToPb(row.entry),
    cards: row.cards.map(cardToPb),
    status: deckStatusToPb(row.status),
    dueNow: row.dueNow,
    ...(row.weakest !== undefined ? { weakest: row.weakest } : {}),
    nextDueAt: row.nextDueAt ?? '',
    inScope: row.inScope,
  };
}

export function strugglingToPb(
  struggling: StrugglingCard,
): MessageInitShape<typeof pb.StrugglingCardSchema> {
  return {
    card: cardToPb(struggling.card),
    entry: entryToPb(struggling.entry),
    reason: struggling.reason,
    // Written server-side so every client says the same sentence about the same
    // card — and so the sentence can be improved without shipping three apps.
    description: describeStruggle(struggling),
    lapses: struggling.lapses,
    failureRate: struggling.failureRate,
    reviews: struggling.reviews,
  };
}

export function importIssueToPb(
  issue: ImportIssue,
): MessageInitShape<typeof pb.ImportIssueSchema> {
  return {
    row: issue.row,
    field: issue.field ?? '',
    message: issue.message,
    isError: issue.severity === 'error',
  };
}
