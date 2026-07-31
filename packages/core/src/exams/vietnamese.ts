import type { ExamLevel, ExamTrack } from '../types/exam';

/**
 * Vietnamese proficiency — the six-level MOET framework (Khung năng lực tiếng
 * Việt dùng cho người nước ngoài), CEFR-aligned A1 to C2.
 *
 * This track is the odd one out and the app should be honest about why:
 *
 *  - Unlike HSK, there is no official published word list. The vocabulary
 *    targets below are estimates derived from the CEFR band each level maps to,
 *    so `targetsAreOfficial` is false and the UI labels coverage as an estimate.
 *  - Like TOPIK, one paper covers a pair of levels: Sơ cấp (1-2), Trung cấp
 *    (3-4), Cao cấp (5-6).
 *  - Unlike every other track here, all four skills are examined at every
 *    level, speaking included. That pushes production, listening and tone
 *    weights up across the board.
 *
 * Exams use the Northern (Hanoi) standard with its six tones. Southern
 * varieties merge hỏi and ngã, so tone cards follow the Northern contrast.
 */
const FOUR_SKILL_SECTIONS = (durations: {
  listening: number;
  reading: number;
  writing: number;
  speaking: number;
}) => [
  {
    id: 'listening',
    name: 'Nghe (Listening)',
    skill: 'listening' as const,
    maxScore: 100,
    durationMinutes: durations.listening,
  },
  { id: 'reading', name: 'Đọc (Reading)', skill: 'reading' as const, maxScore: 100, durationMinutes: durations.reading },
  { id: 'writing', name: 'Viết (Writing)', skill: 'writing' as const, maxScore: 100, durationMinutes: durations.writing },
  {
    id: 'speaking',
    name: 'Nói (Speaking)',
    skill: 'speaking' as const,
    maxScore: 100,
    durationMinutes: durations.speaking,
  },
];

const ELEMENTARY_SECTIONS = FOUR_SKILL_SECTIONS({ listening: 30, reading: 40, writing: 40, speaking: 12 });
const INTERMEDIATE_SECTIONS = FOUR_SKILL_SECTIONS({ listening: 40, reading: 55, writing: 60, speaking: 15 });
const ADVANCED_SECTIONS = FOUR_SKILL_SECTIONS({ listening: 45, reading: 60, writing: 80, speaking: 18 });

const VSL_LEVELS: ExamLevel[] = [
  {
    id: 'vsl-1',
    name: 'Bậc 1 — Elementary',
    shortName: 'Bậc 1',
    order: 1,
    cefr: 'A1',
    vocabularyTarget: 900,
    grammarPointTarget: 50,
    sections: ELEMENTARY_SECTIONS,
    totalScore: 400,
    passingScore: 200,
    description: 'Greetings, self-introduction, numbers and immediate needs. Sat as the Sơ cấp paper.',
    cardWeights: { recognition: 5, tone: 5, listening: 4, production: 3, script: 2 },
  },
  {
    id: 'vsl-2',
    name: 'Bậc 2 — Upper elementary',
    shortName: 'Bậc 2',
    order: 2,
    cefr: 'A2',
    vocabularyTarget: 1800,
    grammarPointTarget: 110,
    sections: ELEMENTARY_SECTIONS,
    totalScore: 400,
    passingScore: 280,
    description: 'Routine exchanges about family, shopping, work and local geography.',
    cardWeights: { recognition: 5, tone: 4, listening: 4, production: 4, reading: 2, grammar: 2 },
  },
  {
    id: 'vsl-3',
    name: 'Bậc 3 — Intermediate',
    shortName: 'Bậc 3',
    order: 3,
    cefr: 'B1',
    vocabularyTarget: 3000,
    grammarPointTarget: 190,
    sections: INTERMEDIATE_SECTIONS,
    totalScore: 400,
    passingScore: 200,
    description: 'Handles travel and work situations, describes experiences and gives reasons. Trung cấp paper.',
    cardWeights: { recognition: 4, tone: 3, listening: 4, production: 4, reading: 3, writing: 3, grammar: 3 },
  },
  {
    id: 'vsl-4',
    name: 'Bậc 4 — Upper intermediate',
    shortName: 'Bậc 4',
    order: 4,
    cefr: 'B2',
    vocabularyTarget: 4500,
    grammarPointTarget: 280,
    sections: INTERMEDIATE_SECTIONS,
    totalScore: 400,
    passingScore: 280,
    description: 'Discusses concrete and abstract topics and argues a position. Common bar for university study.',
    cardWeights: { recognition: 4, tone: 2, listening: 4, production: 4, reading: 4, writing: 4, grammar: 3 },
  },
  {
    id: 'vsl-5',
    name: 'Bậc 5 — Advanced',
    shortName: 'Bậc 5',
    order: 5,
    cefr: 'C1',
    vocabularyTarget: 6000,
    grammarPointTarget: 370,
    sections: ADVANCED_SECTIONS,
    totalScore: 400,
    passingScore: 200,
    description: 'Reads demanding text and speaks fluently for social and professional purposes. Cao cấp paper.',
    cardWeights: { recognition: 3, listening: 4, production: 4, reading: 5, writing: 4, grammar: 3, tone: 1 },
  },
  {
    id: 'vsl-6',
    name: 'Bậc 6 — Mastery',
    shortName: 'Bậc 6',
    order: 6,
    cefr: 'C2',
    vocabularyTarget: 8000,
    grammarPointTarget: 450,
    sections: ADVANCED_SECTIONS,
    totalScore: 400,
    passingScore: 280,
    description: 'Understands virtually everything read or heard and expresses shades of meaning precisely.',
    cardWeights: { recognition: 3, listening: 4, production: 4, reading: 6, writing: 5, grammar: 4 },
  },
];

export const VSL_TRACK: ExamTrack = {
  id: 'vsl',
  languageCode: 'vi',
  name: 'Vietnamese Proficiency (VSL)',
  fullName: 'Khung năng lực tiếng Việt dùng cho người nước ngoài — six-level framework',
  authority: 'Vietnamese Ministry of Education and Training (MOET)',
  levels: VSL_LEVELS,
  note:
    'One paper covers each pair of levels: Sơ cấp (1-2), Trung cấp (3-4), Cao cấp (5-6). All four skills including speaking are examined at every level. Formats vary between accredited centres — confirm with yours.',
  source:
    'MOET Circular 17/2015/TT-BGDĐT (six-level framework, CEFR alignment) and 27/2019/TT-BGDĐT (exam format). Vocabulary and grammar targets are estimates inferred from the CEFR band — MOET publishes no official word list. Section durations are typical rather than fixed.',
  targetsAreOfficial: false,
};
