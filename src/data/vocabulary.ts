import { VocabularyItem } from '../types/types';

export const sampleVocabulary: VocabularyItem[] = [
  {
    id: 'zh-1',
    word: '你好',
    pronunciation: 'nǐ hǎo',
    meaning: 'hello',
    language: 'chinese',
    level: 'HSK1',
    nextReview: new Date(),
    interval: 1,
    easeFactor: 2.5,
    examples: ['你好，我叫小明。'],
    tags: ['greeting', 'basic'],
    reviewHistory: []
  },
  {
    id: 'ja-1', 
    word: 'こんにちは',
    pronunciation: 'konnichiwa',
    meaning: 'hello',
    language: 'japanese',
    level: 'N5',
    nextReview: new Date(),
    interval: 1,
    easeFactor: 2.5,
    examples: ['こんにちは、田中です。'],
    tags: ['greeting', 'basic'],
    reviewHistory: []
  },
  {
    id: 'ko-1',
    word: '안녕하세요',
    pronunciation: 'annyeonghaseyo', 
    meaning: 'hello',
    language: 'korean',
    level: 'TOPIK 1',
    nextReview: new Date(),
    interval: 1,
    easeFactor: 2.5,
    examples: ['안녕하세요, 저는 민수입니다.'],
    tags: ['greeting', 'basic'],
    reviewHistory: []
  }
];