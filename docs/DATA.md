# Vocabulary data

## What ships

A starter deck per language, in `packages/core/src/data/seed/`. Around 30 entries each,
covering the first level of each exam track.

It is deliberately small and deliberately not a claim to be the HSK or JLPT syllabus. Its
job is to make the app studiable on first launch and to exercise every card kind the exam
models declare — including the ones easy to get wrong, such as tone cards for Mandarin
and Vietnamese and script cards for kana and hangul. A test asserts that every kind is
reachable from the seed data, so a level cannot weight a kind that no entry can satisfy.

Real coverage comes from importing official or community word lists.

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
import { parseVocabularyCsv } from '@mon/core';

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
