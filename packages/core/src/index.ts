/**
 * @mon/core — platform-agnostic domain logic.
 *
 * Deliberately free of React, React Native and DOM imports. The web build, the
 * iOS app, the Android app and the home-screen widgets all consume this package,
 * so anything that lands here runs identically on all four; anything that cannot
 * belongs in the app layer behind the storage port.
 */

// Types
export type {
  Card,
  CardState,
  CardWithEntry,
  DateOnly,
  ExampleSentence,
  LexicalEntry,
  StudyProfile,
  Timestamp,
} from './types/card';
export { DEFAULT_STUDY_PROFILE } from './types/card';
export type {
  CardKind,
  CardKindWeights,
  ExamLevel,
  ExamSection,
  ExamSkill,
  ExamTrack,
} from './types/exam';
export { CARD_KINDS } from './types/exam';
export type { LanguageCode, LanguageProfile, ScriptId } from './types/language';
export {
  LANGUAGE_CODES,
  LANGUAGE_PROFILES,
  getLanguageProfile,
  isLanguageCode,
} from './types/language';
export type { GradeResult, Rating, ReviewLog, ReviewSource } from './types/review';
export {
  RATING_AGAIN,
  RATING_EASY,
  RATING_GOOD,
  RATING_HARD,
  RATING_LABELS,
} from './types/review';

// Exam curricula
export {
  EXAM_TRACKS,
  HSK2_TRACK,
  HSK3_TRACK,
  JLPT_TRACK,
  TOPIK_TRACK,
  VSL_TRACK,
  findExamLevel,
  findExamTrack,
  getCumulativeLevels,
  getExamLevel,
  getExamTrack,
  getExamTracksForLanguage,
  getExaminedSkills,
  getLanguageForLevel,
  getLevelIdsInScope,
  getNextLevel,
  getTrackForLevel,
  getVocabularyDelta,
  getWeightedCardKinds,
  normaliseCardWeights,
} from './exams';

// Scheduling
export {
  DEFAULT_SCHEDULER_CONFIG,
  FSRS_DEFAULT_WEIGHTS,
  resolveSchedulerConfig,
} from './srs/params';
export type { SchedulerConfig } from './srs/params';
export {
  intervalForRetention,
  retrievability,
  stabilityForInterval,
} from './srs/fsrs';
export {
  applyFuzz,
  cardRetrievability,
  gradeCard,
  getExamPressure,
  previewIntervals,
  projectedRetrievability,
} from './srs/scheduler';
export type { ExamPressure, GradeOptions, IntervalPreview } from './srs/scheduler';

// Cards
export {
  createCard,
  generateCards,
  generateCardsForEntry,
  isCardKindApplicable,
} from './cards/factory';

// Sessions
export {
  EMPTY_DAILY_COUNTS,
  STUDY_MODES,
  buildStudyQueue,
  countTodaysWork,
  interleaveByKindWeights,
} from './session/queue';
export type {
  BuildQueueOptions,
  DailyCounts,
  QueueBreakdown,
  StudyMode,
  StudyQueue,
} from './session/queue';

// Journey — the cultural rank ladder, earned by retention rather than activity
export { JOURNEYS, getJourney, getLadder, stageEarned } from './journey';
export type { Journey, JourneyLadder, JourneyStage } from './journey';

// The day's goal
export { getDailyGoal } from './session/goal';
export type { DailyGoal } from './session/goal';

// Triage — the words that are fighting the learner
export { describeStruggle, findStrugglingCards } from './triage';
export type { FindStrugglingOptions, StruggleReason, StrugglingCard } from './triage';

// Deck — the learner's words, for browsing rather than studying
export { countByStatus, filterDeck, sortDeck, summariseDeck } from './deck';
export type { DeckEntry, DeckFilter, DeckSort, DeckStatus, SummariseDeckOptions } from './deck';

// Stats
export {
  computeCoverage,
  computeRetention,
  computeRetentionByKind,
  computeStreak,
  forecastReviews,
  meanRetrievability,
} from './stats/metrics';
export type {
  CoverageStats,
  CoverageTargets,
  ForecastDay,
  KindRetention,
  RetentionStats,
  StreakInfo,
} from './stats/metrics';
export { computeExamReadiness, suggestDailyNewLimit } from './stats/readiness';
export type { ExamReadiness, ReadinessVerdict } from './stats/readiness';

// Themes — the Suboku system, shared by the app and the native widgets
export {
  LANGUAGE_THEMES,
  RADIUS,
  getLanguageTheme,
  getToneColor,
  getToneColors,
  resolvePalette,
} from './theme/palettes';
export type { LanguageTheme, Palette, ThemeMode, ThemeRadius } from './theme/palettes';

// Answering — multiple choice, typed input, tone questions
export {
  CHOICE_COUNT,
  MEANING_KINDS,
  PRODUCTION_KINDS,
  buildChoiceOptions,
  buildToneOptions,
  checkTypedAnswer,
  editDistance,
  expectedAnswers,
  isAutoGraded,
  isTypingFeasible,
  normaliseAnswer,
  optionLabel,
  resolveAnswerMode,
  seededRandom,
  stripDiacritics,
  suggestRating,
  toneName,
} from './answer';
export type {
  AnswerAttempt,
  AnswerCheck,
  AnswerMode,
  AnswerOption,
  AnswerQuality,
} from './answer';

// Widget contract
export {
  WIDGET_SCHEMA_VERSION,
  buildWidgetSnapshot,
  buildWidgetTimeline,
  kindLabel,
  pickSpotlight,
} from './widget/payload';
export type {
  WidgetCard,
  WidgetCounts,
  WidgetFamily,
  WidgetGradeOption,
  WidgetSnapshot,
  WidgetTimeline,
} from './widget/payload';
export { applyPendingGrades } from './widget/pending';
export type { ApplyPendingResult, PendingWidgetGrade } from './widget/pending';
export {
  APP_SCHEME,
  linkToCard,
  linkToGrade,
  linkToHome,
  linkToReveal,
  linkToReview,
  linkToSettings,
  linkToStats,
  parseDeepLink,
} from './widget/deeplinks';
export type { ParsedDeepLink } from './widget/deeplinks';

// Accounts
export {
  AUTH_KEY,
  AuthError,
  AuthStore,
  DeviceAccountProvider,
  HttpAuthProvider,
  storagePrefixFor,
} from './auth';
export type {
  Account,
  AuthErrorCode,
  AuthProvider,
  AuthProviderId,
  AuthSession,
  Credentials,
  HttpAuthOptions,
} from './auth';

// Storage
export { MemoryStore, MirroringStore, PrefixedStore, readJson, writeJson } from './storage/port';
export type { KeyValueStore } from './storage/port';

// Data
export {
  JAPANESE_SEED,
  KOREAN_SEED,
  MANDARIN_SEED,
  SEED_ENTRIES,
  VIETNAMESE_SEED,
  getSeedCounts,
  getSeedEntries,
} from './data/seed';
export {
  CSV_COLUMNS,
  exportVocabularyJson,
  parseVocabularyCsv,
  parseVocabularyJson,
} from './data/importer';
export type { ImportIssue, ImportResult, ParseCsvOptions } from './data/importer';
export { makeEntry } from './data/helpers';

// Utilities
export {
  MS_PER_DAY,
  MS_PER_MINUTE,
  addDays,
  addMinutes,
  calendarDaysBetween,
  daysBetween,
  endOfStudyDay,
  fixedClock,
  formatInterval,
  isDue,
  startOfStudyDay,
  studyDayOf,
  systemClock,
  toDateOnly,
  toEpochMs,
  toTimestamp,
} from './utils/date';
export type { Clock } from './utils/date';
export { cardId, parseCardId, reviewLogId } from './utils/id';

// Engine
export { STORAGE_KEYS, StudyEngine } from './engine';
export type { StudyEngineOptions } from './engine';
