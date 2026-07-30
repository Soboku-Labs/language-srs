import type { ExamLevel, ExamTrack } from '../types/exam';

/**
 * TOPIK — six levels awarded across two different papers, which is the wrinkle
 * that makes this track different from HSK and JLPT.
 *
 * You do not sit "level 3". You sit TOPIK I (levels 1-2) or TOPIK II
 * (levels 3-6), and the level you are awarded depends on your total score. So
 * `passingScore` here is the score that earns that level, and several levels
 * share the same paper and the same sections.
 *
 * TOPIK II is also the only paper in this app's four languages with a
 * substantial free-writing section — two short-answer and two composition
 * tasks, including a 600-700 character essay — so its card weights lean hard
 * on production and writing.
 */
const TOPIK_I_SECTIONS = [
  {
    id: 'listening',
    name: 'Listening',
    skill: 'listening' as const,
    questionCount: 30,
    maxScore: 100,
    durationMinutes: 40,
  },
  { id: 'reading', name: 'Reading', skill: 'reading' as const, questionCount: 40, maxScore: 100, durationMinutes: 60 },
];

const TOPIK_II_SECTIONS = [
  {
    id: 'listening',
    name: 'Listening',
    skill: 'listening' as const,
    questionCount: 50,
    maxScore: 100,
    durationMinutes: 60,
  },
  { id: 'writing', name: 'Writing', skill: 'writing' as const, questionCount: 4, maxScore: 100, durationMinutes: 50 },
  { id: 'reading', name: 'Reading', skill: 'reading' as const, questionCount: 50, maxScore: 100, durationMinutes: 70 },
];

const TOPIK_LEVELS: ExamLevel[] = [
  {
    id: 'topik-1',
    name: 'TOPIK I — Level 1',
    shortName: 'Level 1',
    order: 1,
    cefr: 'A1',
    vocabularyTarget: 800,
    grammarPointTarget: 60,
    sections: TOPIK_I_SECTIONS,
    totalScore: 200,
    passingScore: 80,
    description: 'Basic survival Korean. Awarded for 80 of 200 on the TOPIK I paper.',
    cardWeights: { script: 5, recognition: 5, listening: 4, grammar: 2, reading: 2 },
  },
  {
    id: 'topik-2',
    name: 'TOPIK I — Level 2',
    shortName: 'Level 2',
    order: 2,
    cefr: 'A2',
    vocabularyTarget: 1800,
    grammarPointTarget: 130,
    sections: TOPIK_I_SECTIONS,
    totalScore: 200,
    passingScore: 140,
    description: 'Routine daily conversation and simple public notices. Awarded for 140 of 200 on TOPIK I.',
    cardWeights: { recognition: 5, listening: 4, reading: 3, grammar: 3, script: 2 },
  },
  {
    id: 'topik-3',
    name: 'TOPIK II — Level 3',
    shortName: 'Level 3',
    order: 3,
    cefr: 'B1',
    vocabularyTarget: 3000,
    grammarPointTarget: 220,
    sections: TOPIK_II_SECTIONS,
    totalScore: 300,
    passingScore: 120,
    description:
      'Everyday social life plus familiar written text. First level to require the TOPIK II writing section.',
    cardWeights: { recognition: 4, listening: 4, reading: 4, writing: 3, production: 3, grammar: 3 },
  },
  {
    id: 'topik-4',
    name: 'TOPIK II — Level 4',
    shortName: 'Level 4',
    order: 4,
    cefr: 'B2',
    vocabularyTarget: 5000,
    grammarPointTarget: 320,
    sections: TOPIK_II_SECTIONS,
    totalScore: 300,
    passingScore: 150,
    description: 'News, general workplace tasks and abstract topics. The usual bar for university admission.',
    cardWeights: { recognition: 4, listening: 4, reading: 5, writing: 4, production: 3, grammar: 3 },
  },
  {
    id: 'topik-5',
    name: 'TOPIK II — Level 5',
    shortName: 'Level 5',
    order: 5,
    cefr: 'C1',
    vocabularyTarget: 7500,
    grammarPointTarget: 420,
    sections: TOPIK_II_SECTIONS,
    totalScore: 300,
    passingScore: 190,
    description: 'Professional and academic Korean, including unfamiliar specialist topics.',
    cardWeights: { recognition: 3, listening: 4, reading: 6, writing: 4, production: 3, grammar: 3 },
  },
  {
    id: 'topik-6',
    name: 'TOPIK II — Level 6',
    shortName: 'Level 6',
    order: 6,
    cefr: 'C2',
    vocabularyTarget: 10000,
    grammarPointTarget: 500,
    sections: TOPIK_II_SECTIONS,
    totalScore: 300,
    passingScore: 230,
    description: 'Near-native comprehension and expression. Awarded for 230 of 300 on TOPIK II.',
    cardWeights: { recognition: 3, listening: 4, reading: 6, writing: 5, production: 4, grammar: 4 },
  },
];

export const TOPIK_TRACK: ExamTrack = {
  id: 'topik',
  languageCode: 'ko',
  name: 'TOPIK',
  fullName: 'Test of Proficiency in Korean',
  authority: 'National Institute for International Education (NIIED)',
  levels: TOPIK_LEVELS,
  note:
    'You sit TOPIK I (levels 1-2) or TOPIK II (levels 3-6) and are awarded a level by score — there is no separate paper per level. Speaking is a separate optional test.',
  source:
    'Official NIIED test format, question counts, durations and level cut-off scores. Vocabulary and grammar counts are community estimates; NIIED does not publish word lists.',
  targetsAreOfficial: false,
};
