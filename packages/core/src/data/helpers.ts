import type { ExampleSentence, LexicalEntry } from '../types/card';
import type { LanguageCode } from '../types/language';

/**
 * Compact constructor for seed entries.
 *
 * The seed decks are hand-written data, and the readable version of that data is
 * one line per word. Spelling out the full `LexicalEntry` shape thirty times per
 * language would bury the actual content — the words, readings and tones — in
 * punctuation, and make mistakes in it much harder to spot in review.
 */
export function makeEntry(input: {
  id: string;
  lang: LanguageCode;
  target: string;
  reading: string;
  meanings: string[];
  levels: string[];
  pos?: string;
  /** Per-syllable tone numbers, for Mandarin and Vietnamese. */
  tones?: number[];
  components?: string[];
  /** `[target, translation]` or `[target, translation, reading]`. */
  examples?: ([string, string] | [string, string, string])[];
  tags?: string[];
  rank?: number;
  mnemonic?: string;
}): LexicalEntry {
  const examples: ExampleSentence[] = (input.examples ?? []).map(([target, translation, reading]) => ({
    target,
    translation,
    ...(reading ? { reading } : {}),
  }));

  return {
    id: input.id,
    languageCode: input.lang,
    target: input.target,
    reading: input.reading,
    meanings: input.meanings,
    levelIds: input.levels,
    examples,
    tags: input.tags ?? [],
    ...(input.pos ? { partOfSpeech: input.pos } : {}),
    ...(input.tones ? { tones: input.tones } : {}),
    ...(input.components ? { components: input.components } : {}),
    ...(input.rank !== undefined ? { frequencyRank: input.rank } : {}),
    ...(input.mnemonic ? { mnemonic: input.mnemonic } : {}),
  };
}
