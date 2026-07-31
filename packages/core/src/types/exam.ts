import type { LanguageCode } from './language';

/**
 * The kinds of prompt a card can present. Exams do not test vocabulary in one
 * uniform way — HSK 1 never asks you to handwrite a character, TOPIK II has a
 * whole writing section, and every one of these exams is at least half
 * listening. Each exam level declares how much weight to give each kind, and
 * the session builder uses those weights to compose a queue that looks like
 * the real paper instead of a flat word list.
 */
export type CardKind =
  /** Prompt shows the target word; recall the meaning. */
  | 'recognition'
  /** Prompt shows the meaning; produce the target word. */
  | 'production'
  /** Prompt plays audio; identify the word. */
  | 'listening'
  /** Prompt shows a sentence with a gap; choose or recall the missing word. */
  | 'reading'
  /** Prompt asks for the written form — handwriting or spelling from memory. */
  | 'writing'
  /** Prompt drills a grammar pattern rather than a single lexical item. */
  | 'grammar'
  /** Prompt asks for the tone pattern of a word (Mandarin, Vietnamese). */
  | 'tone'
  /** Prompt drills a script unit: kana, hangul jamo, or a character component. */
  | 'script';

export const CARD_KINDS: CardKind[] = [
  'recognition',
  'production',
  'listening',
  'reading',
  'writing',
  'grammar',
  'tone',
  'script',
];

/** Relative weights for how often each card kind should appear in a session. */
export type CardKindWeights = Partial<Record<CardKind, number>>;

/** The four language skills exams report on. */
export type ExamSkill = 'listening' | 'reading' | 'writing' | 'speaking';

/** One scored part of an exam paper. */
export interface ExamSection {
  id: string;
  name: string;
  skill: ExamSkill;
  /** Number of questions, where the format is fixed and published. */
  questionCount?: number;
  /** Points available for this section. */
  maxScore?: number;
  /** Minutes allotted, excluding admin time. */
  durationMinutes?: number;
  /** Lowest score in this section that still allows an overall pass. */
  minimumScore?: number;
}

/**
 * A single certifiable level within an exam track, e.g. HSK 4 or JLPT N2.
 *
 * Vocabulary and character targets are cumulative — the number a candidate is
 * expected to know by the time they sit that level, not the number added at
 * that level — because that is how the official syllabuses state them and how
 * a learner thinks about coverage.
 */
export interface ExamLevel {
  /** Stable id, namespaced by track, e.g. "jlpt-n3". */
  id: string;
  /** Full display name, e.g. "JLPT N3". */
  name: string;
  /** Compact name for widgets and chips, e.g. "N3". */
  shortName: string;
  /** 1-based position in the track, easiest first. */
  order: number;
  /** Roughly equivalent CEFR band, where the authority publishes a mapping. */
  cefr?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  /** Cumulative vocabulary expected by this level. */
  vocabularyTarget: number;
  /** Cumulative characters (hanzi/kanji/hanja) expected by this level. */
  characterTarget?: number;
  /** Cumulative grammar points expected by this level. */
  grammarPointTarget?: number;
  sections: ExamSection[];
  /** Total marks available across all sections. */
  totalScore?: number;
  /** Marks needed to pass. */
  passingScore?: number;
  /** How the level is usually described to learners. */
  description: string;
  /** How much of a study session each card kind should occupy at this level. */
  cardWeights: CardKindWeights;
}

/**
 * A family of levels administered as one exam by one authority. Mandarin has
 * two live tracks because HSK 3.0 (nine levels) is replacing HSK 2.0 (six
 * levels) but both are still sat, and a learner needs to study for whichever
 * paper they have actually booked.
 */
export interface ExamTrack {
  id: string;
  languageCode: LanguageCode;
  /** Short name, e.g. "HSK". */
  name: string;
  /** Full official name. */
  fullName: string;
  /** Body that sets and administers the exam. */
  authority: string;
  levels: ExamLevel[];
  /** Learner-facing note on when to pick this track over a sibling. */
  note?: string;
  /** Where the figures came from, so they can be re-checked. */
  source: string;
  /**
   * True when the vocabulary/character targets are published as official word
   * lists, false when they are widely-cited community estimates. Surfaced in
   * the UI so progress bars are not read as more precise than they are.
   */
  targetsAreOfficial: boolean;
}
