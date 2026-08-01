import type { ExampleSentence, LexicalEntry } from '../../types/card';
import type { LanguageCode, ScriptId } from '../../types/language';

/**
 * The vocabulary contract, without the vocabulary.
 *
 * The word lists used to be four JSON files imported right here, which meant
 * every one of the fourteen thousand entries was compiled into the app bundle —
 * 1.7MB shipped to a phone so that somebody could study fifteen words a day, and
 * paid for again on every app update.
 *
 * They now live in `data/vocab/` and are served by the API, a level at a time,
 * cached on the device after first use. What stays here is the part both sides
 * need to agree on: the record shape, and the function that expands it. The
 * server reads the files and the app reads the responses, and neither has an
 * opinion the other does not share.
 *
 * The app is still usable with no server and no network — see `data/seed/`,
 * which is the starter deck it falls back to.
 */

/**
 * The on-disk and on-the-wire record.
 *
 * Short keys, because these travel: at five hundred entries a level the
 * difference between `frequencyRank` and `q` is real bandwidth on a phone.
 */
export interface CompactEntry {
  i: string;
  t: string;
  r: string;
  m: string[];
  /** Tones, per syllable. */
  o?: number[];
  /** Frequency rank; lower is more common. */
  q?: number;
  p?: string;
  c?: string[];
  /** Script variants, as [script, form] pairs. */
  v?: [string, string][];
  g?: string[];
  e?: ExampleSentence[];
  n?: string;
}

/** One language's file: level id to its words, most frequent first. */
export type VocabularyFile = Record<string, CompactEntry[]>;

/**
 * What the app asks the server for before it asks for anything else.
 *
 * Sizes let the settings screen say how many words a level holds without
 * downloading it, and `version` is what makes the cache safe to keep: it changes
 * when the datasets do, and a device with a different version knows to refetch.
 */
export interface VocabularyManifest {
  version: string;
  languages: Record<LanguageCode, { levels: Record<string, number>; total: number }>;
  sources: Record<LanguageCode, VocabularySource>;
}

export interface VocabularySource {
  name: string;
  url: string;
  licence: string;
  /** Whether the examining body publishes the list this came from. */
  official: boolean;
}

export interface VocabularyLevel {
  levelId: string;
  languageCode: LanguageCode;
  version: string;
  entries: CompactEntry[];
}

/** Expand wire records into the shape the domain works in. */
export function expandEntries(
  records: CompactEntry[],
  code: LanguageCode,
  levelId: string,
): LexicalEntry[] {
  return records.map((record) => ({
    id: record.i,
    languageCode: code,
    target: record.t,
    reading: record.r,
    meanings: record.m,
    levelIds: [levelId],
    examples: record.e ?? [],
    tags: record.g ?? [],
    ...(record.o ? { tones: record.o } : {}),
    ...(record.q !== undefined ? { frequencyRank: record.q } : {}),
    ...(record.p ? { partOfSpeech: record.p } : {}),
    ...(record.c ? { components: record.c } : {}),
    ...(record.n ? { mnemonic: record.n } : {}),
    ...(record.v
      ? { variants: record.v.map(([script, form]) => ({ script: script as ScriptId, form })) }
      : {}),
  }));
}

/**
 * Where each language's words came from.
 *
 * Kept in the app rather than only in the manifest so the settings screen can
 * credit a source before the first fetch — and because two of these licences
 * require attribution, which is not a thing to make conditional on a network
 * request succeeding.
 */
export const VOCABULARY_SOURCES: Record<LanguageCode, VocabularySource> = {
  zh: {
    name: 'Complete HSK Vocabulary',
    url: 'https://github.com/drkameleon/complete-hsk-vocabulary',
    licence: 'MIT',
    official: true,
  },
  ja: {
    name: 'Open Anki JLPT Decks',
    url: 'https://github.com/jamsinclair/open-anki-jlpt-decks',
    licence: 'MIT',
    official: false,
  },
  ko: {
    name: 'NIKL / TOPIK lists, glossed from Wiktionary',
    url: 'https://github.com/julienshim/combined_korean_vocabulary_list',
    licence: 'MIT, glosses CC BY-SA 4.0',
    official: false,
  },
  vi: {
    name: 'OpenSubtitles frequency list, glossed from Wiktionary',
    url: 'https://github.com/hermitdave/FrequencyWords',
    licence: 'CC BY-SA 4.0',
    official: false,
  },
};
