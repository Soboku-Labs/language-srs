/**
 * Build the vocabulary datasets.
 *
 *   node tools/vocab/build.mjs            # every language
 *   node tools/vocab/build.mjs zh ja      # just these
 *
 * Reads the published lists named in `sources.mjs`, normalises them into the
 * shape `LexicalEntry` already uses, and writes one file per language keyed by
 * exam level into `packages/core/src/data/vocab/`.
 *
 * This is a tool, not a build step. It runs when a syllabus changes, which is
 * roughly never, and its output is committed — so a clone builds and studies
 * without touching the network, and a change to the word lists shows up in a
 * diff that somebody can actually review.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { downloadJson, downloadText, download, streamJsonl } from './lib/fetch.mjs';
import { isVietnameseWord, tonesFromNumericPinyin, tonesFromVietnamese } from './lib/tones.mjs';
import { MEANINGS_CAP, PER_LEVEL_CAP, SOURCES } from './sources.mjs';

const OUT = new URL('../../packages/core/src/data/vocab/', import.meta.url).pathname;

/** Hand-written seed entries, so their examples and mnemonics are not lost. */
const SEED_MODULES = {
  zh: '../../packages/core/src/data/seed/mandarin.ts',
  ja: '../../packages/core/src/data/seed/japanese.ts',
  ko: '../../packages/core/src/data/seed/korean.ts',
  vi: '../../packages/core/src/data/seed/vietnamese.ts',
};

// ------------------------------------------------------------------ Mandarin

/**
 * HSK, from the published lists.
 *
 * The best data of the four by some distance: official levels for both HSK 2.0
 * and 3.0, tone-marked pinyin, a numeric form the tones come straight out of,
 * cleaned meanings, traditional forms and a frequency ranking.
 */
async function buildMandarin() {
  const words = await downloadJson(SOURCES.zh.data, 'hsk-complete.min.json');
  const levels = new Map();

  for (const word of words) {
    const form = word.f?.[0];
    if (!form) continue;

    const target = word.s;
    const reading = form.i?.y?.trim();
    if (!target || !reading) continue;

    const meanings = splitMeanings(form.m);
    if (meanings.length === 0) continue;

    const entry = {
      target,
      reading,
      meanings,
      tones: tonesFromNumericPinyin(form.i?.n),
      frequencyRank: typeof word.q === 'number' ? word.q : undefined,
      partOfSpeech: expandPos(word.p?.[0]),
      // The characters of a multi-character word are its components, which is
      // what the script drill asks a learner to take apart.
      components: target.length > 1 && target.length <= 4 ? [...target] : undefined,
      variants:
        form.t && form.t !== target ? [{ script: 'hanzi-traditional', form: form.t }] : undefined,
      tags: [],
    };

    for (const level of word.l ?? []) {
      const levelId = MANDARIN_LEVELS[level];
      if (!levelId) continue;
      push(levels, levelId, entry);
    }
  }

  return levels;
}

/**
 * The dataset's level codes.
 *
 * The minified file abbreviates them — `n1` for new-1, `o3` for old-3 — and
 * carries a third scheme (`t*`) the README does not document, which is ignored
 * rather than guessed at. Both spellings are accepted so the pretty-printed and
 * minified files can be used interchangeably.
 */
const MANDARIN_LEVELS = {
  'new-1': 'hsk3-1', n1: 'hsk3-1',
  'new-2': 'hsk3-2', n2: 'hsk3-2',
  'new-3': 'hsk3-3', n3: 'hsk3-3',
  'new-4': 'hsk3-4', n4: 'hsk3-4',
  'new-5': 'hsk3-5', n5: 'hsk3-5',
  'new-6': 'hsk3-6', n6: 'hsk3-6',
  'new-7': 'hsk3-789', n7: 'hsk3-789',
  'old-1': 'hsk2-1', o1: 'hsk2-1',
  'old-2': 'hsk2-2', o2: 'hsk2-2',
  'old-3': 'hsk2-3', o3: 'hsk2-3',
  'old-4': 'hsk2-4', o4: 'hsk2-4',
  'old-5': 'hsk2-5', o5: 'hsk2-5',
  'old-6': 'hsk2-6', o6: 'hsk2-6',
};

/** The dataset's part-of-speech abbreviations, in words. */
const POS = {
  n: 'noun',
  v: 'verb',
  a: 'adjective',
  adj: 'adjective',
  d: 'adverb',
  r: 'pronoun',
  m: 'numeral',
  q: 'measure word',
  p: 'preposition',
  c: 'conjunction',
  u: 'particle',
  o: 'onomatopoeia',
  e: 'interjection',
  i: 'idiom',
  t: 'time word',
  f: 'noun of locality',
  s: 'noun of locality',
  b: 'attributive',
  z: 'descriptive',
  vn: 'verb-noun',
};

function expandPos(code) {
  return code ? (POS[code] ?? undefined) : undefined;
}

// ------------------------------------------------------------------ Japanese

/**
 * JLPT, from the community lists.
 *
 * The JLPT has published nothing since 2010, so these are reconstructions —
 * accurate enough that every app uses them, and labelled as estimates in the UI
 * because that is what they are.
 */
async function buildJapanese() {
  const levels = new Map();

  for (const [levelId, url] of Object.entries(SOURCES.ja.data)) {
    const csv = await downloadText(url, `jlpt-${levelId}.csv`);
    const rows = parseCsv(csv);

    for (const [index, row] of rows.entries()) {
      const target = row.expression?.trim();
      const reading = row.reading?.trim() || target;
      const meanings = splitMeanings([row.meaning]);
      if (!target || meanings.length === 0) continue;

      push(levels, levelId, {
        target,
        reading,
        meanings,
        // The lists are alphabetical rather than ranked, so position is the only
        // ordering available. Recorded so the truncation is at least stable.
        frequencyRank: index + 1,
        // Kana readings that differ from the written form mean kanji, which is
        // what makes a script card worth asking.
        tags: reading !== target ? ['kanji'] : ['kana'],
      });
    }
  }

  return levels;
}

// -------------------------------------------------------------------- Korean

/**
 * TOPIK, from the NIKL and TOPIK published lists, glossed from Wiktionary.
 *
 * TOPIK has never published a graded word list, so the levels here are derived:
 * the TOPIK band (A/B/C) splits the six levels into pairs, the National
 * Institute band breaks the tie for words TOPIK does not cover, and frequency
 * orders each band. The app labels Korean coverage as an estimate, which this is.
 */
async function buildKorean() {
  const tsv = await downloadText(SOURCES.ko.data, 'korean-combined.tsv');
  const rows = parseDelimited(tsv, '\t');

  const wanted = new Set(rows.map((row) => row.word).filter(Boolean).map(stripHomographDigits));
  const glosses = await buildGlossIndex('ko', wanted);

  const levels = new Map();
  const banded = [];

  for (const row of rows) {
    const target = stripHomographDigits(row.word ?? '');
    if (!target || !/^[가-힣]+$/.test(target)) continue;

    const meanings = glosses.get(target);
    if (!meanings || meanings.length === 0) continue;

    banded.push({
      band: koreanBand(row),
      rank: Number(row.rank) || Number.MAX_SAFE_INTEGER,
      entry: {
        target,
        // Hangul is phonetic: the word is its own reading. The reading field
        // carries the revised romanisation only where a source provides it, and
        // this one does not, so the written form stands in.
        reading: target,
        meanings: meanings.slice(0, MEANINGS_CAP),
        partOfSpeech: KOREAN_POS[row.part_of_speech] ?? undefined,
        frequencyRank: Number(row.rank) || undefined,
        variants: row.hanja ? [{ script: 'hanja', form: row.hanja }] : undefined,
        tags: [],
      },
    });
  }

  // Each band fills two levels: the more frequent half, then the rest.
  for (const [band, levelIds] of Object.entries(KOREAN_BANDS)) {
    const inBand = banded.filter((item) => item.band === band).sort((a, b) => a.rank - b.rank);
    const half = Math.ceil(inBand.length / 2);

    inBand.slice(0, half).forEach((item) => push(levels, levelIds[0], item.entry));
    inBand.slice(half).forEach((item) => push(levels, levelIds[1], item.entry));
  }

  return levels;
}

const KOREAN_BANDS = {
  beginner: ['topik-1', 'topik-2'],
  intermediate: ['topik-3', 'topik-4'],
  advanced: ['topik-5', 'topik-6'],
};

const KOREAN_POS = {
  명사: 'noun',
  동사: 'verb',
  형용사: 'adjective',
  부사: 'adverb',
  관형사: 'determiner',
  대명사: 'pronoun',
  수사: 'numeral',
  감탄사: 'interjection',
  조사: 'particle',
  접사: 'affix',
  의존명사: 'bound noun',
};

/** TOPIK's own band where it has one, the NIKL band where it does not. */
function koreanBand(row) {
  switch (row.topik_level) {
    case 'A':
      return 'beginner';
    case 'B':
      return 'intermediate';
    case 'C':
      return 'advanced';
    default:
      break;
  }
  switch (row.nikl_level) {
    case '초급':
      return 'beginner';
    case '중급':
      return 'intermediate';
    default:
      return 'advanced';
  }
}

/** The source marks homographs as 가게1, 가게2. The digit is not part of the word. */
function stripHomographDigits(word) {
  return word.replace(/[0-9]+$/, '').trim();
}

// ---------------------------------------------------------------- Vietnamese

/**
 * Vietnamese, by frequency, glossed from Wiktionary.
 *
 * The MOET framework defines its six levels by what a learner can *do*, not by a
 * word list, so there is no official list to scrape and inventing one would be
 * dishonest. What exists is frequency — how often a word is actually used — and
 * that is both defensible as a learning order and exactly what the app already
 * says it is doing.
 *
 * Tones come from the spelling, which for Vietnamese is exact.
 */
async function buildVietnamese() {
  const text = await downloadText(SOURCES.vi.data, 'vi-frequency.txt');

  const candidates = text
    .split('\n')
    .map((line) => line.split(' ')[0]?.trim())
    .filter((word) => word && word.length > 1 && isVietnameseWord(word))
    .slice(0, 12_000);

  const glosses = await buildGlossIndex('vi', new Set(candidates));

  const levels = new Map();
  const levelIds = ['vsl-1', 'vsl-2', 'vsl-3', 'vsl-4', 'vsl-5', 'vsl-6'];
  let kept = 0;

  for (const [index, word] of candidates.entries()) {
    const meanings = glosses.get(word);
    if (!meanings || meanings.length === 0) continue;

    const levelId = levelIds[Math.min(levelIds.length - 1, Math.floor(kept / PER_LEVEL_CAP))];
    kept += 1;

    push(levels, levelId, {
      target: word,
      // Vietnamese is written in the Latin alphabet with its tones on the page,
      // so the word is its own reading. What the reading field would otherwise
      // add, the tone drill asks for directly.
      reading: word,
      meanings: meanings.slice(0, MEANINGS_CAP),
      tones: tonesFromVietnamese(word),
      frequencyRank: index + 1,
      tags: [],
    });

    if (kept >= levelIds.length * PER_LEVEL_CAP) break;
  }

  return levels;
}

// --------------------------------------------------------------------- shared

/**
 * English glosses for a set of words, from Wiktionary.
 *
 * Streamed rather than loaded: see `streamJsonl`. Only the words asked for are
 * kept, and only their first few senses — a card carrying every sense of a
 * common word is a card nobody reads to the end.
 */
async function buildGlossIndex(language, wanted) {
  const path = await download(SOURCES.glosses.data[language], `wiktionary-${language}.jsonl`);
  // Candidates are collected across every part-of-speech entry for a word and
  // ranked once at the end, so a noun sense and a verb sense compete fairly.
  const candidates = new Map();
  let scanned = 0;

  for await (const record of streamJsonl(path)) {
    scanned += 1;
    const word = record.word;
    if (!word || !wanted.has(word)) continue;
    // Proper nouns and single letters are not vocabulary anyone studies.
    if (record.pos === 'name' || record.pos === 'character') continue;

    const glosses = (record.senses ?? [])
      .filter(isCurrentSense)
      .flatMap((sense, position) =>
        (sense.glosses ?? []).map((gloss) => ({ gloss: cleanGloss(gloss), position })),
      )
      .filter((candidate) => candidate.gloss);

    if (glosses.length === 0) continue;
    candidates.set(word, [...(candidates.get(word) ?? []), ...glosses]);
  }

  const index = new Map([...candidates].map(([word, found]) => [word, rankGlosses(found)]));
  process.stderr.write(`  glossed  ${index.size} of ${wanted.size} ${language} words (${scanned} records scanned)\n`);
  return index;
}

/**
 * Senses a learner would actually be taught.
 *
 * Wiktionary is a historical dictionary and orders senses accordingly, so the
 * first gloss for `tôi` is "slave; domestic servant" and for `là` it is "fine
 * silk" — both true, both a thousand years out of date, and both wrong to put on
 * the front of a beginner's card. Dropping the marked-historical senses leaves
 * the modern ones, which is what the source has to offer for a study deck.
 */
const STALE_SENSE_TAGS = new Set([
  'archaic',
  'obsolete',
  'historical',
  'dated',
  'rare',
  'poetic',
  'literary',
  'dialectal',
  'slang',
  'vulgar',
  'offensive',
]);

function isCurrentSense(sense) {
  const tags = [...(sense.tags ?? []), ...(sense.raw_tags ?? [])];
  return !tags.some((tag) => STALE_SENSE_TAGS.has(String(tag).toLowerCase()));
}

/**
 * Put the gloss a learner needs first.
 *
 * Wiktionary's order is etymological, not pedagogical: `là` means "to be" to
 * everyone alive and "fine silk" to a historian, and the historian's sense comes
 * first. Two signals, weighed against each other:
 *
 * - **Where the sense sits.** The first senses of an entry are its main ones.
 * - **How long the gloss is.** The everyday sense of a common word is nearly
 *   always the short one — "to be", "I/me", "to go" — while specialist senses
 *   carry their qualifications with them.
 *
 * Neither alone works. Position alone gives "slave; domestic servant" for `tôi`;
 * length alone gives "to die" for `없다`. Three characters of length per place in
 * the list is the ratio that gets both right.
 */
function rankGlosses(candidates) {
  const seen = new Set();

  return candidates
    .map((candidate, index) => ({ ...candidate, index }))
    .sort(
      (a, b) =>
        a.position * 3 + a.gloss.length - (b.position * 3 + b.gloss.length) || a.index - b.index,
    )
    .filter((candidate) => {
      const key = candidate.gloss.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MEANINGS_CAP)
    .map((candidate) => candidate.gloss);
}

/**
 * Tidy a Wiktionary gloss into something that fits on a card.
 *
 * Wiktionary writes for a dictionary reader: parenthetical registers, "see also"
 * pointers, and glosses that run to a paragraph. What a flashcard needs is the
 * first clause.
 */
function cleanGloss(gloss) {
  const cleaned = gloss
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,;:\-–—\s]+/, '')
    .trim();

  if (cleaned.length < 2 || cleaned.length > 80) return undefined;
  // Wiktionary carries hanja readings as "senses" of the syllable they spell.
  // An English definition containing a Han character is one of those, not a
  // meaning: "수 = 誰" tells a learner nothing they can use.
  if (/[\u3400-\u9fff]/.test(cleaned)) return undefined;
  if (!/[a-z]/i.test(cleaned)) return undefined;
  // Wiktionary's collapsible tables survive extraction as glosses made of the
  // words around them: "More information ) ) ) ) )". Not a definition.
  if (/more information|^\W+$|[)(]\s*[)(]/i.test(cleaned)) return undefined;
  // Cross-references are not definitions.
  if (/^(see|alternative form|alternative spelling|synonym|obsolete form|misspelling)\b/i.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

/** "to like; to be fond of" → ["to like", "to be fond of"], capped. */
function splitMeanings(meanings) {
  return dedupe(
    (meanings ?? [])
      .filter((meaning) => typeof meaning === 'string')
      .flatMap((meaning) => meaning.split(';'))
      .map((meaning) => meaning.replace(/\s+/g, ' ').trim())
      .filter((meaning) => meaning.length > 0 && meaning.length <= 80),
  ).slice(0, MEANINGS_CAP);
}

function dedupe(values) {
  return [...new Set(values.map((value) => value.trim()))].filter(Boolean);
}

function push(levels, levelId, entry) {
  const bucket = levels.get(levelId) ?? [];
  bucket.push(entry);
  levels.set(levelId, bucket);
}

/** A CSV parser that survives quoted commas, which every meaning field has. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header = [], ...body] = rows;
  return body
    .filter((entry) => entry.length === header.length)
    .map((entry) => Object.fromEntries(header.map((name, position) => [name.trim(), entry[position]])));
}

/** The same, for a delimiter that never appears inside a field. */
function parseDelimited(text, delimiter) {
  const [header = '', ...lines] = text.split('\n');
  const names = header.split(delimiter).map((name) => name.trim());

  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const cells = line.split(delimiter);
      return Object.fromEntries(names.map((name, index) => [name, (cells[index] ?? '').trim()]));
    });
}

// ----------------------------------------------------------------- emitting

/**
 * Write one file per language, keyed by level.
 *
 * Keys are short because this ships to a phone: at twelve thousand entries the
 * difference between `frequencyRank` and `q` is a hundred kilobytes of bundle
 * for no information. `data/vocab/index.ts` expands them on the way in.
 */
async function emit(code, levels, seeds) {
  await mkdir(OUT, { recursive: true });

  const byLevel = {};
  let total = 0;
  /**
   * Which word each id belongs to.
   *
   * The same id across two levels is correct and expected — a word in both HSK
   * 2.0 and HSK 3.0 is one word — but two *different* words sharing an id is a
   * card whose history belongs to something else. It happens because ids are
   * derived from the word: the hand-written seed for `ăn` ("to eat") is
   * `vi-an`, and so is the derived id for `an` ("calm").
   */
  const idOwner = new Map();

  for (const [levelId, entries] of [...levels.entries()].sort()) {
    const seen = new Set();
    const kept = [];

    for (const entry of entries.sort(byFrequency)) {
      if (seen.has(entry.target)) continue;
      seen.add(entry.target);
      kept.push(entry);
      if (kept.length >= PER_LEVEL_CAP) break;
    }

    byLevel[levelId] = kept.map((entry) => compact(entry, code, seeds, idOwner));
    total += kept.length;
  }

  const path = `${OUT}${code}.json`;
  await writeFile(path, `${JSON.stringify(byLevel)}\n`, 'utf8');

  const levelSummary = Object.entries(byLevel)
    .map(([levelId, entries]) => `${levelId}:${entries.length}`)
    .join(' ');
  process.stderr.write(`  wrote    ${code}.json — ${total} entries (${levelSummary})\n`);

  return { total, levels: Object.fromEntries(Object.entries(byLevel).map(([id, e]) => [id, e.length])) };
}

/** Keep an id if it already means this word; otherwise qualify it. */
function uniqueId(id, entry, idOwner) {
  const owner = idOwner.get(id);
  if (owner === undefined || owner === entry.target) {
    idOwner.set(id, entry.target);
    return id;
  }

  // Frequency rank rather than a counter, so the same word gets the same id on
  // every rebuild regardless of what else happens to be in the list.
  const qualified = `${id}-${entry.frequencyRank ?? 'x'}`;
  idOwner.set(qualified, entry.target);
  return qualified;
}

function byFrequency(a, b) {
  return (a.frequencyRank ?? Number.MAX_SAFE_INTEGER) - (b.frequencyRank ?? Number.MAX_SAFE_INTEGER);
}

/**
 * The wire shape, and the one hand-written detail worth carrying forward.
 *
 * The starter decks that shipped before this scraper existed had example
 * sentences and mnemonics written by hand. Those are better than anything in
 * these sources, so where a generated entry is the same word as a seed entry, it
 * inherits them — and keeps the seed's id, so anybody who has already been
 * studying those words keeps their review history.
 */
function compact(entry, code, seeds, idOwner) {
  const seed = seeds.get(entry.target);

  return {
    i: uniqueId(seed?.id ?? `${code}-${entry.target}`, entry, idOwner),
    t: entry.target,
    r: entry.reading,
    m: entry.meanings,
    ...(entry.tones ? { o: entry.tones } : {}),
    ...(entry.frequencyRank ? { q: entry.frequencyRank } : {}),
    ...(entry.partOfSpeech ? { p: entry.partOfSpeech } : {}),
    ...(entry.components ? { c: entry.components } : {}),
    ...(entry.variants ? { v: entry.variants.map((variant) => [variant.script, variant.form]) } : {}),
    ...(entry.tags?.length ? { g: entry.tags } : {}),
    ...(seed?.examples?.length ? { e: seed.examples } : {}),
    ...(seed?.mnemonic ? { n: seed.mnemonic } : {}),
  };
}

/**
 * The hand-written seeds, read out of their TypeScript source.
 *
 * Parsed with a regular expression rather than imported, because importing them
 * would mean this tool depending on the package it writes into. They are a
 * closed set of literal `makeEntry({...})` calls, which is exactly the case
 * where a regular expression is the right amount of machinery.
 */
async function readSeeds(code) {
  const { readFile } = await import('node:fs/promises');
  const path = new URL(SEED_MODULES[code], import.meta.url).pathname;
  const source = await readFile(path, 'utf8');
  const seeds = new Map();

  for (const block of source.split('makeEntry({').slice(1)) {
    const id = block.match(/id:\s*'([^']+)'/)?.[1];
    const target = block.match(/target:\s*'([^']+)'/)?.[1];
    if (!id || !target) continue;

    const examplesRaw = block.match(/examples:\s*\[([\s\S]*?)\],\s*\n/)?.[1];
    const mnemonic = block.match(/mnemonic:\s*'([^']*)'/)?.[1];

    seeds.set(target, {
      id,
      mnemonic,
      examples: examplesRaw ? parseSeedExamples(examplesRaw) : [],
    });
  }

  return seeds;
}

function parseSeedExamples(raw) {
  const examples = [];
  for (const match of raw.matchAll(/\[([^\]]*)\]/g)) {
    const parts = [...match[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map(
      (part) => (part[1] ?? part[2]).replace(/\\'/g, "'"),
    );
    if (parts.length < 2) continue;
    examples.push({
      target: parts[0],
      translation: parts[1],
      ...(parts[2] ? { reading: parts[2] } : {}),
    });
  }
  return examples;
}

// --------------------------------------------------------------------- main

const BUILDERS = {
  zh: buildMandarin,
  ja: buildJapanese,
  ko: buildKorean,
  vi: buildVietnamese,
};

const requested = process.argv.slice(2).filter((argument) => argument in BUILDERS);
const languages = requested.length > 0 ? requested : Object.keys(BUILDERS);

const summary = {};

for (const code of languages) {
  process.stderr.write(`\n${code}\n`);
  const levels = await BUILDERS[code]();
  const seeds = await readSeeds(code);
  summary[code] = await emit(code, levels, seeds);
}

process.stderr.write('\ndone\n');
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
