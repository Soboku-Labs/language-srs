import type { LanguageCode } from '../types/language';

/**
 * The tone inventories, as something a learner can be asked to choose from.
 *
 * The tone *colours* already lived in the theme, but a colour is only an answer
 * key — it cannot be tapped. A tone drill that asks "which tones?" and then just
 * shows you needs the tones themselves as data: a number to record, a name to
 * label the button, and a contour to remind you what the name means.
 *
 * Numbers match `LexicalEntry.tones`, which stores lexical tones before sandhi.
 */
export interface ToneDescriptor {
  /** 1-based tone number, matching `LexicalEntry.tones`. */
  value: number;
  /** What the tone is called: "Second", "huyền". */
  name: string;
  /** The tone written on a vowel, for a compact button label. */
  mark: string;
  /** The contour in three or four words. */
  contour: string;
}

const MANDARIN_TONES: ToneDescriptor[] = [
  { value: 1, name: 'First', mark: 'ā', contour: 'high and level' },
  { value: 2, name: 'Second', mark: 'á', contour: 'rising' },
  { value: 3, name: 'Third', mark: 'ǎ', contour: 'dips, then rises' },
  { value: 4, name: 'Fourth', mark: 'à', contour: 'sharp fall' },
  { value: 5, name: 'Neutral', mark: 'a', contour: 'light, unstressed' },
];

const VIETNAMESE_TONES: ToneDescriptor[] = [
  { value: 1, name: 'ngang', mark: 'a', contour: 'level, unmarked' },
  { value: 2, name: 'huyền', mark: 'à', contour: 'low, falling' },
  { value: 3, name: 'sắc', mark: 'á', contour: 'high, rising' },
  { value: 4, name: 'hỏi', mark: 'ả', contour: 'dips and returns' },
  { value: 5, name: 'ngã', mark: 'ã', contour: 'rises with a break' },
  { value: 6, name: 'nặng', mark: 'ạ', contour: 'short, dropped' },
];

export const TONE_SYSTEMS: Partial<Record<LanguageCode, ToneDescriptor[]>> = {
  zh: MANDARIN_TONES,
  vi: VIETNAMESE_TONES,
};

/** The tones of a language, or an empty list for a non-tonal one. */
export function getToneSystem(code: LanguageCode): ToneDescriptor[] {
  return TONE_SYSTEMS[code] ?? [];
}

export function getToneDescriptor(code: LanguageCode, tone: number): ToneDescriptor | undefined {
  return getToneSystem(code).find((descriptor) => descriptor.value === tone);
}

/** "sắc · huyền" — a tone pattern spelled out, for the answer side of a card. */
export function describeTonePattern(code: LanguageCode, tones: number[]): string {
  return tones.map((tone) => getToneDescriptor(code, tone)?.name ?? String(tone)).join(' · ');
}
