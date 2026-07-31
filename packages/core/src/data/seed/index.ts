import type { LexicalEntry } from '../../types/card';
import type { LanguageCode } from '../../types/language';
import { JAPANESE_SEED } from './japanese';
import { KOREAN_SEED } from './korean';
import { MANDARIN_SEED } from './mandarin';
import { VIETNAMESE_SEED } from './vietnamese';

export { JAPANESE_SEED } from './japanese';
export { KOREAN_SEED } from './korean';
export { MANDARIN_SEED } from './mandarin';
export { VIETNAMESE_SEED } from './vietnamese';

/**
 * Vocabulary shipped with the app.
 *
 * This is a starter deck, not a syllabus. It covers the first level of each
 * track well enough to study from on day one and to exercise every card kind the
 * exam models declare — including the ones that are easy to get wrong, such as
 * tone cards for Mandarin and Vietnamese and script cards for kana and hangul.
 *
 * Full coverage comes from importing the official lists; see `importer.ts` and
 * `docs/DATA.md`. The seed decks and imported entries are merged by id, with
 * imports winning, so importing HSK 1 in full replaces these entries rather than
 * duplicating them.
 */
export const SEED_ENTRIES: LexicalEntry[] = [
  ...MANDARIN_SEED,
  ...JAPANESE_SEED,
  ...KOREAN_SEED,
  ...VIETNAMESE_SEED,
];

export function getSeedEntries(code: LanguageCode): LexicalEntry[] {
  return SEED_ENTRIES.filter((entry) => entry.languageCode === code);
}

/** Seed counts per language, for the "starter deck" line in settings. */
export function getSeedCounts(): Record<LanguageCode, number> {
  return {
    zh: MANDARIN_SEED.length,
    ja: JAPANESE_SEED.length,
    ko: KOREAN_SEED.length,
    vi: VIETNAMESE_SEED.length,
  };
}
