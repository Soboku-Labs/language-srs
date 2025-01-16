export interface VocabularyItem {
  id: string;
  word: string;
  pronunciation: string;
  meaning: string;
  language: 'chinese' | 'japanese' | 'korean';
  level: string;
  nextReview: Date;
  interval: number;
  easeFactor: number;
  examples: string[];
  audioUrl?: string;
  components?: string[]; // For character components
  tags: string[];
  reviewHistory: Review[];
}

export interface Review {
  date: Date;
  grade: 1 | 2 | 3;
  timeTaken: number;
}

export interface Language {
  code: 'chinese' | 'japanese' | 'korean';
  name: string;
  examType: string;
  levels: string[];
  description: string;
  totalWords: number;
}

export interface UserProgress {
  language: string;
  level: string;
  wordsLearned: number;
  accuracy: number;
  streakDays: number;
  lastReview: Date;
}