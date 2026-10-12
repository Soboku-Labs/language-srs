import { createCard, generateCards } from './cards/factory';
import { findExamTrack, getExamTrack, getLevelIdsInScope } from './exams';
import { summariseDeck, type DeckEntry } from './deck';
import { findStrugglingCards, type StrugglingCard } from './triage';
import { buildStudyQueue, countTodaysWork, type StudyMode, type StudyQueue } from './session/queue';
import { DEFAULT_SCHEDULER_CONFIG, resolveSchedulerConfig, type SchedulerConfig } from './srs/params';
import { gradeCard } from './srs/scheduler';
import {
  computeCoverage,
  computeRetention,
  computeRetentionByKind,
  computeStreak,
  forecastReviews,
} from './stats/metrics';
import { computeExamReadiness, type ExamReadiness } from './stats/readiness';
import { readJson, writeJson, type KeyValueStore } from './storage/port';
import {
  DEFAULT_STUDY_PROFILE,
  type Card,
  type LexicalEntry,
  type StudyProfile,
  type Timestamp,
} from './types/card';
import type { CardKind } from './types/exam';
import { LANGUAGE_CODES, getLanguageProfile, type LanguageCode } from './types/language';
import type { GradeResult, Rating, ReviewSource } from './types/review';
import { endOfStudyDay, systemClock, type Clock } from './utils/date';
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

/**
 * How many gradings back you can undo.
 *
 * Deep enough to fix a mis-tap you noticed a few cards later, shallow enough that
 * it cannot be used to rewind a session — which would be a way to game the
 * schedule rather than to correct a mistake.
 */
const MAX_UNDO_DEPTH = 10;

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
  /** Cards as they were before their last grading, newest last. */
  private readonly undoStack: { card: Card; logId: string }[] = [];

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
    let changed = false;

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
        const current = next.get(card.id);
        // New card, or one the generator re-tagged to the level now introducing
        // it. Comparing sizes alone missed the second case — the count is
        // unchanged when a card is only re-tagged, so a track switch persisted
        // nothing and the queue stayed empty.
        if (current === undefined || current.levelId !== card.levelId) {
          next.set(card.id, card);
          changed = true;
        }
      }
    }

    if (changed) {
      this.cards = [...next.values()];
      await this.persistCards();
    }
  }

  // ---------------------------------------------------------------- studying

  getQueue(
    options: {
      code?: LanguageCode;
      sessionLimit?: number;
      now?: Timestamp;
      mode?: StudyMode;
      kinds?: CardKind[];
    } = {},
  ): StudyQueue {
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
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
      ...(options.kinds !== undefined ? { kinds: options.kinds } : {}),
    });
  }

  /**
   * The learner's words, one row each, for browsing rather than studying.
   *
   * Deliberately not filtered to the current level: someone looking a word up is
   * as likely to be checking something they met in the wild as something on the
   * syllabus. `inScope` on each row carries that distinction instead.
   */
  getDeck(code: LanguageCode = this.meta.activeLanguage, now: Timestamp = this.now()): DeckEntry[] {
    const profile = this.getProfile(code);
    return summariseDeck({
      entries: this.getEntries(code),
      cards: this.getAllCards(code),
      now,
      targetLevelId: profile.targetLevelId,
    });
  }

  /** Suspend or restore every card for one word. */
  async setEntrySuspended(entryId: string, suspended: boolean): Promise<void> {
    let changed = false;
    this.cards = this.cards.map((card) => {
      if (card.entryId !== entryId || Boolean(card.suspended) === suspended) return card;
      changed = true;
      return { ...card, suspended };
    });

    if (!changed) return;
    await this.persistCards();
    await this.notifyChanged();
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

    this.undoStack.push({ card, logId: result.log.id });
    if (this.undoStack.length > MAX_UNDO_DEPTH) this.undoStack.shift();

    this.cards[index] = result.card;
    this.logs.push(result.log);
    this.trimLogs();

    await Promise.all([this.persistCards(), this.persistLogs()]);
    await this.notifyChanged();
    return result;
  }

  /**
   * Undo the last grading.
   *
   * Restores the card wholesale from a snapshot taken before it was graded, rather
   * than reconstructing it from the review log. The log records the memory state
   * either side of a grading but not the step, due date or lapse count, so
   * reconstructing would silently get those wrong — and an undo that leaves a card
   * subtly altered is worse than no undo, because nothing surfaces the damage.
   *
   * In-memory only: mis-tapping a grade is something you notice within seconds, so
   * the stack does not need to survive a relaunch, and persisting it would mean
   * writing a second copy of every card on every review.
   */
  async undoLastGrade(): Promise<boolean> {
    const previous = this.undoStack.pop();
    if (!previous) return false;

    const index = this.cards.findIndex((card) => card.id === previous.card.id);
    if (index === -1) return false;

    this.cards[index] = previous.card;
    this.logs = this.logs.filter((log) => log.id !== previous.logId);

    await Promise.all([this.persistCards(), this.persistLogs()]);
    await this.notifyChanged();
    return true;
  }

  /** Whether there is a grading to undo. */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Hide a card until the next study day.
   *
   * Distinct from suspending: burying is "not now", suspending is "not until I say
   * so". Memory state is untouched either way — neither is a judgement about
   * whether the word is known.
   */
  async setCardBuried(cardId: string, until?: Timestamp): Promise<void> {
    const index = this.cards.findIndex((card) => card.id === cardId);
    if (index === -1) return;

    const card = this.cards[index]!;
    const profile = this.getProfile(card.languageCode);
    const buriedUntil = until ?? endOfStudyDay(this.now(), profile.dayStartHour);

    this.cards[index] = { ...card, buriedUntil };
    await this.persistCards();
    await this.notifyChanged();
  }

  /** Every entry for a language — the candidate pool for answer distractors. */
  getEntries(code: LanguageCode = this.meta.activeLanguage): LexicalEntry[] {
    return [...this.entriesById.values()].filter((entry) => entry.languageCode === code);
  }

  async setCardSuspended(cardId: string, suspended: boolean): Promise<void> {
    const index = this.cards.findIndex((card) => card.id === cardId);
    if (index === -1) return;
    this.cards[index] = { ...this.cards[index]!, suspended };
    await this.persistCards();
    await this.notifyChanged();
  }

  // ---------------------------------------------------------------- triage

  /** Cards that are lapsing, failing, or already flagged as leeches. */
  getStrugglingCards(
    code: LanguageCode = this.meta.activeLanguage,
    options: { limit?: number; since?: Timestamp } = {},
  ): StrugglingCard[] {
    return findStrugglingCards({
      cards: this.getCardsInScope(code),
      entries: this.entriesById,
      logs: this.logs,
      leechThreshold: resolveSchedulerConfig(this.meta.schedulerConfig).leechThreshold,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.since !== undefined ? { since: options.since } : {}),
    });
  }

  /**
   * Start a card over.
   *
   * Back to new: no stability, no due date, no lapse count, no leech flag. For
   * the word that has been forgotten eight times and whose scheduling history is
   * now actively unhelpful — FSRS has learned it is hard and keeps the intervals
   * short, which is correct and is also why it will keep coming back forever.
   *
   * The review log is deliberately left intact. It is the record of what actually
   * happened, and retention statistics computed from it would be flattered by
   * deleting every failure the learner has just chosen to move past.
   */
  async resetCard(cardId: string): Promise<void> {
    const index = this.cards.findIndex((card) => card.id === cardId);
    if (index === -1) return;

    const card = this.cards[index]!;
    const entry = this.entriesById.get(card.entryId);
    if (!entry) return;

    this.cards[index] = {
      ...createCard(entry, card.kind, card.levelId, this.now()),
      // Kept from the old card: when the learner first met this word, and any
      // decision they have made about whether it should be in rotation.
      createdAt: card.createdAt,
      ...(card.suspended !== undefined ? { suspended: card.suspended } : {}),
    };

    await this.persistCards();
    await this.notifyChanged();
  }

  /**
   * Clear the leech flag without touching the schedule.
   *
   * "I have dealt with this" — the learner rewrote the note, or decided the word
   * is simply hard and they are fine with that. Without this the flag is
   * permanent, since lapses only ever increase, and the card is reported as a
   * problem for the rest of its life.
   */
  async clearLeech(cardId: string): Promise<void> {
    const index = this.cards.findIndex((card) => card.id === cardId);
    if (index === -1) return;

    const card = this.cards[index]!;
    if (!card.leech) return;

    // Lapses are reset alongside the flag, because the scheduler re-raises the
    // flag from the lapse count — leaving it would mean the flag came back on the
    // very next lapse and the button appeared to do nothing.
    this.cards[index] = { ...card, leech: false, lapses: 0 };
    await this.persistCards();
    await this.notifyChanged();
  }

  // ---------------------------------------------------------------- notes

  /**
   * Attach a learner's own note to a word.
   *
   * Written through the imported-entry layer, which already exists so that a
   * learner can correct a shipped definition — a memory hook is the same kind of
   * correction. That also means a note survives re-importing the word list, and
   * that `reset()` clears notes along with everything else, both of which are the
   * behaviour someone would expect from "my notes on my deck".
   */
  async setEntryNote(entryId: string, note: string): Promise<void> {
    const entry = this.entriesById.get(entryId);
    if (!entry) return;

    const trimmed = note.trim();
    if ((entry.mnemonic ?? '') === trimmed) return;

    const { mnemonic: _dropped, ...withoutNote } = entry;
    const updated: LexicalEntry = trimmed ? { ...entry, mnemonic: trimmed } : withoutNote;

    const existing = this.importedEntries.filter((candidate) => candidate.id !== entryId);
    this.importedEntries = [...existing, updated];
    this.reindexEntries();

    await writeJson(this.options.store, STORAGE_KEYS.entries, this.importedEntries);
    await this.notifyChanged();
  }

  // ---------------------------------------------------------------- stats

  /**
   * Words the deck holds inside the current level's scope.
   *
   * The denominator for every progress number the app shows. It is counted from
   * the entries themselves rather than from the cards, so a word that is in scope
   * but has generated no cards still counts against the total instead of silently
   * shrinking it.
   */
  getAvailableWordCount(code: LanguageCode = this.meta.activeLanguage): number {
    const scope = new Set(getLevelIdsInScope(this.getProfile(code).targetLevelId));
    return this.getEntries(code).filter((entry) => entry.levelIds.some((id) => scope.has(id))).length;
  }

  /**
   * Cards the current level actually asks for.
   *
   * The same `levelId` filter the queue applies, and every progress number has to
   * use it too. Statistics were computed over *all* cards for the language, which
   * included cards left behind by a level or track change — an entry with one
   * stranded, never-served `new` card can never satisfy "every card in review",
   * so "words known" sat at zero permanently while the learner cleared their
   * queue every day.
   */
  getCardsInScope(code: LanguageCode = this.meta.activeLanguage): Card[] {
    const scope = new Set(getLevelIdsInScope(this.getProfile(code).targetLevelId));
    return this.getAllCards(code).filter((card) => scope.has(card.levelId));
  }

  getStats(code: LanguageCode = this.meta.activeLanguage, now: Timestamp = this.now()) {
    const profile = this.getProfile(code);
    const cards = this.getCardsInScope(code);
    const trackLevels = getExamTrack(profile.examTrackId).levels;
    const level = trackLevels.find((candidate) => candidate.id === profile.targetLevelId);

    return {
      streak: computeStreak(this.logs, now, profile.dayStartHour),
      retention: computeRetention(this.logs, 30, now),
      retentionByKind: computeRetentionByKind(this.logs, { windowDays: 30, now }),
      coverage: computeCoverage(cards, {
        available: this.getAvailableWordCount(code),
        ...(level?.vocabularyTarget !== undefined ? { syllabusTarget: level.vocabularyTarget } : {}),
      }),
      forecast: forecastReviews(cards, now, 14, profile.dayStartHour),
      today: countTodaysWork(this.logs, now, profile.dayStartHour),
    };
  }

  getReadiness(code: LanguageCode = this.meta.activeLanguage, now: Timestamp = this.now()): ExamReadiness {
    return computeExamReadiness(
      this.getCardsInScope(code),
      this.getProfile(code),
      now,
      this.getAvailableWordCount(code),
    );
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
