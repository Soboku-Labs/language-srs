/**
 * Where the vocabulary comes from.
 *
 * Every list in this app is somebody else's work, and this file is the record of
 * whose. Licences are stated because they govern what the app may ship: all four
 * of these permit redistribution, and two of them require attribution, which is
 * why `docs/DATA.md` names them and why the app's own credits do too.
 *
 * The scraper is deliberately a *tool* rather than part of the build. Vocabulary
 * changes about as often as an examining body publishes a new syllabus, and a
 * build that reaches out to five hosts is a build that fails when one of them is
 * down.
 */

export const SOURCES = {
  zh: {
    name: 'Complete HSK Vocabulary',
    url: 'https://github.com/drkameleon/complete-hsk-vocabulary',
    licence: 'MIT',
    /** Every word in HSK 2.0 and 3.0, with pinyin, tones, meanings and frequency. */
    data: 'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.min.json',
    note: 'HSK 3.0 (new-1..new-7) and HSK 2.0 (old-1..old-6) levels are marked per word.',
  },

  ja: {
    name: 'Open Anki JLPT Decks',
    url: 'https://github.com/jamsinclair/open-anki-jlpt-decks',
    licence: 'MIT (notes derived from tanos.co.uk JLPT lists)',
    data: {
      'jlpt-n5': 'https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/n5.csv',
      'jlpt-n4': 'https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/n4.csv',
      'jlpt-n3': 'https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/n3.csv',
      'jlpt-n2': 'https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/n2.csv',
      'jlpt-n1': 'https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/n1.csv',
    },
    note: 'JLPT stopped publishing official lists in 2010; these are the widely-used community reconstructions.',
  },

  ko: {
    name: 'Combined NIKL / TOPIK vocabulary list',
    url: 'https://github.com/julienshim/combined_korean_vocabulary_list',
    licence: 'MIT (compiled from National Institute of Korean Language and TOPIK published lists)',
    data: 'https://raw.githubusercontent.com/julienshim/combined_korean_vocabulary_list/master/results.tsv',
    note: 'Carries the NIKL beginner/intermediate/advanced band and the TOPIK band, but no English glosses.',
  },

  vi: {
    name: 'FrequencyWords (OpenSubtitles 2018)',
    url: 'https://github.com/hermitdave/FrequencyWords',
    licence: 'CC BY-SA 4.0',
    data: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/vi/vi_50k.txt',
    note: 'Vietnamese has no published per-level word list, so levels here are frequency bands and the app says so.',
  },

  /**
   * English glosses for Korean and Vietnamese.
   *
   * Wiktionary, extracted by wiktextract and published as JSONL. Large — 195MB
   * and 78MB — so the scraper streams them and keeps only the words it needs
   * rather than landing them on disk.
   */
  glosses: {
    name: 'Wiktionary via kaikki.org (wiktextract)',
    url: 'https://kaikki.org/',
    licence: 'CC BY-SA 4.0 and GFDL, as Wiktionary',
    data: {
      ko: 'https://kaikki.org/dictionary/Korean/kaikki.org-dictionary-Korean.jsonl',
      vi: 'https://kaikki.org/dictionary/Vietnamese/kaikki.org-dictionary-Vietnamese.jsonl',
    },
  },
};

/**
 * How many words to keep per level.
 *
 * The full lists run to about thirty thousand words across the four languages,
 * which is a five-megabyte bundle to ship to a phone so that somebody can study
 * fifteen words a day. Levels are truncated by frequency — the most common words
 * first, which is the order anyone would want to learn them in anyway — and the
 * importer takes the complete list for anyone who wants it.
 */
export const PER_LEVEL_CAP = 500;

/** Meanings kept per entry. A card with six glosses on it is a card nobody reads. */
export const MEANINGS_CAP = 3;
