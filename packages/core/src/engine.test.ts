import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS, StudyEngine } from './engine';
import { SEED_ENTRIES } from './data/seed';
import { getLanguageTheme } from './theme/palettes';
import { WIDGET_SCHEMA_VERSION } from './widget/payload';
import { MemoryStore, PrefixedStore, accountPrefix } from './storage/port';
import { computeStreak } from './stats/metrics';
import { computeExamReadiness, suggestDailyNewLimit } from './stats/readiness';
import { DEFAULT_STUDY_PROFILE, type StudyProfile } from './types/card';
import type { ReviewLog } from './types/review';
import { addDays, fixedClock } from './utils/date';
import { generateCards } from './cards/factory';
import { makeEntry } from './data/helpers';
import { getLevelIdsInScope } from './exams';
import { MANDARIN_SEED } from './data/seed/mandarin';

const NOW = '2026-03-01T09:00:00.000Z';

async function makeEngine(now = NOW) {
  const store = new MemoryStore();
  const engine = await StudyEngine.create({
    store,
    seedEntries: SEED_ENTRIES,
    clock: fixedClock(now),
  });
  return { engine, store };
}



describe('engine lifecycle', () => {
  it('creates a default profile and cards on first run', async () => {
    const { engine } = await makeEngine();
    const profile = engine.getProfile();

    expect(profile.languageCode).toBe('zh');
    expect(profile.examTrackId).toBe('hsk3');
    expect(profile.targetLevelId).toBe('hsk3-1');
    expect(engine.getAllCards('zh').length).toBeGreaterThan(0);
  });

  it('persists state across restarts', async () => {
    const { engine, store } = await makeEngine();
    const card = engine.getQueue().cards[0]!.card;
    await engine.grade(card.id, 3);

    const reopened = await StudyEngine.create({ store, seedEntries: SEED_ENTRIES, clock: fixedClock(NOW) });
    const persisted = reopened.getAllCards('zh').find((candidate) => candidate.id === card.id)!;
    expect(persisted.reps).toBe(1);
  });

  it('survives corrupt stored data instead of failing to launch', async () => {
    const store = new MemoryStore();
    await store.set('srs:v1:cards', 'not json at all');
    const engine = await StudyEngine.create({ store, seedEntries: SEED_ENTRIES, clock: fixedClock(NOW) });
    expect(engine.getAllCards('zh').length).toBeGreaterThan(0);
  });

  it('creates profiles on demand for other languages', async () => {
    const { engine } = await makeEngine();
    expect(engine.hasProfile('vi')).toBe(false);

    await engine.setActiveLanguage('vi');
    expect(engine.activeLanguage).toBe('vi');
    expect(engine.getProfile('vi').examTrackId).toBe('vsl');
    expect(engine.getAllCards('vi').length).toBeGreaterThan(0);
    expect(engine.studiedLanguages).toEqual(['zh', 'vi']);
  });

  it('resets everything back to a clean first run', async () => {
    const { engine } = await makeEngine();
    await engine.grade(engine.getQueue().cards[0]!.card.id, 3);
    await engine.reset();

    expect(engine.getAllCards('zh').every((card) => card.state === 'new')).toBe(true);
    expect(engine.getStats().streak.current).toBe(0);
  });
});

describe('grading through the engine', () => {
  it('advances the card and records a log', async () => {
    const { engine } = await makeEngine();
    const card = engine.getQueue().cards[0]!.card;

    const result = await engine.grade(card.id, 3, { durationMs: 2500 });
    expect(result.card.state).toBe('learning');
    expect(result.log.durationMs).toBe(2500);
    expect(engine.getStats().today.newCards).toBe(1);
  });

  it('refuses an unknown card id', async () => {
    const { engine } = await makeEngine();
    await expect(engine.grade('nope', 3)).rejects.toThrow(/Unknown card/);
  });

  it('applies the profile retention to scheduling', async () => {
    const { engine } = await makeEngine();
    await engine.updateProfile('zh', { desiredRetention: 0.97 });

    const card = engine.getQueue().cards[0]!.card;
    const result = await engine.grade(card.id, 4);
    // A 97% retention target must not produce a longer interval than 90% would.
    expect(result.card.scheduledDays).toBeLessThanOrEqual(15);
  });

  it('notifies on state change, which is how the widget stays current', async () => {
    const store = new MemoryStore();
    let notifications = 0;
    const engine = await StudyEngine.create({
      store,
      seedEntries: SEED_ENTRIES,
      clock: fixedClock(NOW),
      onStateChanged: () => {
        notifications += 1;
      },
    });

    await engine.grade(engine.getQueue().cards[0]!.card.id, 3);
    expect(notifications).toBeGreaterThan(0);
  });
});

describe('changing level and track', () => {
  it('adds cards for newly in-scope levels without touching existing history', async () => {
    const { engine } = await makeEngine();
    const card = engine.getQueue().cards[0]!.card;
    await engine.grade(card.id, 3);

    const before = engine.getAllCards('zh').length;
    await engine.updateProfile('zh', { targetLevelId: 'hsk3-2' });

    expect(engine.getAllCards('zh').length).toBeGreaterThan(before);
    expect(engine.getAllCards('zh').find((candidate) => candidate.id === card.id)!.reps).toBe(1);
  });

  it('keeps history when the level is lowered again, and stops serving those cards', async () => {
    const { engine } = await makeEngine();
    await engine.updateProfile('zh', { targetLevelId: 'hsk3-2' });
    const higher = engine.getAllCards('zh').find((card) => card.levelId === 'hsk3-2')!;
    await engine.grade(higher.id, 3);

    await engine.updateProfile('zh', { targetLevelId: 'hsk3-1' });

    expect(engine.getAllCards('zh').find((card) => card.id === higher.id)!.reps).toBe(1);
    expect(engine.getQueue().cards.some(({ card }) => card.levelId === 'hsk3-2')).toBe(false);
  });

  it('switches HSK track while holding the level position', async () => {
    const { engine } = await makeEngine();
    await engine.updateProfile('zh', { targetLevelId: 'hsk3-3' });
    await engine.setExamTrack('zh', 'hsk2');

    expect(engine.getProfile('zh').examTrackId).toBe('hsk2');
    expect(engine.getProfile('zh').targetLevelId).toBe('hsk2-3');
  });

  it('refuses a track from the wrong language', async () => {
    const { engine } = await makeEngine();
    await expect(engine.setExamTrack('zh', 'jlpt')).rejects.toThrow(/is for ja/);
  });
});

describe('importing vocabulary', () => {
  it('adds entries and generates cards for them', async () => {
    const { engine } = await makeEngine();
    const before = engine.getAllCards('zh').length;

    const result = await engine.importEntries([
      {
        id: 'zh-custom-mao',
        languageCode: 'zh',
        target: '猫',
        reading: 'māo',
        meanings: ['cat'],
        levelIds: ['hsk3-1'],
        examples: [{ target: '我有一只猫。', translation: 'I have a cat.' }],
        tags: ['animal'],
        tones: [1],
      },
    ]);

    expect(result.added).toBe(1);
    expect(engine.getAllCards('zh').length).toBeGreaterThan(before);
    expect(engine.getEntry('zh-custom-mao')?.meanings).toEqual(['cat']);
  });

  it('lets an imported entry override a shipped one', async () => {
    const { engine } = await makeEngine();
    const result = await engine.importEntries([
      { ...MANDARIN_SEED[0]!, meanings: ['my own gloss'] },
    ]);

    expect(result.replaced).toBe(1);
    expect(engine.getEntry(MANDARIN_SEED[0]!.id)?.meanings).toEqual(['my own gloss']);
  });
});

describe('widget integration', () => {
  it('produces a serialisable snapshot for the shared container', async () => {
    const { engine } = await makeEngine();
    const payload = engine.serialiseWidgetPayload();
    const parsed = JSON.parse(payload);

    expect(parsed.schemaVersion).toBe(WIDGET_SCHEMA_VERSION);
    expect(parsed.language.code).toBe('zh');
    expect(parsed.nextCard.options).toHaveLength(4);
    // The widget renders the active language's palette, so it has to travel too.
    expect(parsed.theme.background).toBe(getLanguageTheme('zh').colors.background);
    expect(parsed.theme.gradeColors).toHaveLength(4);
  });

  it('replays a widget grading on the next launch', async () => {
    const { engine, store } = await makeEngine();
    const card = engine.getQueue().cards[0]!.card;

    await engine.enqueueWidgetGrade({ cardId: card.id, rating: 3, gradedAt: NOW });

    const reopened = await StudyEngine.create({ store, seedEntries: SEED_ENTRIES, clock: fixedClock(NOW) });
    const replayed = reopened.getAllCards('zh').find((candidate) => candidate.id === card.id)!;

    expect(replayed.reps).toBe(1);
    expect(reopened.getStats().today.newCards).toBe(1);
  });

  it('clears the pending queue after replaying it', async () => {
    const { engine, store } = await makeEngine();
    const card = engine.getQueue().cards[0]!.card;
    await engine.enqueueWidgetGrade({ cardId: card.id, rating: 3, gradedAt: NOW });

    const reopened = await StudyEngine.create({ store, seedEntries: SEED_ENTRIES, clock: fixedClock(NOW) });
    expect(await reopened.applyPendingWidgetGrades()).toEqual({ applied: 0, skipped: 0 });
  });

  it('builds a timeline whose later entries reflect future due counts', async () => {
    const { engine } = await makeEngine();
    const timeline = engine.getWidgetTimeline();
    expect(timeline.entries.length).toBeGreaterThan(1);
    expect(Date.parse(timeline.refreshAfter)).toBeGreaterThan(Date.parse(NOW));
  });
});

describe('streaks', () => {
  const log = (reviewedAt: string): ReviewLog => ({
    id: `r-${reviewedAt}`,
    cardId: 'c1',
    entryId: 'e1',
    reviewedAt,
    rating: 3,
    stateBefore: 'review',
    stateAfter: 'review',
    stabilityBefore: 5,
    stabilityAfter: 8,
    difficultyBefore: 5,
    difficultyAfter: 5,
    elapsedDays: 1,
    scheduledDays: 8,
    predictedRetrievability: 0.9,
    durationMs: 1000,
    source: 'app',
  });

  it('counts consecutive days', () => {
    const logs = [-2, -1, 0].map((offset) => log(addDays(NOW, offset)));
    const streak = computeStreak(logs, NOW);
    expect(streak.current).toBe(3);
    expect(streak.studiedToday).toBe(true);
  });

  it('holds yesterday\'s streak until today has fully elapsed', () => {
    const logs = [-2, -1].map((offset) => log(addDays(NOW, offset)));
    const streak = computeStreak(logs, NOW);
    expect(streak.current).toBe(2);
    expect(streak.studiedToday).toBe(false);
  });

  it('breaks after a missed day', () => {
    const logs = [log(addDays(NOW, -5)), log(addDays(NOW, -4))];
    expect(computeStreak(logs, NOW).current).toBe(0);
  });

  it('remembers the longest run even after it breaks', () => {
    const logs = [-10, -9, -8, -7, -3].map((offset) => log(addDays(NOW, offset)));
    const streak = computeStreak(logs, NOW);
    expect(streak.longest).toBe(4);
    expect(streak.current).toBe(0);
  });

  it('reports nothing for an empty history', () => {
    expect(computeStreak([], NOW)).toMatchObject({ current: 0, longest: 0, totalDays: 0 });
  });
});

describe('exam readiness', () => {
  const profile = (overrides: Partial<StudyProfile> = {}): StudyProfile => ({
    ...DEFAULT_STUDY_PROFILE,
    languageCode: 'zh',
    examTrackId: 'hsk3',
    targetLevelId: 'hsk3-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  const cards = generateCards(MANDARIN_SEED, ['hsk3-1'], { now: NOW });

  it('asks for an exam date before claiming to measure readiness', () => {
    const readiness = computeExamReadiness(cards, profile(), NOW);
    expect(readiness.verdict).toBe('no-exam-set');
    expect(readiness.headline).toMatch(/Set an exam date/);
  });

  it('reports not-started when nothing has been studied', () => {
    const readiness = computeExamReadiness(cards, profile({ examDate: '2026-06-01' }), NOW);
    expect(readiness.verdict).toBe('not-started');
    expect(readiness.score).toBe(0);
  });

  it('calls out an insufficient daily pace', () => {
    const studied = cards.map((card) => ({
      ...card,
      state: 'review' as const,
      stability: 30,
      difficulty: 5,
      reps: 3,
      lastReviewedAt: NOW,
    }));
    // 500 words to cover, 10 days, 5 new a day: not going to happen.
    const readiness = computeExamReadiness(studied, profile({ examDate: '2026-03-11', dailyNewLimit: 5 }), NOW);
    expect(readiness.paceIsSufficient).toBe(false);
    expect(readiness.verdict).toBe('behind');
    expect(readiness.headline).toMatch(/new words a day/);
  });

  it('decays as the exam gets further away, because it assumes no more study', () => {
    const studied = cards.map((card) => ({
      ...card,
      state: 'review' as const,
      stability: 20,
      difficulty: 5,
      reps: 3,
      lastReviewedAt: NOW,
    }));

    const soon = computeExamReadiness(studied, profile({ examDate: '2026-03-08' }), NOW);
    const later = computeExamReadiness(studied, profile({ examDate: '2026-09-01' }), NOW);
    expect(later.projectedRecall).toBeLessThan(soon.projectedRecall);
  });

  it('reports a passed exam rather than a stale countdown', () => {
    const readiness = computeExamReadiness(cards, profile({ examDate: '2026-02-01' }), NOW);
    expect(readiness.verdict).toBe('exam-passed');
    expect(readiness.daysToExam).toBeLessThan(0);
  });

  it('suggests a daily new-card limit from the level delta and the time left', () => {
    // JLPT N5 is ~800 words; 100 days should ask for roughly 9-10 a day.
    const suggested = suggestDailyNewLimit('jlpt-n5', NOW, '2026-06-09');
    expect(suggested).toBeGreaterThan(7);
    expect(suggested).toBeLessThan(12);
  });

  it('never suggests fewer than one a day', () => {
    expect(suggestDailyNewLimit('jlpt-n1', NOW, '2026-03-02')).toBeGreaterThanOrEqual(1);
  });
});

describe('study sittings', () => {
  it('records a finished sitting and reads it back', async () => {
    const { engine } = await makeEngine();

    await engine.recordStudySession({
      id: 's1',
      languageCode: 'zh',
      startedAt: NOW,
      endedAt: NOW,
      reviewed: 12,
      recalled: 10,
      activeMs: 300_000,
    });

    expect(engine.getStudySessions()).toHaveLength(1);
    expect(engine.getSessionSummary().reviewed).toBe(12);
  });

  it('ignores a sitting already recorded, so a retried sync cannot double it', async () => {
    const { engine } = await makeEngine();
    const record = {
      id: 's1',
      languageCode: 'zh' as const,
      startedAt: NOW,
      endedAt: NOW,
      reviewed: 3,
      recalled: 3,
      activeMs: 1_000,
    };

    await engine.recordStudySession(record);
    await engine.recordStudySession({ ...record, reviewed: 99 });

    expect(engine.getStudySessions()).toHaveLength(1);
    expect(engine.getStudySessions()[0]?.reviewed).toBe(3);
  });

  it('keeps sittings per language', async () => {
    const { engine } = await makeEngine();
    await engine.setActiveLanguage('ja');
    await engine.recordStudySession({
      id: 's-ja',
      languageCode: 'ja',
      startedAt: NOW,
      endedAt: NOW,
      reviewed: 4,
      recalled: 4,
      activeMs: 1_000,
    });

    expect(engine.getStudySessions('ja')).toHaveLength(1);
    expect(engine.getStudySessions('zh')).toHaveLength(0);
  });

  /**
   * The upgrade path. An account that studied before sittings existed still has
   * its review logs, and a progress screen that showed "no sessions yet" to
   * somebody with a 40-day streak would be wrong in the most discouraging way.
   */
  it('reconstructs sittings from review logs when none were recorded', async () => {
    const { engine } = await makeEngine();
    const cards = engine.getQueue().cards.slice(0, 3);
    for (const pair of cards) await engine.grade(pair.card.id, 3, { durationMs: 3_000 });

    expect(engine.getStudySessions()).toHaveLength(0);

    const summary = engine.getSessionSummary();
    expect(summary.sessions).toBe(1);
    expect(summary.reviewed).toBe(3);
    expect(summary.recent[0]?.derived).toBe(true);
  });

  it('prefers recorded sittings over reconstructed ones once there are any', async () => {
    const { engine } = await makeEngine();
    const pair = engine.getQueue().cards[0]!;
    await engine.grade(pair.card.id, 3, { durationMs: 3_000 });
    await engine.recordStudySession({
      id: 's1',
      languageCode: 'zh',
      startedAt: NOW,
      endedAt: NOW,
      reviewed: 1,
      recalled: 1,
      activeMs: 3_000,
    });

    expect(engine.getSessionSummary().recent.every((session) => !session.derived)).toBe(true);
  });

  it('merges sittings from another device without duplicating its own', async () => {
    const { engine } = await makeEngine();
    const mine = {
      id: 's-phone',
      languageCode: 'zh' as const,
      startedAt: NOW,
      endedAt: NOW,
      reviewed: 5,
      recalled: 5,
      activeMs: 1_000,
    };
    await engine.recordStudySession(mine);

    const result = await engine.mergeStudySessions([mine, { ...mine, id: 's-laptop' }]);

    expect(result.added).toBe(1);
    expect(engine.getStudySessions()).toHaveLength(2);
  });

  it('clears sittings on reset, like everything else', async () => {
    const { engine } = await makeEngine();
    await engine.recordStudySession({
      id: 's1',
      languageCode: 'zh',
      startedAt: NOW,
      endedAt: NOW,
      reviewed: 1,
      recalled: 1,
      activeMs: 1,
    });

    await engine.reset();
    expect(engine.getStudySessions()).toHaveLength(0);
  });
});

describe('account sync', () => {
  it('exports exactly the keys that make up an account', async () => {
    const { engine } = await makeEngine();
    const state = await engine.exportState();

    expect(Object.keys(state)).toEqual(expect.arrayContaining([STORAGE_KEYS.meta, STORAGE_KEYS.cards]));
    // Derived from the rest and rewritten on every change; sending it would be
    // paying to transfer something the other device overwrites on arrival.
    expect(state[STORAGE_KEYS.widget]).toBeUndefined();
  });

  it('carries a full account across devices', async () => {
    const source = await makeEngine();
    const pair = source.engine.getQueue().cards[0]!;
    await source.engine.grade(pair.card.id, 3, { durationMs: 2_000 });
    await source.engine.setActiveLanguage('ko');
    await source.engine.recordStudySession({
      id: 's1',
      languageCode: 'ko',
      startedAt: NOW,
      endedAt: NOW,
      reviewed: 7,
      recalled: 6,
      activeMs: 60_000,
    });

    const target = await makeEngine();
    await target.engine.importState(await source.engine.exportState());

    expect(target.engine.activeLanguage).toBe('ko');
    expect(target.engine.getStudySessions()).toHaveLength(1);
    expect(target.engine.getAllCards('zh').find((card) => card.id === pair.card.id)?.reps).toBe(1);
  });

  it('leaves the adopted state on disk, not just in memory', async () => {
    const source = await makeEngine();
    await source.engine.setActiveLanguage('vi');

    const target = await makeEngine();
    await target.engine.importState(await source.engine.exportState());

    const reopened = await StudyEngine.create({
      store: target.store,
      seedEntries: SEED_ENTRIES,
      clock: fixedClock(NOW),
    });
    expect(reopened.activeLanguage).toBe('vi');
  });

  /**
   * Adopting a state that has no record of a key must clear the local one.
   * Leaving it behind is how a device ends up with one account's cards and
   * another's review logs, and every figure computed from that pair is fiction.
   */
  it('clears local keys the incoming state does not have', async () => {
    const { engine, store } = await makeEngine();
    await engine.importEntries([
      { ...SEED_ENTRIES[0]!, id: 'zh-custom', target: '自定义' },
    ]);
    expect(await store.get(STORAGE_KEYS.entries)).not.toBeNull();

    await engine.importState({ [STORAGE_KEYS.meta]: (await store.get(STORAGE_KEYS.meta))! });
    expect(await store.get(STORAGE_KEYS.entries)).toBeNull();
  });
});

describe('per-account storage', () => {
  it('keeps two accounts on one device completely apart', async () => {
    const device = new MemoryStore();

    const first = await StudyEngine.create({
      store: new PrefixedStore(device, accountPrefix('user-1')),
      seedEntries: SEED_ENTRIES,
      clock: fixedClock(NOW),
    });
    await first.setActiveLanguage('ja');
    await first.grade(first.getQueue().cards[0]!.card.id, 3, {});

    const second = await StudyEngine.create({
      store: new PrefixedStore(device, accountPrefix('user-2')),
      seedEntries: SEED_ENTRIES,
      clock: fixedClock(NOW),
    });

    expect(second.activeLanguage).toBe('zh');
    expect(second.getAllCards('ja').every((card) => card.reps === 0)).toBe(true);
    expect(first.activeLanguage).toBe('ja');
  });

  /**
   * The signed-out learner writes where the app always wrote, so anyone who
   * studied before accounts existed finds their cards where they left them.
   */
  it('leaves signed-out storage exactly where it was', async () => {
    const device = new MemoryStore();
    const guest = await StudyEngine.create({
      store: new PrefixedStore(device, accountPrefix()),
      seedEntries: SEED_ENTRIES,
      clock: fixedClock(NOW),
    });
    await guest.setActiveLanguage('vi');

    expect(await device.get(STORAGE_KEYS.meta)).not.toBeNull();
  });

  it('lists only its own namespace', async () => {
    const device = new MemoryStore();
    await device.set('acct:user-1:srs:v1:meta', '{}');
    await device.set('acct:user-2:srs:v1:meta', '{}');

    const scoped = new PrefixedStore(device, accountPrefix('user-1'));
    expect(await scoped.keys()).toEqual(['srs:v1:meta']);
  });
});

/**
 * A level's worth of generated words.
 *
 * The window tests used to lean on the bundled datasets. Those now live on the
 * server, and a domain test reaching for a file the domain no longer ships would
 * be testing the wrong layer — so the fixture states its own shape: five hundred
 * words a level, ranked by frequency, exactly as the API serves them.
 */
function levelVocabulary(levelId: string, code: 'zh' = 'zh', size = 500) {
  return Array.from({ length: size }, (_, index) =>
    makeEntry({
      id: `${levelId}-${index}`,
      lang: code,
      target: `词${levelId}${index}`,
      reading: `ci${index}`,
      meanings: [`word ${index}`],
      levels: [levelId],
      tones: [2],
      rank: index + 1,
    }),
  );
}

describe('the card window', () => {
  /**
   * Levels hold five hundred words now rather than thirty, and HSK 6 has five
   * levels beneath it. Generating a card for every word in scope would put ten
   * thousand cards into storage — and into every sync — so that somebody can
   * study fifteen a day.
   */
  it('makes cards for a window of the syllabus rather than all of it', async () => {
    const { engine } = await makeEngine();
    const inScope = getLevelIdsInScope('hsk3-6').flatMap((levelId) => levelVocabulary(levelId));

    await engine.setVocabulary(inScope);
    await engine.updateProfile('zh', { targetLevelId: 'hsk3-6' });

    const entriesWithCards = new Set(engine.getAllCards('zh').map((card) => card.entryId));

    expect(inScope.length).toBeGreaterThan(2_000);
    expect(entriesWithCards.size).toBeLessThan(inScope.length);
    expect(entriesWithCards.size).toBeGreaterThan(100);
  });

  it('starts at the front of the syllabus, most frequent word first', async () => {
    const { engine } = await makeEngine();
    const level = levelVocabulary('hsk3-1');
    await engine.setVocabulary(level);

    const entryIds = new Set(engine.getAllCards('zh').map((card) => card.entryId));
    expect(entryIds.has(level[0]!.id)).toBe(true);
    expect(entryIds.has(level[level.length - 1]!.id)).toBe(false);
  });

  /**
   * The window has to move, or a learner who works through it finds the app
   * empty with four hundred words of the level left unstudied.
   */
  it('extends as words are studied', async () => {
    const { engine } = await makeEngine();
    await engine.setVocabulary(levelVocabulary('hsk3-1'));
    const before = new Set(engine.getAllCards('zh').map((card) => card.entryId)).size;

    for (const pair of engine.getQueue({ sessionLimit: 40 }).cards.slice(0, 30)) {
      await engine.grade(pair.card.id, 3, {});
    }
    await engine.syncCards();

    const after = new Set(engine.getAllCards('zh').map((card) => card.entryId)).size;
    expect(after).toBeGreaterThan(before);
  });

  /**
   * The starter deck is what a first launch studies from while the real
   * syllabus is still downloading, so it has to produce a usable queue on its
   * own.
   */
  it('has something to study before any vocabulary has been downloaded', async () => {
    const { engine } = await makeEngine();
    expect(engine.getQueue().cards.length).toBeGreaterThan(0);
  });

  it('replaces the starter deck with the downloaded level, keeping history', async () => {
    const { engine } = await makeEngine();
    const pair = engine.getQueue().cards[0]!;
    await engine.grade(pair.card.id, 3, {});

    await engine.setVocabulary(levelVocabulary('hsk3-1'));

    // The graded card survives the swap: cards are keyed by entry, and
    // `syncCards` only ever adds.
    expect(engine.getAllCards('zh').find((card) => card.id === pair.card.id)?.reps).toBe(1);
    expect(engine.getQueue().cards.length).toBeGreaterThan(0);
  });
});

describe('grammar progress', () => {
  it('records a point as understood, and persists it', async () => {
    const { engine, store } = await makeEngine();
    expect(engine.isGrammarLearned('zh-shi')).toBe(false);

    await engine.setGrammarLearned('zh-shi', true);
    expect(engine.isGrammarLearned('zh-shi')).toBe(true);
    expect(engine.grammarLearnedAt('zh-shi')).toBe(NOW);

    const reopened = await StudyEngine.create({ store, seedEntries: SEED_ENTRIES, clock: fixedClock(NOW) });
    expect(reopened.isGrammarLearned('zh-shi')).toBe(true);
  });

  it('takes the mark off again', async () => {
    const { engine } = await makeEngine();
    await engine.setGrammarLearned('zh-le', true);
    await engine.setGrammarLearned('zh-le', false);

    expect(engine.isGrammarLearned('zh-le')).toBe(false);
    expect(engine.grammarLearnedAt('zh-le')).toBeUndefined();
  });

  it('counts how many of a syllabus is done', async () => {
    const { engine } = await makeEngine();
    await engine.setGrammarLearned('zh-shi', true);
    await engine.setGrammarLearned('zh-ma', true);

    expect(engine.countGrammarLearned(['zh-shi', 'zh-ma', 'zh-le'])).toBe(2);
    expect(engine.countGrammarLearned([])).toBe(0);
  });

  it('travels with the account rather than staying on one device', async () => {
    // The point of putting it in the synced keys: a point read on the laptop is
    // not re-read on the phone.
    const laptop = await makeEngine();
    await laptop.engine.setGrammarLearned('zh-hen-adj', true);

    const phone = await makeEngine();
    expect(phone.engine.isGrammarLearned('zh-hen-adj')).toBe(false);

    await phone.engine.importState(await laptop.engine.exportState());

    // In memory, not merely in the store — importState reloads every field, and
    // one left out would keep answering with the old value until a relaunch.
    expect(phone.engine.isGrammarLearned('zh-hen-adj')).toBe(true);
  });
});
