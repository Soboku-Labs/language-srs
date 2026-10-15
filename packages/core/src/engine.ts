import { buildQuestion, type AnswerMode, type Question } from './answer';
import { createCard, generateCards } from './cards/factory';
import { summariseDeck, type DeckEntry } from './deck';
import { SEED_ENTRIES } from './data/seed';
import { findExamTrack, getExamTrack, getLevelIdsInScope } from './exams';
import { getJourney, type Journey } from './journey';
import { getDailyGoal, type DailyGoal } from './session/goal';
import { buildStudyQueue, countTodaysWork, type StudyQueue } from './session/queue';
import { DEFAULT_SCHEDULER_CONFIG, resolveSchedulerConfig, type SchedulerConfig } from './srs/params';
import { gradeCard } from './srs/scheduler';
import {
  groupLogsIntoSessions,
  summariseSessions,
  type SessionSummary,
  type StudySessionRecord,
} from './sessions';
import { mergeStudySessions as mergeSessionRecords } from './auth/sync';
import {
  computeCoverage,
  computeRetention,
  computeRetentionByKind,
  computeStreak,
  forecastReviews,
} from './stats/metrics';
import { computeExamReadiness, type ExamReadiness } from './stats/readiness';
import { readJson, writeJson, type KeyValueStore } from './storage/port';
import { findStrugglingCards, type StrugglingCard } from './triage';
import {
  DEFAULT_STUDY_PROFILE,
  type Card,
  type LexicalEntry,
  type StudyProfile,
  type Timestamp,
} from './types/card';
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
  /** Finished sittings, for the account and progress screens. */
  sessions: `${KEY_PREFIX}:sessions`,
  /** The flattened snapshot the native widget reads. Never read back by the app. */
  widget: `${KEY_PREFIX}:widget`,
} as const;

/**
 * Storage keys that make up an account's state.
 *
 * The widget snapshot is excluded on purpose: it is derived from the others and
 * regenerated on every state change, so syncing it would double the payload to
 * transfer something the receiving device is about to overwrite anyway.
 */
/**
 * How many gradings back you can undo.
 *
 * Deep enough to fix a mis-tap noticed a few cards later, shallow enough that it
 * cannot rewind a session.
 */
const MAX_UNDO_DEPTH = 10;

export const SYNCED_STORAGE_KEYS: string[] = [
  STORAGE_KEYS.meta,
  STORAGE_KEYS.cards,
  STORAGE_KEYS.logs,
  STORAGE_KEYS.entries,
  STORAGE_KEYS.sessions,
];

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
 * Cap on retained study sittings.
 *
 * One or two a day for years fits comfortably. Trimmed oldest-first like the
 * logs, and for the same reason: an account that syncs between devices should
 * not grow without bound on the smallest one.
 */
const MAX_RETAINED_SESSIONS = 5_000;

/**
 * How far ahead of the learner to make cards.
 *
 * Two hundred words is a fortnight of new material at the default of fifteen a
 * day, and the window slides forward as words are started — so there is always
 * more, and never ten thousand cards sitting in storage waiting to be synced.
 */
const ENTRY_WINDOW = 200;



interface EngineMeta {
  version: number;
  activeLanguage: LanguageCode;
  profiles: Partial<Record<LanguageCode, StudyProfile>>;
  schedulerConfig: Partial<SchedulerConfig>;
}

export interface StudyEngineOptions {
  store: KeyValueStore;
  /**
   * Vocabulary to start with.
   *
   * Defaults to the starter decks — about thirty words per language, bundled, so
   * a first launch with no network still has something to study. The real
   * syllabuses arrive from the API a level at a time and are handed over with
   * `setVocabulary`.
   *
   * Kept out of storage either way: it is the same on every device, and putting
   * it in the blob would mean syncing fourteen thousand words between two phones
   * that both already have them.
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
  private sessions: StudySessionRecord[];
  /**
   * Vocabulary handed in at runtime, from the API.
   *
   * Deliberately not persisted. It is public reference data that every device
   * can fetch and cache for itself; writing it into the account blob would sync
   * the syllabus between two phones that both already have it, and grow the
   * payload by a megabyte to say nothing new.
   */
  private vocabulary: LexicalEntry[] = [];
  /**
   * Cards as they were before their last grading, newest last.
   *
   * Deep enough to fix a mis-tap noticed a few cards later, shallow enough that
   * it cannot be used to rewind a session — which would turn undo into a way to
   * farm the streak.
   */
  private readonly undoStack: { card: Card; logId: string }[] = [];
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
      sessions: StudySessionRecord[];
    },
  ) {
    this.clock = options.clock ?? systemClock;
    this.meta = state.meta;
    this.cards = state.cards;
    this.logs = state.logs;
    this.importedEntries = state.importedEntries;
    this.pending = state.pending;
    this.sessions = state.sessions;
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
      sessions: await readJson<StudySessionRecord[]>(store, STORAGE_KEYS.sessions, []),
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

  /**
   * The store this engine was built on.
   *
   * Exposed so the app layer can keep its own bookkeeping — sync revisions, for
   * one — in the same namespace as the account's cards, and have it move,
   * persist and get cleared along with them. The domain does not read it.
   */
  get store(): KeyValueStore {
    return this.options.store;
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

  /**
   * Every known word in one language, as a list.
   *
   * The pool distractors are drawn from, which is why it is every entry rather
   * than only the ones in scope: a plausible wrong answer for an HSK 1 word is
   * often an HSK 2 word, and limiting the pool to the current level makes the
   * options easier than the exam's.
   */
  getEntries(code: LanguageCode = this.meta.activeLanguage): LexicalEntry[] {
    return [...this.entriesById.values()].filter((entry) => entry.languageCode === code);
  }

  getEntry(entryId: string): LexicalEntry | undefined {
    return this.entriesById.get(entryId);
  }

  get entries(): Map<string, LexicalEntry> {
    return this.entriesById;
  }

  /**
   * Supply the downloaded syllabus.
   *
   * Called by the app once the levels in scope have been fetched or read from
   * its cache. Replaces rather than merges, so a level going out of scope stops
   * generating cards — the cards already made for it keep their history, because
   * `syncCards` only ever adds.
   */
  async setVocabulary(entries: LexicalEntry[]): Promise<void> {
    this.vocabulary = entries;
    this.reindexEntries();
    await this.syncCards();
    await this.notifyChanged();
  }

  /** How many words the engine currently knows about, for the settings screen. */
  get vocabularySize(): number {
    return this.entriesById.size;
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
      const generated = generateCards(this.entriesInBudget(code, scope), scope, {
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

  /**
   * The words to have cards for right now.
   *
   * Levels used to hold thirty hand-written words, so generating a card for
   * every word in scope was free. They now hold five hundred, and HSK 6 has six
   * levels beneath it — three thousand words, ten thousand cards, several
   * megabytes of state to store and to sync, so that somebody can study fifteen
   * words a day.
   *
   * So cards are made for a *window* of the syllabus rather than all of it:
   * enough to always have new material, extended as the learner works through
   * it. Nothing is lost by waiting — a card that does not exist yet has no
   * memory state to keep — and the window is generous enough that a heavy day
   * cannot exhaust it.
   *
   * Order is the syllabus's own: level by level, most frequent word first, which
   * is the order anyone would choose to meet them in.
   */
  private entriesInBudget(code: LanguageCode, scope: string[]): LexicalEntry[] {
    const inScope = scope.flatMap((levelId) =>
      [...this.entriesById.values()]
        .filter((entry) => entry.languageCode === code && entry.levelIds.includes(levelId))
        .sort(
          (a, b) => (a.frequencyRank ?? Number.MAX_SAFE_INTEGER) - (b.frequencyRank ?? Number.MAX_SAFE_INTEGER),
        ),
    );

    const started = new Set(
      this.cards.filter((card) => card.languageCode === code && card.reps > 0).map((card) => card.entryId),
    );

    return inScope.slice(0, ENTRY_WINDOW + started.size);
  }

  // ---------------------------------------------------------------- studying

  /**
   * The queue, with each card already turned into a question.
   *
   * Mode, distractors and interval previews resolved here rather than by the
   * caller. A client assembling its own questions needs the entry pool, the
   * profile's retention and its exam date to do it, and will get one of the
   * three wrong — which shows up as the same card being asked differently on a
   * phone than on a laptop.
   */
  getQuestions(
    options: {
      code?: LanguageCode;
      sessionLimit?: number;
      now?: Timestamp;
      preferred?: AnswerMode;
    } = {},
  ): { questions: Question[]; queue: StudyQueue } {
    const code = options.code ?? this.meta.activeLanguage;
    const now = options.now ?? this.now();
    const queue = this.getQueue({ ...options, code, now });

    // Built once and shared: the pool is every entry in the language, and
    // rebuilding it per card would re-walk the whole deck for each question.
    const pool = this.getEntries(code);
    const profile = this.getProfile(code);

    return {
      queue,
      questions: queue.cards.map((pair) =>
        buildQuestion({
          pair,
          pool,
          profile,
          now,
          ...(options.preferred !== undefined ? { preferred: options.preferred } : {}),
        }),
      ),
    };
  }

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

    // Remembered before it is replaced, so a mis-tap can be taken back.
    this.undoStack.push({ card, logId: result.log.id });
    if (this.undoStack.length > MAX_UNDO_DEPTH) this.undoStack.shift();

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
      // Per skill as well as overall: 88% hides "comfortable recognising a word
      // and losing its tones", which is the part a learner can act on.
      retentionByKind: computeRetentionByKind(this.logs, { windowDays: 30, now }),
      coverage: computeCoverage(cards, level?.vocabularyTarget ?? 0),
      forecast: forecastReviews(cards, now, 14, profile.dayStartHour),
      today: countTodaysWork(this.logs, now, profile.dayStartHour),
    };
  }

  getReadiness(code: LanguageCode = this.meta.activeLanguage, now: Timestamp = this.now()): ExamReadiness {
    return computeExamReadiness(this.getAllCards(code), this.getProfile(code), now);
  }

  /**
   * What today asked for, and how much of it is left.
   *
   * Separate from the queue because the queue is a list and this is a finish
   * line. The target counts the work the day actually contains — what is done,
   * what is due, and the new cards still to come — and deliberately excludes
   * re-reps of learning cards, because a goal that grows every time you press
   * Again is a goal that recedes as you approach it.
   */
  getDailyGoal(code: LanguageCode = this.meta.activeLanguage, now: Timestamp = this.now()): DailyGoal {
    const profile = this.getProfile(code);
    return getDailyGoal({
      breakdown: this.getQueue({ code, now }).breakdown,
      done: countTodaysWork(this.logs, now, profile.dayStartHour),
    });
  }

  /**
   * Where the learner stands on their language's ladder.
   *
   * Derived from words known — every card in review at a week's stability or
   * better — so it moves when memory sticks and not when time is spent. An hour
   * of pressing Again earns nothing, which is the point: the rank means
   * something because it cannot be farmed.
   */
  getJourney(code: LanguageCode = this.meta.activeLanguage, now: Timestamp = this.now()): Journey {
    return getJourney(code, this.getStats(code, now).coverage.entriesKnown);
  }

  /**
   * The words that are fighting the learner.
   *
   * Lapsing, failing, or already flagged as a leech. Surfaced because the
   * alternative is a deck that quietly gets harder: a handful of words a learner
   * has forgotten eight times will keep returning forever, and FSRS is right to
   * keep showing them, which is exactly why somebody has to be told they can
   * reset or suspend them.
   */
  getStrugglingCards(
    code: LanguageCode = this.meta.activeLanguage,
    options: { limit?: number; since?: Timestamp } = {},
  ): StrugglingCard[] {
    return findStrugglingCards({
      cards: this.getAllCards(code),
      entries: this.entriesById,
      logs: this.logs,
      leechThreshold: resolveSchedulerConfig(this.meta.schedulerConfig).leechThreshold,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.since !== undefined ? { since: options.since } : {}),
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

  // ------------------------------------------------- undo, burying, rescue

  /**
   * Methods the deck and review screens act through.
   *
   * `undoLastGrade` exists because a mis-tap is a real event and the scheduler
   * treats a stray Again as evidence about memory. `resetCard` and `clearLeech`
   * are the two ways out for a word that has been forgotten so often that FSRS
   * has correctly learned it is hard and will keep returning it forever.
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

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

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

  getAvailableWordCount(code: LanguageCode = this.meta.activeLanguage): number {
    const scope = new Set(getLevelIdsInScope(this.getProfile(code).targetLevelId));
    return this.getEntries(code).filter((entry) => entry.levelIds.some((id) => scope.has(id))).length;
  }

  getDeck(code: LanguageCode = this.meta.activeLanguage, now: Timestamp = this.now()): DeckEntry[] {
    const profile = this.getProfile(code);
    return summariseDeck({
      entries: this.getEntries(code),
      cards: this.getAllCards(code),
      now,
      targetLevelId: profile.targetLevelId,
    });
  }

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

  // ---------------------------------------------------------------- sittings

  /** Every recorded sitting, oldest first. Optionally for one language. */
  getStudySessions(code?: LanguageCode): StudySessionRecord[] {
    return code ? this.sessions.filter((session) => session.languageCode === code) : [...this.sessions];
  }

  /**
   * Summarise sittings for the account and progress screens.
   *
   * Falls back to reconstructing sessions from review logs when nothing has been
   * recorded — which is every account upgrading from a version before sittings
   * existed, and any account whose only study has been on the widget.
   */
  getSessionSummary(
    options: { code?: LanguageCode; days?: number; now?: Timestamp; recentLimit?: number } = {},
  ): SessionSummary {
    const now = options.now ?? this.now();
    const profile = this.meta.profiles[options.code ?? this.meta.activeLanguage];
    const recorded = this.getStudySessions(options.code);

    const records = recorded.length > 0 ? recorded : this.deriveSessions(options.code);

    return summariseSessions(records, {
      now,
      ...(options.days !== undefined ? { days: options.days } : {}),
      ...(options.recentLimit !== undefined ? { recentLimit: options.recentLimit } : {}),
      dayStartHour: profile?.dayStartHour ?? 4,
    });
  }

  /** Store a finished sitting. Ignores one already recorded under this id. */
  async recordStudySession(record: StudySessionRecord): Promise<void> {
    if (this.sessions.some((session) => session.id === record.id)) return;
    this.sessions = mergeSessionRecords(this.sessions, [record]);
    this.trimSessions();
    await this.persistSessions();
    await this.notifyChanged();
  }

  /** Fold sittings from another device into this one's history. */
  async mergeStudySessions(incoming: StudySessionRecord[]): Promise<{ added: number }> {
    const before = this.sessions.length;
    this.sessions = mergeSessionRecords(this.sessions, incoming);
    this.trimSessions();
    await this.persistSessions();
    await this.notifyChanged();
    return { added: this.sessions.length - before };
  }

  private deriveSessions(code?: LanguageCode): StudySessionRecord[] {
    const cardsById = new Map(this.cards.map((card) => [card.id, card]));
    return groupLogsIntoSessions(this.logs, {
      languageOf: (log) => {
        const language = cardsById.get(log.cardId)?.languageCode;
        if (code && language !== code) return undefined;
        return language;
      },
    });
  }

  // ---------------------------------------------------------------- sync

  /**
   * The account state to upload.
   *
   * Read straight out of the store rather than re-serialised from memory, so
   * what is uploaded is exactly what is on disk — including any key written by a
   * newer version of the app than the one doing the reading.
   */
  async exportState(): Promise<Record<string, string>> {
    const values: Record<string, string> = {};
    for (const key of SYNCED_STORAGE_KEYS) {
      const raw = await this.options.store.get(key);
      if (raw !== null) values[key] = raw;
    }
    return values;
  }

  /**
   * Replace local state with a downloaded copy, then reload.
   *
   * Deliberately total: partial adoption would leave cards from one device with
   * the review logs of another, and the streak and retention figures computed
   * from that pair would be fiction. The caller decides whether adopting is the
   * right move — see `AccountState` on why this is last-writer-wins.
   */
  async importState(values: Record<string, string>): Promise<void> {
    for (const key of SYNCED_STORAGE_KEYS) {
      const value = values[key];
      if (value === undefined) await this.options.store.remove(key);
      else await this.options.store.set(key, value);
    }

    this.meta = await readJson<EngineMeta>(this.options.store, STORAGE_KEYS.meta, this.meta);
    this.cards = await readJson<Card[]>(this.options.store, STORAGE_KEYS.cards, []);
    this.logs = await readJson<import('./types/review').ReviewLog[]>(this.options.store, STORAGE_KEYS.logs, []);
    this.importedEntries = await readJson<LexicalEntry[]>(this.options.store, STORAGE_KEYS.entries, []);
    this.sessions = await readJson<StudySessionRecord[]>(this.options.store, STORAGE_KEYS.sessions, []);
    this.reindexEntries();

    await this.ensureProfile(this.meta.activeLanguage);
    await this.syncCards();
    await this.notifyChanged();
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
    const bySeedId = new Set((this.options.seedEntries ?? SEED_ENTRIES).map((entry) => entry.id));
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
    for (const entry of this.options.seedEntries ?? SEED_ENTRIES) this.entriesById.set(entry.id, entry);
    // Downloaded levels win over the starter deck: same words, better data.
    for (const entry of this.vocabulary) this.entriesById.set(entry.id, entry);
    // Imported entries win, so a learner can correct a shipped definition.
    for (const entry of this.importedEntries) this.entriesById.set(entry.id, entry);
  }

  private trimLogs(): void {
    if (this.logs.length <= MAX_RETAINED_LOGS) return;
    this.logs = this.logs.slice(this.logs.length - MAX_RETAINED_LOGS);
  }

  private trimSessions(): void {
    if (this.sessions.length <= MAX_RETAINED_SESSIONS) return;
    this.sessions = this.sessions.slice(this.sessions.length - MAX_RETAINED_SESSIONS);
  }

  private async persistSessions(): Promise<void> {
    await writeJson(this.options.store, STORAGE_KEYS.sessions, this.sessions);
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
    this.sessions = [];
    this.meta = { version: STORAGE_VERSION, activeLanguage: 'zh', profiles: {}, schedulerConfig: {} };
    this.reindexEntries();

    await Promise.all(Object.values(STORAGE_KEYS).map((key) => this.options.store.remove(key)));
    await this.ensureProfile('zh');
    await this.syncCards();
    await this.notifyChanged();
  }
}
