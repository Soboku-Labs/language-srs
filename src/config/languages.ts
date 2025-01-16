import { Language } from '../types/types';

export const languages: Language[] = [
  {
    code: 'chinese',
    name: 'Chinese',
    examType: 'HSK',
    levels: ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'],
    description: 'Study Chinese characters and vocabulary for the HSK examination',
    totalWords: 5000
  },
  {
    code: 'japanese',
    name: 'Japanese',
    examType: 'JLPT',
    levels: ['N5', 'N4', 'N3', 'N2', 'N1'],
    description: 'Master Japanese vocabulary for all JLPT levels',
    totalWords: 10000
  },
  {
    code: 'korean',
    name: 'Korean',
    examType: 'TOPIK',
    levels: ['TOPIK I Level 1', 'TOPIK I Level 2', 'TOPIK II Level 3', 'TOPIK II Level 4', 'TOPIK II Level 5', 'TOPIK II Level 6'],
    description: 'Learn Korean vocabulary for the TOPIK examination',
    totalWords: 6000
  }
];