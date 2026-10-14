import type {
  Card,
  ExampleSentence,
  LexicalEntry,
  ReviewLog,
  ReviewSource,
  StudyProfile,
  Timestamp,
} from '@mon/core';
import * as pb from './gen/mon/v1/mon_pb';
import {
  cardKindFromPbStrict,
  cardStateFromPb,
  languageFromPbStrict,
  ratingFromPb,
} from './enums';

/**
 * Wire to domain.
 *
 * The other half of `convert.ts`, and in the same package on purpose. The
 * encoders live beside the enum tables they use; putting the decoders anywhere
 * else would mean a second copy of those tables, and a second copy is how
 * `CARD_KIND_READING` ends up decoding to `'writing'` in exactly one direction —
 * a bug that drills the wrong skill and shows up in nobody's test.
 *
 * ## Absent, and zero
 *
 * In proto3 an absent scalar and its zero value are the same bytes, so decoding
 * has to decide which one the domain wants. The domain mostly uses optional
 * fields where the API uses `''` or `0`, so the rule here is: an empty string or
 * a zero that means "not set" is omitted rather than carried through as a value.
 * `createdAt: ''` on a card would be a card that claims to have been created at
 * the start of the epoch.
 */

export function entryFromPb(entry: pb.LexicalEntry): LexicalEntry {
  const examples: ExampleSentence[] = entry.examples.map((example) => ({
    target: example.target,
    ...(example.reading ? { reading: example.reading } : {}),
    translation: example.translation,
  }));

  return {
    id: entry.id,
    languageCode: languageFromPbStrict(entry.languageCode),
    target: entry.target,
    reading: entry.reading,
    meanings: entry.meanings,
    ...(entry.partOfSpeech ? { partOfSpeech: entry.partOfSpeech } : {}),
    levelIds: entry.levelIds,
    examples,
    ...(entry.tones.length > 0 ? { tones: entry.tones } : {}),
    ...(entry.components.length > 0 ? { components: entry.components } : {}),
    ...(entry.frequencyRank > 0 ? { frequencyRank: entry.frequencyRank } : {}),
    ...(entry.mnemonic ? { mnemonic: entry.mnemonic } : {}),
    tags: entry.tags,
  };
}

export function cardFromPb(card: pb.Card): Card {
  return {
    id: card.id,
    entryId: card.entryId,
    languageCode: languageFromPbStrict(card.languageCode),
    levelId: card.levelId,
    kind: cardKindFromPbStrict(card.kind),
    state: cardStateFromPb(card.state),
    stability: card.stability,
    difficulty: card.difficulty,
    step: card.step,
    due: card.due,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    elapsedMs: card.elapsedMs,
    // A card that has never been reviewed has no last-reviewed instant, and the
    // empty string is not one.
    ...(card.lastReviewedAt ? { lastReviewedAt: card.lastReviewedAt } : {}),
    ...(card.suspended ? { suspended: true } : {}),
    ...(card.buriedUntil ? { buriedUntil: card.buriedUntil } : {}),
    ...(card.leech ? { leech: true } : {}),
    createdAt: card.createdAt,
  };
}

/**
 * `now` is a parameter, and `existing` carries the local record forward.
 *
 * Reading the clock inside a decoder makes it impure and its tests
 * time-dependent, for two fields nothing in the product reads.
 */
export function profileFromPb(
  profile: pb.StudyProfile,
  now: Timestamp,
  existing?: StudyProfile,
): StudyProfile {
  return {
    languageCode: languageFromPbStrict(profile.languageCode),
    examTrackId: profile.examTrackId,
    targetLevelId: profile.targetLevelId,
    // Empty is how the API spells "no exam booked"; carrying it through as a
    // date would switch on exam-mode tightening against the epoch.
    ...(profile.examDate ? { examDate: profile.examDate } : {}),
    dailyNewLimit: profile.dailyNewLimit,
    dailyReviewLimit: profile.dailyReviewLimit,
    desiredRetention: profile.desiredRetention,
    dayStartHour: profile.dayStartHour,
    /*
     * The contract does not carry these, and a decoded profile needs them.
     *
     * They are bookkeeping for the local store rather than anything a learner
     * sees, and the alternative — adding them to the proto — would invite a
     * client to resolve conflicts by comparing them. It must not: the server's
     * profile wins, full stop, which is simpler to reason about than a
     * last-write-wins race between two devices with different clocks.
     */
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/** `source` is a plain string on the wire; anything unrecognised is treated as the app. */
const asSource = (value: string): ReviewSource => (value === 'widget' ? 'widget' : 'app');

export function reviewLogFromPb(log: pb.ReviewLogEntry): ReviewLog {
  return {
    id: log.id,
    cardId: log.cardId,
    entryId: log.entryId,
    reviewedAt: log.reviewedAt,
    rating: ratingFromPb(log.rating),
    stateBefore: cardStateFromPb(log.stateBefore),
    stateAfter: cardStateFromPb(log.stateAfter),
    stabilityBefore: log.stabilityBefore,
    stabilityAfter: log.stabilityAfter,
    difficultyBefore: log.difficultyBefore,
    difficultyAfter: log.difficultyAfter,
    elapsedDays: log.elapsedDays,
    scheduledDays: log.scheduledDays,
    predictedRetrievability: log.predictedRetrievability,
    durationMs: log.durationMs,
    source: asSource(log.source),
  };
}
