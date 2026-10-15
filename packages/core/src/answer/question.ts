import { previewIntervals, type IntervalPreview } from '../srs/scheduler';
import type { CardWithEntry, LexicalEntry, StudyProfile, Timestamp } from '../types/card';
import type { Rating } from '../types/review';
import { buildChoiceOptions, buildToneOptions, resolveAnswerMode } from './options';
import type { AnswerMode, AnswerOption } from './types';

/**
 * A card, ready to be asked.
 *
 * Mode, distractors and the four interval previews, assembled once.
 *
 * This exists because the same twenty lines were being written in every client:
 * resolve the mode, branch on it to pick the right option builder, and compute
 * the previews with the profile's retention and exam date threaded through. Three
 * copies of a branch is three chances for one platform to ask a card differently
 * from another — the iOS app offering four choices where the web app reveals, for
 * a learner studying the same deck on both.
 *
 * It also makes the shape the API serves the shape the clients already use, so
 * the server translates a `Question` rather than inventing one.
 */
export interface Question {
  card: CardWithEntry;
  mode: AnswerMode;
  /** Empty for `typed` and `self`, which have nothing to choose between. */
  options: AnswerOption[];
  /** What each of the four buttons would do. */
  previews: Record<Rating, IntervalPreview>;
}

export interface BuildQuestionOptions {
  pair: CardWithEntry;
  /** The candidate pool distractors are drawn from — usually every entry in the language. */
  pool: LexicalEntry[];
  profile: StudyProfile;
  now: Timestamp;
  /**
   * What the learner asked for, honoured only where it is possible. A preference
   * for typing on a card with no usable keyboard falls back rather than failing.
   */
  preferred?: AnswerMode;
}

export function buildQuestion(options: BuildQuestionOptions): Question {
  const { pair, pool, profile, now } = options;
  const { card, entry } = pair;

  const mode = resolveAnswerMode(card, entry, pool, options.preferred);

  return {
    card: pair,
    mode,
    options:
      mode === 'tone'
        ? buildToneOptions({ card, entry, pool })
        : mode === 'choice'
          ? buildChoiceOptions({ card, entry, pool })
          : [],
    previews: previewIntervals(card, {
      now,
      config: { desiredRetention: profile.desiredRetention },
      ...(profile.examDate ? { examDate: profile.examDate } : {}),
    }),
  };
}
