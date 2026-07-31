import { generateCards } from './cards/factory';
import { findExamTrack, getExamTrack, getLevelIdsInScope } from './exams';
import { buildStudyQueue, countTodaysWork, type StudyQueue } from './session/queue';
import { DEFAULT_SCHEDULER_CONFIG, type SchedulerConfig } from './srs/params';
import { gradeCard } from './srs/scheduler';
import { computeCoverage, computeRetention, computeStreak, forecastReviews } from './stats/metrics';
import { computeExamReadiness, type ExamReadiness } from './stats/readiness';
import { readJson, writeJson, type KeyValueStore } from './storage/port';
import {
  DEFAULT_STUDY_PROFILE,
  type Card,
  type LexicalEntry,
  type StudyProfile,
  type Timestamp,
} from './types/card';
import { LANGUAGE_CODES, getLanguageProfile, type LanguageCode } from './types/language';
import type { GradeResult, Rating, ReviewSource } from './types/review';
import { systemClock, type Clock } from './utils/date';
import { buildWidgetSnapshot, buildWidgetTimeline, pickSpotlight, type WidgetSnapshot, type WidgetTimeline } from './widget/payload';
import { applyPendingGrades, type PendingWidgetGrade } from './widget/pending';

const STORAGE_VERSION = 1;
const KEY_PREFIX = `srs:v${STORAGE_VERSION}`;

export const STORAGE_KEYS = {
  meta: `${KEY_PREFIX}:meta`,
  cards: `${KEY_PREFIX}:cards`,
  logs: `${KEY_PREFIX}:logs`,
  entries: `${KEY_PREFIX}:entries`,
  pending: `${KEY_PREFIX}:pending`,
  /** The flattened snapshot the native widget reads. Never read back by the app. */
  widget: `${KEY_PREFIX}:widget`,
} as const;

/**
 * Cap on retained review logs.
 *
 * Logs drive streaks, retention and eventual FSRS re-fitting, so they are worth
 * keeping — but not without bound on a phone. Twenty thousand covers years of
 * ordinary use and a few megabytes of JSON; older entries are dropped oldest
 * first.
 */
const MAX_RETAINED_LOGS = 20_000;

interface EngineMeta {
  version: number;
  activeLanguage: LanguageCode;
  profiles: Partial<Record<LanguageCode, StudyProfile>>;
  schedulerConfig: Partial<SchedulerConfig>;
}

export interface StudyEngineOptions {
  store: KeyValueStore;
  /**
   * Vocabulary shipped with the app. Kept out of storage — it is the same on
   * every device and would only bloat the blob — and merged with imported
   * entries on load.
   */
  seedEntries?: LexicalEntry[];
  clock?: Clock;
  /**
   * Called after every state change. The app uses it to push a fresh snapshot
   * to the widget; tests leave it unset.
   */
  onStateChanged?: (engine: StudyEngine) => void | Promise<void>;
}

/**
 * The single API surface the app talks to.
 *
 * Everything platform-independent lives behind this class: loading, scheduling,
 * grading, stats and widget payloads. The React layer holds no domain logic, so
 * the web build and the two native builds cannot drift in behaviour — and the
 * whole system can be driven from a Node test without rendering anything.
 */
export class StudyEngine {
  private meta: EngineMeta;
  private cards: Card[];
  private logs: import('./types/review').ReviewLog[];
  private importedEntries: LexicalEntry[];
  private pending: PendingWidgetGrade[];
  private readonly entriesById = new Map<string, LexicalEntry>();
  private readonly clock: Clock;

  private constructor(
    private readonly options: StudyEngineOptions,
    state: {
      meta: EngineMeta;
      cards: Card[];
      logs: import('./types/review').ReviewLog[];
      importedEntries: LexicalEntry[];
      pending: PendingWidgetGrade[];
    },
  ) {
    this.clock = options.clock ?? systemClock;
    this.meta = state.meta;
    this.cards = state.cards;
    this.logs = state.logs;
    this.importedEntries = state.importedEntries;
    this.pending = state.pending;
    this.reindexEntries();
  }

  static async create(options: StudyEngineOptions): Promise<StudyEngine> {
    const { store } = options;
    const clock = options.clock ?? systemClock;

    const meta = await readJson<EngineMeta>(store, STORAGE_KEYS.meta, {
      version: STORAGE_VERSION,
      activeLanguage: 'zh',
      profiles: {},
      schedulerConfig: {},
    });

    const engine = new StudyEngine(options, {
      meta,
      cards: await readJson<Card[]>(store, STORAGE_KEYS.cards, []),
      logs: await readJson<import('./types/review').ReviewLog[]>(store, STORAGE_KEYS.logs, []),
      importedEntries: await readJson<LexicalEntry[]>(store, STORAGE_KEYS.entries, []),
      pending: await readJson<PendingWidgetGrade[]>(store, STORAGE_KEYS.pending, []),
    });

    // A fresh install has no profile and no cards; a returning one may have new
    // seed vocabulary shipped in an app update. Both are handled by the same
    // idempotent sync.
    await engine.ensureProfile(engine.meta.activeLanguage);
    await engine.syncCards();
    await engine.applyPendingWidgetGrades();

    return engine;
  }

  // ---------------------------------------------------------------- state

  now(): Timestamp {
    return this.clock();
  }

  get activeLanguage(): LanguageCode {
    return this.meta.activeLanguage;
  }

  get schedulerConfig(): SchedulerConfig {
    return { ...DEFAULT_SCHEDULER_CONFIG, ...this.meta.schedulerConfig };
  }

  /** Every language with a profile, in the app's canonical order. */
  get studiedLanguages(): LanguageCode[] {
    return LANGUAGE_CODES.filter((code) => this.meta.profiles[code]);
  }

  getProfile(code: LanguageCode = this.meta.activeLanguage): StudyProfile {
    const profile = this.meta.profiles[code];
    if (!profile) throw new Error(`No study profile for ${code}. Call ensureProfile first.`);
    // Per-profile retention feeds the scheduler; keep the two in step.
    return profile;
  }

  hasProfile(code: LanguageCode): boolean {
    return Boolean(this.meta.profiles[code]);
  }

  getAllCards(code: LanguageCode = this.meta.activeLanguage): Card[] {
    return this.cards.filter((card) => card.languageCode === code);
  }

  getEntry(entryId: string): LexicalEntry | undefined {
    return this.entriesById.get(entryId);
  }

  get entries(): Map<string, LexicalEntry> {
    return this.entriesById;
  }

  // ---------------------------------------------------------------- profiles

  /** Create a default profile for a language if there is not one already. */
  async ensureProfile(code: LanguageCode): Promise<StudyProfile> {
    const existing = this.meta.profiles[code];
    if (existing) return existing;

    const language = getLanguageProfile(code);
    const track = getExamTrack(language.defaultExamTrackId);
    const firstLevel = track.levels[0];
    if (!firstLevel) throw new Error(`Exam track ${track.id} has no levels`);

    const now = this.now();
    const profile: StudyProfile = {
      ...DEFAULT_STUDY_PROFILE,
      languageCode: code,
      examTrackId: track.id,
      targetLevelId: firstLevel.id,
      createdAt: now,
      updatedAt: now,
    };

    this.meta.profiles[code] = profile;
    await this.persistMeta();
    await this.syncCards();
    return profile;
  }

  async setActiveLanguage(code: LanguageCode): Promise<void> {
    await this.ensureProfile(code);
    this.meta.activeLanguage = code;
    await this.persistMeta();
    await this.notifyChanged();
  }

  async updateProfile(code: LanguageCode, patch: Partial<Omit<StudyProfile, 'languageCode'>>): Promise<StudyProfile> {
    const current = await this.ensureProfile(code);
    const next: StudyProfile = { ...current, ...patch, languageCode: code, updatedAt: this.now() };
    this.meta.profiles[code] = next;
    await this.persistMeta();

    // Changing the level or the enabled kinds changes which cards should exist.
    if (patch.targetLevelId !== undefined || patch.examTrackId !== undefined || patch.enabledCardKinds !== undefined) {
      await this.syncCards();
    }
    await this.notifyChanged();
    return next;
  }

  /** Switch exam track, resetting the target level to the equivalent position. */
  async setExamTrack(code: LanguageCode, trackId: string): Promise<StudyProfile> {
    const track = findExamTrack(trackId);
    if (!track) throw new Error(`Unknown exam track: ${trackId}`);
    if (track.languageCode !== code) {
      throw new Error(`Exam track ${trackId} is for ${track.languageCode}, not ${code}`);
    }

    const current = await this.ensureProfile(code);
    const currentOrder = getExamTrack(current.examTrackId).levels.find((l) => l.id === current.targetLevelId)?.order ?? 1;
    const level = track.levels.find((l) => l.order === currentOrder) ?? track.levels[0]!;

    return this.updateProfile(code, { examTrackId: trackId, targetLevelId: level.id });
  }

  // ---------------------------------------------------------------- cards

  /**
   * Bring the card set in line with the current profiles.
   *
   * Idempotent by construction: card ids are `entryId:kind`, so an entry already
   * carrying review history keeps it. Raising the target level adds the cards
   * for the newly-in-scope levels; lowering it leaves the out-of-scope cards
   * alone, because deleting a learner's history to reflect a settings change
   * would be indefensible — the queue filters them out instead.
   */
  async syncCards(): Promise<void> {
    const existing = new Map(this.cards.map((card) => [card.id, card]));
    const next = new Map(existing);

    for (const code of LANGUAGE_CODES) {
      const profile = this.meta.profiles[code];
      if (!profile) continue;

      const scope = getLevelIdsInScope(profile.targetLevelId);
      const entries = [...this.entriesById.values()].filter((entry) => entry.languageCode === code);
      const generated = generateCards(entries, scope, {
        now: this.now(),
        existing: this.cards,
        ...(profile.enabledCardKinds ? { enabledCardKinds: profile.enabledCardKinds } : {}),
      });

      for (const card of generated) {
        if (!next.has(card.id)) next.set(card.id, card);
      }
    }

    if (next.size !== existing.size) {
      this.cards = [...next.values()];
      await this.persistCards();
    }
  }

  // ---------------------------------------------------------------- studying

  getQueue(options: { code?: LanguageCode; sessionLimit?: number; now?: Timestamp } = {}): StudyQueue {
    const code = options.code ?? this.meta.activeLanguage;
    const profile = this.getProfile(code);
    const now = options.now ?? this.now();

    return buildStudyQueue({
      now,
      profile,
      cards: this.getAllCards(code),
      entries: this.entriesById,
      done: countTodaysWork(this.logs, now, profile.dayStartHour),
      ...(options.sessionLimit !== undefined ? { sessionLimit: options.sessionLimit } : {}),
    });
  }

  /** Grade a card and persist the result. */
  async grade(
    cardId: string,
    rating: Rating,
    options: { durationMs?: number; source?: ReviewSource; now?: Timestamp } = {},
  ): Promise<GradeResult> {
    const index = this.cards.findIndex((card) => card.id === cardId);
    if (index === -1) throw new Error(`Unknown card: ${cardId}`);

    const card = this.cards[index]!;
    const profile = this.getProfile(card.languageCode);

    const result = gradeCard(card, rating, {
      now: options.now ?? this.now(),
      config: { ...this.meta.schedulerConfig, desiredRetention: profile.desiredRetention },
      ...(profile.examDate ? { examDate: profile.examDate } : {}),
      ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
      source: options.source ?? 'app',
    });

    this.cards[index] = result.card;
    this.logs.push(result.log);
    this.trimLogs();

    await Promise.all([this.persistCards(), this.persistLogs()]);
    await this.notifyChanged();
    return result;
  }

  async setCardSuspended(cardId: string, suspended: boolean): Promise<void> {
    const index = this.cards.findIndex((card) => card.id === cardId);
    if (index === -1) return;
    this.cards[index] = { ...this.cards[index]!, suspended };
    await this.persistCards();
    await this.notifyChanged();
  }

  // ---------------------------------------------------------------- stats

  getStats(code: LanguageCode = this.meta.activeLanguage, now: Timestamp = this.now()) {
    const profile = this.getProfile(code);
    const cards = this.getAllCards(code);
    const trackLevels = getExamTrack(profile.examTrackId).levels;
    const level = trackLevels.find((candidate) => candidate.id === profile.targetLevelId);

    return {
      streak: computeStreak(this.logs, now, profile.dayStartHour),
      retention: computeRetention(this.logs, 30, now),
      coverage: computeCoverage(cards, level?.vocabularyTarget ?? 0),
      forecast: forecastReviews(cards, now, 14, profile.dayStartHour),
      today: countTodaysWork(this.logs, now, profile.dayStartHour),
    };
  }

  getReadiness(code: LanguageCode = this.meta.activeLanguage, now: Timestamp = this.now()): ExamReadiness {
    return computeExamReadiness(this.getAllCards(code), this.getProfile(code), now);
  }

  // ---------------------------------------------------------------- widget

  /**
   * The snapshot the native widget renders.
   *
   * Built here rather than in the widget process, and written to shared storage
   * on every state change — see `onStateChanged`.
   */
  getWidgetSnapshot(code: LanguageCode = this.meta.activeLanguage, now: Timestamp = this.now()): WidgetSnapshot {
    const profile = this.getProfile(code);
    const queue = this.getQueue({ code, now });

    return buildWidgetSnapshot({
      now,
      profile,
      queue,
      streak: computeStreak(this.logs, now, profile.dayStartHour),
      readiness: this.getReadiness(code, now),
      ...(queue.cards.length === 0
        ? { spotlight: pickSpotlight(this.getAllCards(code), this.entriesById, now) }
        : {}),
      config: { ...this.meta.schedulerConfig, desiredRetention: profile.desiredRetention },
    });
  }

  getWidgetTimeline(code: LanguageCode = this.meta.activeLanguage, now: Timestamp = this.now()): WidgetTimeline {
    const profile = this.getProfile(code);

    return buildWidgetTimeline({
      now,
      profile,
      queue: this.getQueue({ code, now }),
      streak: computeStreak(this.logs, now, profile.dayStartHour),
      readiness: this.getReadiness(code, now),
      // Recompute the queue at each future instant so a timeline entry three
      // hours out shows the counts that will actually be true then.
      projectQueue: (at) => this.getQueue({ code, now: at }),
      config: { ...this.meta.schedulerConfig, desiredRetention: profile.desiredRetention },
    });
  }

  /** Serialised snapshot for the shared container the native widget reads. */
  serialiseWidgetPayload(code: LanguageCode = this.meta.activeLanguage): string {
    return JSON.stringify(this.getWidgetSnapshot(code));
  }

  /** Queue a grading made on the home screen while the app was not running. */
  async enqueueWidgetGrade(grade: PendingWidgetGrade): Promise<void> {
    this.pending.push(grade);
    await writeJson(this.options.store, STORAGE_KEYS.pending, this.pending);
  }

  /** Replay queued widget gradings through the scheduler. Called on every launch. */
  async applyPendingWidgetGrades(): Promise<{ applied: number; skipped: number }> {
    if (this.pending.length === 0) return { applied: 0, skipped: 0 };

    const grouped = new Map<LanguageCode, PendingWidgetGrade[]>();
    for (const grade of this.pending) {
      const card = this.cards.find((candidate) => candidate.id === grade.cardId);
      const code = card?.languageCode ?? this.meta.activeLanguage;
      const bucket = grouped.get(code);
      if (bucket) bucket.push(grade);
      else grouped.set(code, [grade]);
    }

    let applied = 0;
    let skipped = 0;

    for (const [code, grades] of grouped) {
      if (!this.meta.profiles[code]) {
        skipped += grades.length;
        continue;
      }
      const result = applyPendingGrades(this.cards, grades, {
        profile: this.getProfile(code),
        config: this.meta.schedulerConfig,
      });

      this.cards = this.cards.map((card) => result.updated.get(card.id) ?? card);
      this.logs.push(...result.logs);
      applied += result.applied;
      skipped += result.skipped.length;
    }

    this.pending = [];
    this.trimLogs();

    await Promise.all([
      this.persistCards(),
      this.persistLogs(),
      writeJson(this.options.store, STORAGE_KEYS.pending, this.pending),
    ]);
    await this.notifyChanged();

    return { applied, skipped };
  }

  // ---------------------------------------------------------------- import

  /**
   * Add vocabulary, replacing entries with a matching id.
   *
   * This is how a full official word list gets in: the seed decks are a starting
   * point, not a claim to be the HSK syllabus. Cards are regenerated afterwards,
   * so imported words become studiable immediately without losing history on
   * words that were already there.
   */
  async importEntries(entries: LexicalEntry[]): Promise<{ added: number; replaced: number }> {
    const bySeedId = new Set((this.options.seedEntries ?? []).map((entry) => entry.id));
    const existing = new Map(this.importedEntries.map((entry) => [entry.id, entry]));

    let added = 0;
    let replaced = 0;

    for (const entry of entries) {
      if (existing.has(entry.id) || bySeedId.has(entry.id)) replaced += 1;
      else added += 1;
      existing.set(entry.id, entry);
    }

    this.importedEntries = [...existing.values()];
    this.reindexEntries();
    await writeJson(this.options.store, STORAGE_KEYS.entries, this.importedEntries);
    await this.syncCards();
    await this.notifyChanged();

    return { added, replaced };
  }

  // ---------------------------------------------------------------- persistence

  private reindexEntries(): void {
    this.entriesById.clear();
    for (const entry of this.options.seedEntries ?? []) this.entriesById.set(entry.id, entry);
    // Imported entries win, so a learner can correct a shipped definition.
    for (const entry of this.importedEntries) this.entriesById.set(entry.id, entry);
  }

  private trimLogs(): void {
    if (this.logs.length <= MAX_RETAINED_LOGS) return;
    this.logs = this.logs.slice(this.logs.length - MAX_RETAINED_LOGS);
  }

  private async persistMeta(): Promise<void> {
    await writeJson(this.options.store, STORAGE_KEYS.meta, this.meta);
  }

  private async persistCards(): Promise<void> {
    await writeJson(this.options.store, STORAGE_KEYS.cards, this.cards);
  }

  private async persistLogs(): Promise<void> {
    await writeJson(this.options.store, STORAGE_KEYS.logs, this.logs);
  }

  private async notifyChanged(): Promise<void> {
    await this.options.onStateChanged?.(this);
  }

  /** Wipe all stored state. Used by "reset progress" in settings and by tests. */
  async reset(): Promise<void> {
    this.cards = [];
    this.logs = [];
    this.pending = [];
    this.importedEntries = [];
    this.meta = { version: STORAGE_VERSION, activeLanguage: 'zh', profiles: {}, schedulerConfig: {} };
    this.reindexEntries();

    await Promise.all(Object.values(STORAGE_KEYS).map((key) => this.options.store.remove(key)));
    await this.ensureProfile('zh');
    await this.syncCards();
    await this.notifyChanged();
  }
}
