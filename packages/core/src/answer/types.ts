import type { CardKind } from '../types/exam';

/**
 * How a card is answered.
 *
 * Until now every card was self-graded: reveal, then tell the app how it went.
 * That is fine for drilling and wrong for these exams. HSK, JLPT and TOPIK are
 * almost entirely multiple choice — a learner who has only ever self-graded has
 * never practised the thing they will actually be asked to do, which is to pick
 * the right option out of four while three plausible ones sit next to it.
 *
 * Self-grading is kept, because it is genuinely the right mode for handwriting
 * (the answer is on paper, not on screen) and as a fallback when a card has no
 * usable distractors.
 */
export type AnswerMode =
  /** Four options, one right. What the exam papers actually do. */
  | 'choice'
  /** Type the answer. Recall rather than recognition — harder, and worth it. */
  | 'typed'
  /** Pick the tone of each syllable. Mandarin and Vietnamese only. */
  | 'tone'
  /** Reveal and grade yourself. Handwriting, and the fallback. */
  | 'self';

export interface AnswerOption {
  /** Stable within a question, for keying and for reporting the choice. */
  id: string;
  label: string;
  /** Secondary line, e.g. a reading under a target word. */
  sublabel?: string;
  correct: boolean;
}

/** How close a typed answer was. */
export type AnswerQuality =
  /** Right. */
  | 'exact'
  /**
   * Right in substance, wrong in a detail that matters — the letters without the
   * tones, the reading instead of the kanji, one character out. Worth telling
   * apart from a miss, because the learner knows the word and needs the detail.
   */
  | 'close'
  | 'wrong';

export interface AnswerCheck {
  quality: AnswerQuality;
  /** Whether this counts as a success for scheduling. */
  correct: boolean;
  /** The answer that was wanted, for display. */
  expected: string;
  /** What was wrong, when it is worth saying. */
  note?: string;
}

/**
 * What the learner did, handed to the scheduler-facing helpers.
 *
 * `correct` is stated rather than inferred. An earlier version worked it out from
 * whichever field happened to be set, which read as reasonable and was wrong for
 * multiple choice: "an option was chosen" is true whether or not it was the right
 * one, so every answered question scored as correct.
 */
export interface AnswerAttempt {
  mode: AnswerMode;
  correct: boolean;
  /** For `choice` and `tone`. */
  chosenOptionId?: string;
  /** For `typed`. */
  text?: string;
  check?: AnswerCheck;
  /** Milliseconds from the card appearing to the answer landing. */
  durationMs: number;
}

/** Card kinds whose prompt is the target word and whose answer is its meaning. */
export const MEANING_KINDS: CardKind[] = ['recognition', 'listening', 'script', 'grammar'];

/** Card kinds that ask the learner to produce the target form. */
export const PRODUCTION_KINDS: CardKind[] = ['production', 'writing', 'reading'];
