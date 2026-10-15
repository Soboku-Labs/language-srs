import { CARD_KINDS, type CardKind } from './exam';
/** ISO 639-1 codes for the languages the app supports. */
export type LanguageCode = 'zh' | 'ja' | 'ko' | 'vi';

/** A writing system a learner has to deal with for a given language. */
export type ScriptId =
  | 'hanzi-simplified'
  | 'hanzi-traditional'
  | 'pinyin'
  | 'hiragana'
  | 'katakana'
  | 'kanji'
  | 'romaji'
  | 'hangul'
  | 'hanja'
  | 'latin-vietnamese';

/**
 * Static, non-exam facts about a language: which scripts it uses, how its
 * pronunciation is transcribed, and whether it is tonal. The review UI and the
 * card generators both key off this — a tonal language gets tone drills, a
 * language with a syllabary gets script-conversion cards, and so on.
 */
export interface LanguageProfile {
  code: LanguageCode;
  /** English name, e.g. "Mandarin Chinese". */
  name: string;
  /** Name in the language itself, e.g. "中文". */
  endonym: string;
  /** Short label for compact UI and widgets, e.g. "ZH". */
  badge: string;
  /** Emoji used as a glanceable marker in lists and on the widget. */
  emoji: string;
  scripts: ScriptId[];
  /** What the `reading` field of a card holds, e.g. "Pinyin", "Furigana". */
  romanizationName: string;
  tonal: boolean;
  /** Number of contrastive tones, counting the neutral tone where relevant. */
  toneCount: number;
  /** Exam tracks available for this language, most commonly used first. */
  examTrackIds: string[];
  /** Track selected when the learner has not chosen one. */
  defaultExamTrackId: string;
  /** One-line pitch shown on the language picker. */
  tagline: string;
}

export const LANGUAGE_PROFILES: Record<LanguageCode, LanguageProfile> = {
  zh: {
    code: 'zh',
    name: 'Mandarin Chinese',
    endonym: '中文',
    badge: 'ZH',
    emoji: '🇨🇳',
    scripts: ['hanzi-simplified', 'hanzi-traditional', 'pinyin'],
    romanizationName: 'Pinyin',
    tonal: true,
    // Four lexical tones plus the neutral tone.
    toneCount: 5,
    examTrackIds: ['hsk3', 'hsk2'],
    defaultExamTrackId: 'hsk3',
    tagline: 'Characters, tones and vocabulary mapped to the HSK syllabus.',
  },
  ja: {
    code: 'ja',
    name: 'Japanese',
    endonym: '日本語',
    badge: 'JA',
    emoji: '🇯🇵',
    scripts: ['hiragana', 'katakana', 'kanji', 'romaji'],
    romanizationName: 'Reading (kana)',
    tonal: false,
    toneCount: 0,
    examTrackIds: ['jlpt'],
    defaultExamTrackId: 'jlpt',
    tagline: 'Kanji, kana and vocabulary graded to the JLPT levels.',
  },
  ko: {
    code: 'ko',
    name: 'Korean',
    endonym: '한국어',
    badge: 'KO',
    emoji: '🇰🇷',
    scripts: ['hangul', 'hanja'],
    romanizationName: 'Revised Romanization',
    tonal: false,
    toneCount: 0,
    examTrackIds: ['topik'],
    defaultExamTrackId: 'topik',
    tagline: 'Hangul, vocabulary and grammar aligned to TOPIK I and II.',
  },
  vi: {
    code: 'vi',
    name: 'Vietnamese',
    endonym: 'Tiếng Việt',
    badge: 'VI',
    emoji: '🇻🇳',
    scripts: ['latin-vietnamese'],
    romanizationName: 'Tone pattern',
    tonal: true,
    // Six tones in the Northern standard; Southern varieties merge two of them.
    toneCount: 6,
    examTrackIds: ['vsl'],
    defaultExamTrackId: 'vsl',
    tagline: 'Six-tone drills and vocabulary on the MOET proficiency framework.',
  },
};

export const LANGUAGE_CODES: LanguageCode[] = ['zh', 'ja', 'ko', 'vi'];

export function getLanguageProfile(code: LanguageCode): LanguageProfile {
  const profile = LANGUAGE_PROFILES[code];
  if (!profile) throw new Error(`Unknown language code: ${code}`);
  return profile;
}

export function isLanguageCode(value: string): value is LanguageCode {
  return Object.prototype.hasOwnProperty.call(LANGUAGE_PROFILES, value);
}

/**
 * Whether this language is written in characters recalled stroke by stroke.
 *
 * The distinction handwriting practice turns on. Mandarin, Japanese and Korean
 * all have a script where producing the character from memory is a separate
 * skill from knowing the word; Vietnamese is written in a Latin alphabet,
 * where "writing it" and "producing it" are the same act.
 */
export function usesCharacterWriting(code: LanguageCode): boolean {
  return getLanguageProfile(code).scripts.some(
    (script) => script.startsWith('hanzi') || script === 'kanji' || script === 'hanja',
  );
}

/**
 * The card kinds that mean anything in this language.
 *
 * Offering a Japanese learner tone cards is offering them something that will
 * never be generated — `tone` needs a tone to drill — and offering a
 * Vietnamese learner handwriting practice is offering them spelling under
 * another name. Both were on screen before this existed.
 *
 * In `CARD_KINDS` order, so anything built from this lists them the same way
 * everywhere.
 */
export function cardKindsForLanguage(code: LanguageCode): CardKind[] {
  const { tonal } = getLanguageProfile(code);
  const handwritten = usesCharacterWriting(code);

  return CARD_KINDS.filter(
    (kind) => (kind !== 'tone' || tonal) && (kind !== 'writing' || handwritten),
  );
}
