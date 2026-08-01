/**
 * @language-srs/core — platform-agnostic domain logic.
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
  buildStudyQueue,
  countTodaysWork,
  interleaveByKindWeights,
} from './session/queue';
export type { BuildQueueOptions, DailyCounts, QueueBreakdown, StudyQueue } from './session/queue';

// Stats
export {
  computeCoverage,
  computeRetention,
  computeStreak,
  forecastReviews,
  meanRetrievability,
} from './stats/metrics';
export type { CoverageStats, ForecastDay, RetentionStats, StreakInfo } from './stats/metrics';
export { computeExamReadiness, suggestDailyNewLimit } from './stats/readiness';
export type { ExamReadiness, ReadinessVerdict } from './stats/readiness';

// Accounts — the contract the API server and the app both implement
export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_TTL_DAYS,
  normaliseEmail,
  resolveDisplayName,
  validateEmail,
  validatePassword,
} from './auth/types';
export type {
  ApiErrorBody,
  AuthErrorCode,
  AuthResult,
  AuthSessionInfo,
  PublicUser,
  UserId,
} from './auth/types';
export { mergeStudySessions } from './auth/sync';
export type {
  AccountState,
  PutStateRequest,
  PutStateResponse,
  StateConflict,
  StudySessionsResponse,
} from './auth/sync';

// Study sittings — the grain a person thinks in, above individual gradings
export {
  SESSION_GAP_MINUTES,
  addGradeToSession,
  finishStudySession,
  formatDuration,
  groupLogsIntoSessions,
  startStudySession,
  summariseSessions,
} from './sessions';
export type { SessionDay, SessionSummary, StudySessionDraft, StudySessionRecord } from './sessions';

// Culture — the place behind each language, for the art and the copy
export { CULTURE_PROFILES, describePlace, getCulture } from './culture';
export type { CultureProfile } from './culture';

// Teachers — one character per language, shown on the landing page and in session
export { TEACHERS, getTeacher, teacherLine } from './teachers';
export type { Teacher, TeacherLines, TeacherMood } from './teachers';

// Practice — answer checking for the two card kinds that can be answered
export { checkTonePattern, checkWrittenAnswer } from './practice/check';
export type { AnswerVerdict, ToneCheck, WrittenCheck } from './practice/check';
export {
  TONE_SYSTEMS,
  describeTonePattern,
  getToneDescriptor,
  getToneSystem,
} from './practice/tones';
export type { ToneDescriptor } from './practice/tones';

// Themes — one per language, shared by the app and the native widgets
export {
  LANGUAGE_THEMES,
  getCardKindColors,
  getLanguageTheme,
  getToneColor,
  getToneColors,
} from './theme/palettes';
export type { LanguageTheme, ThemeColors, ThemeMode, ThemeRadius } from './theme/palettes';

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
  linkToLanding,
  linkToReveal,
  linkToReview,
  linkToSettings,
  linkToStats,
  parseDeepLink,
} from './widget/deeplinks';
export type { ParsedDeepLink } from './widget/deeplinks';

// Storage
export { MemoryStore, MirroringStore, PrefixedStore, accountPrefix, readJson, writeJson } from './storage/port';
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

// The syllabuses themselves — every level's words, generated by tools/vocab
export {
  VOCABULARY_SOURCES,
  getLevelEntries,
  getLevelSizes,
  getVocabularyCounts,
  getVocabularyEntries,
} from './data/vocab';
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
export { cardId, parseCardId, reviewLogId, studySessionId } from './utils/id';

// Engine
export { STORAGE_KEYS, SYNCED_STORAGE_KEYS, StudyEngine } from './engine';
export type { StudyEngineOptions } from './engine';
