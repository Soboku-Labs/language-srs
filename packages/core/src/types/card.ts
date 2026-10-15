import type { CardKind } from './exam';
import type { LanguageCode, ScriptId } from './language';

/**
 * An ISO-8601 instant, e.g. "2026-03-14T09:00:00.000Z".
 *
 * Timestamps are strings rather than Date objects throughout the domain. Cards
 * cross three serialisation boundaries — AsyncStorage on device, localStorage
 * on web, and the App Group / SharedPreferences blob the home-screen widget
 * reads — and a Date survives none of them. Keeping the wire format as the
 * in-memory format means there is exactly one representation to reason about.
 */
export type Timestamp = string;

/** A calendar date with no time component, e.g. "2026-03-14". */
export type DateOnly = string;

/** One target-language item a learner is trying to acquire. */
export interface LexicalEntry {
  id: string;
  languageCode: LanguageCode;
  /** The canonical written form: 你好, こんにちは, 안녕하세요, xin chào. */
  target: string;
  /** Alternative written forms, e.g. traditional hanzi or a kanji spelling. */
  variants?: { script: ScriptId; form: string }[];
  /** Pronunciation in the language's usual transcription. */
  reading: string;
  /** English glosses, most common first. */
  meanings: string[];
  partOfSpeech?: string;
  /**
   * Exam levels this item belongs to. Usually one — the level whose word list
   * introduces it — but an item can legitimately sit in two tracks (HSK 2.0 and
   * HSK 3.0 word lists overlap heavily).
   */
  levelIds: string[];
  examples: ExampleSentence[];
  /**
   * Per-syllable tone numbers for tonal languages. Mandarin uses 1-4 with 5 for
   * the neutral tone; Vietnamese uses 1-6 in the order ngang, huyền, sắc, hỏi,
   * ngã, nặng. Drives the tone card kind and lets the UI colour syllables.
   */
  tones?: number[];
  /** Character components or radicals, for character-decomposition study. */
  components?: string[];
  /** Rank in a frequency list, if known; lower is more common. */
  frequencyRank?: number;
  audioUrl?: string;
  /** A memory hook, either authored or learner-supplied. */
  mnemonic?: string;
  tags: string[];
}

export interface ExampleSentence {
  target: string;
  reading?: string;
  translation: string;
}

/** Where a card sits in its learning lifecycle. */
export type CardState =
  /** Never studied. */
  | 'new'
  /** In the initial learning steps, intervals measured in minutes. */
  | 'learning'
  /** Graduated, intervals measured in days. */
  | 'review'
  /** Lapsed from review and working back through the relearning steps. */
  | 'relearning';

/**
 * One scheduled prompt about one lexical entry.
 *
 * A single entry produces several cards — recognition, listening, writing —
 * each with independent memory state, because knowing that 書く means "to
 * write" is a different memory from being able to produce it from a spoken
 * prompt. The exam level's card weights decide which kinds get generated.
 */
export interface Card {
  id: string;
  entryId: string;
  languageCode: LanguageCode;
  /** The exam level that introduces this card's entry. */
  levelId: string;
  kind: CardKind;
  state: CardState;
  /**
   * FSRS memory stability, in days: the interval at which recall probability
   * has decayed to 90%. Zero for a new card.
   */
  stability: number;
  /** FSRS difficulty on a 1-10 scale. Zero for a new card. */
  difficulty: number;
  /** Position in the learning or relearning step ladder. */
  step: number;
  /** When this card next comes up. New cards carry the time they were created. */
  due: Timestamp;
  lastReviewedAt?: Timestamp;
  /** Interval in days that produced the current due date. */
  scheduledDays: number;
  /** Total gradings, including lapses. */
  reps: number;
  /** Times this card has fallen out of review. Drives leech detection. */
  lapses: number;
  /** Cumulative time spent answering, in milliseconds. */
  elapsedMs: number;
  /** Excluded from scheduling until manually unsuspended. */
  suspended?: boolean;
  /** Held back until this instant, without touching memory state. */
  buriedUntil?: Timestamp;
  /** Set once a card trips the leech threshold, so the UI can offer to reword it. */
  leech?: boolean;
  createdAt: Timestamp;
}

/** A card joined to its entry, which is what the review UI actually renders. */
export interface CardWithEntry {
  card: Card;
  entry: LexicalEntry;
}

/** Per-language study configuration, one row per language the learner studies. */
export interface StudyProfile {
  languageCode: LanguageCode;
  examTrackId: string;
  /** The level being studied for. Scope is this level and everything below it. */
  targetLevelId: string;
  /** Exam day, if booked. Switches the scheduler into exam mode. */
  examDate?: DateOnly;
  /** New cards introduced per day. */
  dailyNewLimit: number;
  /** Reviews served per day, excluding new cards and relearning. */
  dailyReviewLimit: number;
  /**
   * Target recall probability at the moment a card comes up, 0.7-0.98.
   * Higher means shorter intervals and more reviews per day.
   */
  desiredRetention: number;
  /**
   * Card kinds to generate, overriding the exam level's defaults. Left unset,
   * the level's own weights decide — which is the exam-faithful behaviour.
   */
  enabledCardKinds?: CardKind[];
  /**
   * @deprecated Moved to the account. Read `StudyEngine.dayStartHour` instead.
   *
   * One person had as many study days as they had languages, so a 2am sitting
   * counted towards different dates depending on which language it was in. The
   * field stays so an older build reading the same synced blob still finds it,
   * and `migrateMeta` carries any value that was set here up to the account.
   */
  dayStartHour: number;
  /**
   * When the learner said what they wanted from this language.
   *
   * Absent means they have not been asked yet. The engine creates a profile
   * the moment a language is touched — it needs something to schedule against
   * — so the existence of a profile says nothing about whether anybody chose
   * anything, and the app was treating the two as the same thing. This is the
   * difference: a default the app picked, or an answer somebody gave.
   */
  setUpAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const DEFAULT_STUDY_PROFILE: Omit<
  StudyProfile,
  'languageCode' | 'examTrackId' | 'targetLevelId' | 'createdAt' | 'updatedAt'
> = {
  dailyNewLimit: 15,
  dailyReviewLimit: 120,
  desiredRetention: 0.9,
  dayStartHour: 4,
};
