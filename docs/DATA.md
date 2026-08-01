# The vocabulary

The app ships **14,093 words** across four languages, keyed by exam level. They are
not hand-written: they come from the published word lists, normalised by a scraper in
`tools/vocab/` whose output is committed — so a clone studies without touching the
network, and a syllabus change arrives as a diff somebody can review.

```bash
node tools/vocab/build.mjs         # rebuild everything
node tools/vocab/build.mjs zh ja   # rebuild one or two languages
```

Downloads are cached in `tools/vocab/.cache/` (gitignored); delete it to force a refresh.
The scraper is a tool rather than a build step, because vocabulary changes about as often
as an examining body publishes a new syllabus and a build that reaches out to five hosts
is a build that fails when one of them is down.

## Where the words come from

| Language | Source | Licence | Levels |
| --- | --- | --- | --- |
| Mandarin | [Complete HSK Vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) | MIT | **Official** — HSK 3.0 levels 1–7-9 and HSK 2.0 levels 1–6, as published |
| Japanese | [Open Anki JLPT Decks](https://github.com/jamsinclair/open-anki-jlpt-decks) | MIT | Community reconstruction; the JLPT has published nothing since 2010 |
| Korean | [NIKL / TOPIK combined list](https://github.com/julienshim/combined_korean_vocabulary_list) | MIT | Derived, see below |
| Vietnamese | [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (OpenSubtitles 2018) | CC BY-SA 4.0 | Frequency bands; MOET defines levels by descriptor, not by word list |
| Korean and Vietnamese glosses | [Wiktionary via kaikki.org](https://kaikki.org/) | CC BY-SA 4.0 / GFDL | — |

Two of those licences require attribution, which is why the sources are named in the
app's settings screen and not only in this file.

## What the scraper actually does

**Tones are read off the spelling rather than taken from a source.** Mandarin tones come
from the numeric pinyin — `ai4 hao4` becomes `[4, 4]`, a bare syllable being the neutral
tone. Vietnamese tones come from the diacritics: decompose to NFD, skip the
letter-forming marks on ă, â, ê, ô, ơ and ư, and read the tone mark that remains. This
matters because the tone drill is the one exercise where missing data produces a card
that teaches the opposite of the truth, so it is derived deterministically and asserted
for every entry in `vocab.test.ts`.

**Korean levels are derived, and the app says so.** TOPIK has never published a graded
word list. The TOPIK band (A/B/C) splits the six levels into pairs, the National
Institute band breaks the tie for words TOPIK does not cover, and frequency orders each
band.

**Vietnamese levels are frequency bands.** The MOET framework defines its levels by what
a learner can *do*. Inventing a word list to match would be dishonest; frequency is both
defensible as a learning order and exactly what the app already says it is doing.

**Glosses are cleaned, ranked and truncated.** Wiktionary is a historical dictionary, so
its first sense for `là` is "fine silk" and for `tôi` is "slave; domestic servant".
Senses marked archaic, obsolete, historical, dated or rare are dropped, and what remains
is ranked by sense position *and* gloss length together — either signal alone gets a
common word wrong. Hanja and kanji "definitions", which Wiktionary carries as senses of
the syllable they spell, are rejected outright: `수 = 誰` tells a learner of Korean
nothing they can use.

**Hand-written examples survive.** The starter decks that predate the scraper carried
example sentences and mnemonics written by hand. Where a generated entry is the same
word it inherits them *and keeps the seed's id*, so anyone already studying those words
keeps their review history.

**Ids are unique per word, not per spelling.** The seed id for `ăn` ("to eat") is
`vi-an`, and so is the derived id for `an` ("calm"). The generator detects the collision
and qualifies the newcomer, because two words sharing an id means one inherits the
other's memory state.

## Levels hold 500 words; cards are made 200 at a time

Each level is truncated to its 500 most frequent words. The full lists run to about
thirty thousand words across the four languages — a five-megabyte bundle shipped to a
phone so that somebody can study fifteen words a day. Import the complete list if you
want it; see below.

Separately, the engine only *makes cards* for a sliding window of about two hundred
entries ahead of the learner, extended as words are started. HSK 6 has five levels
beneath it: generating every card up front would mean ten thousand cards in storage and
in every sync. Nothing is lost by waiting, because a card that does not exist yet has no
memory state to keep.

## The starter decks

`packages/core/src/data/seed/` still holds the hand-written decks — about thirty entries
per language, with examples and mnemonics. They are no longer what the app studies from;
they are the source of the examples the generated entries inherit, and the fixture the
domain tests run against, which is why a test can still assert that every card kind is
reachable.

## Entry shape

```ts
{
  id: 'zh-nihao',
  languageCode: 'zh',
  target: '你好',            // the form you meet in text
  reading: 'nǐ hǎo',         // pinyin / kana / romanization / tone names
  meanings: ['hello', 'hi'],
  levelIds: ['hsk3-1', 'hsk2-1'],
  tones: [3, 3],             // per syllable, tonal languages only
  components: ['你', '好'],   // characters or radicals; drives script cards
  examples: [{ target: '你好，我叫小明。', translation: "Hello, I'm Xiaoming." }],
  tags: ['greeting', 'core'],
  frequencyRank: 1,
}
```

Notes that matter for correctness:

- **`target` vs `reading` for Japanese.** `target` holds the kanji form where the word is
  normally written in kanji. That split is what makes production cards work in the right
  direction — "study" should expect 勉強, not べんきょう.
- **Tones are lexical, pre-sandhi.** 你好 is `[3, 3]` even though the first syllable is
  pronounced rising. Sandhi is a rule applied to underlying tones; storing the surface
  form would make the tone drill teach the wrong thing.
- **Vietnamese tone numbers** follow the conventional order: 1 ngang, 2 huyền, 3 sắc,
  4 hỏi, 5 ngã, 6 nặng. One number per whitespace-separated syllable.
- **`levelIds` can hold more than one level.** HSK 2.0 and HSK 3.0 word lists overlap
  heavily, so an entry tagged into both keeps the deck populated when the learner switches
  tracks.
- **Korean verbs and adjectives** are stored in dictionary form (먹다, not 먹어요), which
  is what every textbook and the TOPIK lists use.

## Importing a word list

Both formats go through `StudyEngine.importEntries`, which merges by id — imports win
over shipped entries, so importing HSK 1 in full replaces the seed entries rather than
duplicating them. Cards are regenerated afterwards and existing review history is kept.

### CSV

Columns, in order:

```
id,target,reading,meanings,levelIds,partOfSpeech,tones,components,examples,tags,frequencyRank
```

- A header row is detected and skipped if its first cell is `id`.
- Multi-value cells (`meanings`, `levelIds`, `tones`, `components`, `tags`, `examples`)
  are separated by `;` — so `,` stays usable inside a gloss. `"hello, hi"` is one meaning,
  not two columns.
- Quoted cells are handled properly, including doubled `""` for a literal quote. This
  matters: word lists quote routinely because glosses contain commas, and splitting on
  the delimiter alone shifts every column after the first quoted comma.
- `examples` cells hold `target|translation` or `target|translation|reading` pairs.
- Columns after `frequencyRank` are ignored, so a list carrying extra metadata imports
  without editing.

```ts
import { parseVocabularyCsv } from '@language-srs/core';

const result = parseVocabularyCsv(csvText, {
  languageCode: 'ja',
  defaultLevelId: 'jlpt-n4',   // used when the levelIds column is empty
  delimiter: ',',              // '\t' for TSV
});

console.log(result.accepted, result.rejected);
result.issues.forEach((issue) => console.log(issue.severity, issue.row, issue.message));

await engine.importEntries(result.entries);
```

### JSON

`parseVocabularyJson` accepts either a bare array of entries or `{ entries: [...] }` —
which is what `exportVocabularyJson` produces, so an export round-trips.

## Validation

Every row is reported on rather than silently coerced.

Rows are **rejected** for a missing target, no meanings, no resolvable exam level, or an
unknown level id. That last one matters more than it looks: a list with a mistyped level
imports cleanly under a permissive parser and produces cards that never appear in any
queue, which is close to impossible to diagnose from inside the app.

Rows are **warned** about but still imported when tones cannot be parsed — the word is
still worth having without its tone drill.

Entries with non-Latin targets and no `id` get a stable id from a hash of the target, so
re-importing the same file does not create duplicates.

## Where to get lists

- **HSK** — official word lists are published for both the 2.0 (levels 1-6) and 3.0
  (levels 1-9) standards, with characters and grammar points.
- **JLPT** — no official list since 2010. Community lists derived from past papers and
  the old 4-level lists are what everyone uses; expect disagreement at the margins.
- **TOPIK** — no official list. NIIED publishes past papers, and community frequency
  lists are built from them.
- **Vietnamese** — no official list. CEFR-aligned coursebook glossaries are the practical
  source.

The app's level ids are the join key. They are listed in
`packages/core/src/exams/` — `hsk3-1`…`hsk3-789`, `hsk2-1`…`hsk2-6`, `jlpt-n5`…`jlpt-n1`,
`topik-1`…`topik-6`, `vsl-1`…`vsl-6`.
