import type { ExamLevel, ExamTrack } from '../types/exam';

/**
 * JLPT — five levels, N5 (easiest) to N1.
 *
 * Two things about this exam shape the card weights below, and both surprise
 * learners coming from HSK:
 *
 *  1. There is no output section at all. No handwriting, no composition, no
 *     speaking. Everything is multiple choice. So `writing` weight is zero
 *     throughout, and `production` stays low — it is a useful learning aid but
 *     it is not what the paper tests.
 *  2. Scoring is sectional. N1-N3 report three scaled sections and N4-N5 report
 *     two, and falling below the sectional minimum fails the whole exam even
 *     with a comfortable total. The section minimums are encoded per section.
 *
 * Vocabulary and kanji counts are community estimates: JLPT stopped publishing
 * official word lists with the 2010 revision, so `targetsAreOfficial` is false.
 */
const JLPT_LEVELS: ExamLevel[] = [
  {
    id: 'jlpt-n5',
    name: 'JLPT N5',
    shortName: 'N5',
    order: 1,
    cefr: 'A1',
    vocabularyTarget: 800,
    characterTarget: 100,
    grammarPointTarget: 80,
    sections: [
      {
        id: 'knowledge-reading',
        name: 'Language Knowledge & Reading',
        skill: 'reading',
        maxScore: 120,
        minimumScore: 38,
        durationMinutes: 60,
      },
      { id: 'listening', name: 'Listening', skill: 'listening', maxScore: 60, minimumScore: 19, durationMinutes: 30 },
    ],
    totalScore: 180,
    passingScore: 80,
    description:
      'Basic Japanese in hiragana, katakana and about 100 kanji. Scored in two sections; both minimums must be met.',
    cardWeights: { script: 5, recognition: 5, listening: 3, grammar: 2, reading: 1, production: 1 },
  },
  {
    id: 'jlpt-n4',
    name: 'JLPT N4',
    shortName: 'N4',
    order: 2,
    cefr: 'A2',
    vocabularyTarget: 1500,
    characterTarget: 300,
    grammarPointTarget: 150,
    sections: [
      {
        id: 'knowledge-reading',
        name: 'Language Knowledge & Reading',
        skill: 'reading',
        maxScore: 120,
        minimumScore: 38,
        durationMinutes: 80,
      },
      { id: 'listening', name: 'Listening', skill: 'listening', maxScore: 60, minimumScore: 19, durationMinutes: 35 },
    ],
    totalScore: 180,
    passingScore: 90,
    description: 'Everyday Japanese at conversational speed, roughly 300 kanji.',
    cardWeights: { recognition: 5, script: 3, listening: 3, grammar: 3, reading: 2, production: 1 },
  },
  {
    id: 'jlpt-n3',
    name: 'JLPT N3',
    shortName: 'N3',
    order: 3,
    cefr: 'B1',
    vocabularyTarget: 3750,
    characterTarget: 650,
    grammarPointTarget: 250,
    sections: [
      {
        id: 'knowledge',
        name: 'Language Knowledge (Vocabulary/Grammar)',
        skill: 'reading',
        maxScore: 60,
        minimumScore: 19,
        durationMinutes: 30,
      },
      { id: 'reading', name: 'Reading', skill: 'reading', maxScore: 60, minimumScore: 19, durationMinutes: 70 },
      { id: 'listening', name: 'Listening', skill: 'listening', maxScore: 60, minimumScore: 19, durationMinutes: 40 },
    ],
    totalScore: 180,
    passingScore: 95,
    description:
      'The bridge level, and the first with three separately scored sections. Highest pass mark of any JLPT level.',
    cardWeights: { recognition: 5, reading: 4, listening: 3, grammar: 3, script: 2, production: 1 },
  },
  {
    id: 'jlpt-n2',
    name: 'JLPT N2',
    shortName: 'N2',
    order: 4,
    cefr: 'B2',
    vocabularyTarget: 6000,
    characterTarget: 1000,
    grammarPointTarget: 400,
    sections: [
      {
        id: 'knowledge-reading',
        name: 'Language Knowledge & Reading',
        skill: 'reading',
        maxScore: 120,
        durationMinutes: 105,
      },
      { id: 'listening', name: 'Listening', skill: 'listening', maxScore: 60, minimumScore: 19, durationMinutes: 50 },
    ],
    totalScore: 180,
    passingScore: 90,
    description:
      'Newspapers, general commentary and natural-speed speech. The level most employers ask for.',
    cardWeights: { recognition: 4, reading: 5, listening: 4, grammar: 3, production: 1 },
  },
  {
    id: 'jlpt-n1',
    name: 'JLPT N1',
    shortName: 'N1',
    order: 5,
    cefr: 'C1',
    vocabularyTarget: 10000,
    characterTarget: 2000,
    grammarPointTarget: 550,
    sections: [
      {
        id: 'knowledge-reading',
        name: 'Language Knowledge & Reading',
        skill: 'reading',
        maxScore: 120,
        durationMinutes: 110,
      },
      { id: 'listening', name: 'Listening', skill: 'listening', maxScore: 60, minimumScore: 19, durationMinutes: 55 },
    ],
    totalScore: 180,
    passingScore: 100,
    description: 'Abstract and logically complex Japanese across any topic, roughly 2,000 kanji.',
    cardWeights: { recognition: 4, reading: 6, listening: 4, grammar: 4, production: 1 },
  },
];

export const JLPT_TRACK: ExamTrack = {
  id: 'jlpt',
  languageCode: 'ja',
  name: 'JLPT',
  fullName: 'Japanese-Language Proficiency Test',
  authority: 'Japan Foundation & Japan Educational Exchanges and Services',
  levels: JLPT_LEVELS,
  note:
    'Entirely multiple choice — no writing or speaking section. Sectional minimums can fail you even on a passing total.',
  source:
    'Official JLPT pass marks, sectional minimums and test durations. Vocabulary and kanji counts are widely-cited community estimates: no official lists have been published since the 2010 revision.',
  targetsAreOfficial: false,
};
