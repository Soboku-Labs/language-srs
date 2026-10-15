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

describe('grammar practice, spaced', () => {
  it('falls due immediately after reading, since reading is not the test', async () => {
    const { engine } = await makeEngine();
    await engine.setGrammarLearned('zh-shi', true);

    expect(engine.grammarDue('zh-shi')).toBe(NOW);
    expect(engine.grammarDueNow(['zh-shi', 'zh-ma'])).toEqual(['zh-shi']);
  });

  it('widens the interval with each clean sitting', async () => {
    const { engine } = await makeEngine();
    await engine.setGrammarLearned('zh-shi', true);

    await engine.recordGrammarPractice('zh-shi', true);
    expect(engine.grammarStreak('zh-shi')).toBe(1);
    const first = engine.grammarDue('zh-shi')!;

    await engine.recordGrammarPractice('zh-shi', true);
    expect(engine.grammarStreak('zh-shi')).toBe(2);
    // Each rung is further out than the one before it.
    expect(engine.grammarDue('zh-shi')!.localeCompare(first)).toBeGreaterThan(0);
  });

  it('drops a failed point to the bottom rather than down one rung', async () => {
    const { engine } = await makeEngine();
    await engine.setGrammarLearned('zh-shi', true);
    await engine.recordGrammarPractice('zh-shi', true);
    await engine.recordGrammarPractice('zh-shi', true);
    expect(engine.grammarStreak('zh-shi')).toBe(2);

    await engine.recordGrammarPractice('zh-shi', false);
    // Getting a rule wrong means the understanding was not there, which is not
    // the same as having forgotten it.
    expect(engine.grammarStreak('zh-shi')).toBe(0);
    expect(engine.grammarDue('zh-shi')).toBe(addDays(NOW, 1));
  });

  it('keeps a point out of the queue until it is due again', async () => {
    const { engine } = await makeEngine();
    await engine.setGrammarLearned('zh-shi', true);
    await engine.recordGrammarPractice('zh-shi', true);

    // The bottom rung, one day, is where a *failed* point lands; a clean
    // sitting goes straight to the second, three days out.
    expect(engine.grammarDue('zh-shi')).toBe(addDays(NOW, 3));
    expect(engine.grammarDueNow(['zh-shi'])).toEqual([]);
    expect(engine.grammarDueNow(['zh-shi'], addDays(NOW, 2))).toEqual([]);
    expect(engine.grammarDueNow(['zh-shi'], addDays(NOW, 3))).toEqual(['zh-shi']);
  });

  it('reads forward progress stored before practice was scheduled', async () => {
    // The first version kept a bare timestamp per point. Those are real
    // progress on somebody's device, so they are migrated rather than dropped.
    const store = new MemoryStore();
    await store.set(STORAGE_KEYS.grammar, JSON.stringify({ 'zh-shi': '2026-02-01T09:00:00.000Z' }));

    const engine = await StudyEngine.create({ store, seedEntries: SEED_ENTRIES, clock: fixedClock(NOW) });

    expect(engine.isGrammarLearned('zh-shi')).toBe(true);
    expect(engine.grammarLearnedAt('zh-shi')).toBe('2026-02-01T09:00:00.000Z');
    // Read and never practised, so it is due now.
    expect(engine.grammarDueNow(['zh-shi'])).toEqual(['zh-shi']);
  });

  it('ignores a corrupt record rather than failing to open', async () => {
    const store = new MemoryStore();
    await store.set(STORAGE_KEYS.grammar, JSON.stringify({ 'zh-shi': { nonsense: true }, 'zh-ma': null }));

    const engine = await StudyEngine.create({ store, seedEntries: SEED_ENTRIES, clock: fixedClock(NOW) });
    expect(engine.isGrammarLearned('zh-shi')).toBe(false);
    expect(engine.isGrammarLearned('zh-ma')).toBe(false);
  });
});

describe('how alive the background is', () => {
  it('is calm until somebody says otherwise', async () => {
    const { engine } = await makeEngine();
    expect(engine.backdrop).toBe('calm');
  });

  it('remembers the choice, and carries it to the account', async () => {
    const { engine, store } = await makeEngine();
    await engine.setBackdrop('living');
    expect(engine.backdrop).toBe('living');

    const reopened = await StudyEngine.create({ store, seedEntries: SEED_ENTRIES, clock: fixedClock(NOW) });
    expect(reopened.backdrop).toBe('living');

    // It lives on meta, which is a synced key — a preference about motion is
    // about the person, not the browser.
    const phone = await makeEngine();
    await phone.engine.importState(await engine.exportState());
    expect(phone.engine.backdrop).toBe('living');
  });

  it('can be set back', async () => {
    const { engine } = await makeEngine();
    await engine.setBackdrop('living');
    await engine.setBackdrop('calm');
    expect(engine.backdrop).toBe('calm');
  });
});

/**
 * One study day, for the whole account.
 *
 * This moved off the per-language profile, where one person could end up with
 * two different study days — a 2am sitting counting towards different dates
 * depending on which language it happened to be in.
 */
describe('when the study day rolls over', () => {
  it('defaults to four in the morning', async () => {
    const { engine } = await makeEngine();
    expect(engine.dayStartHour).toBe(4);
  });

  it('is one value for every language', async () => {
    const { engine } = await makeEngine();
    await engine.setDayStartHour(2);

    await engine.setActiveLanguage('ja');
    // Not a per-language question any more: switching language must not change
    // when today started.
    expect(engine.dayStartHour).toBe(2);
  });

  it('survives a restart', async () => {
    const { engine, store } = await makeEngine();
    await engine.setDayStartHour(7);

    const reopened = await StudyEngine.create({
      store,
      seedEntries: SEED_ENTRIES,
      clock: fixedClock(NOW),
    });
    expect(reopened.dayStartHour).toBe(7);
  });

  it('clamps an hour that is not one', async () => {
    const { engine } = await makeEngine();
    await engine.setDayStartHour(42);
    expect(engine.dayStartHour).toBe(23);
    await engine.setDayStartHour(-3);
    expect(engine.dayStartHour).toBe(0);
  });

  /**
   * The behaviour the setting exists for.
   *
   * Study at 02:00, then look at the app at 10:00 the same morning. With the
   * day starting at four, the sitting belongs to yesterday and today is empty
   * — which is the point: finishing at 2am should not mean the next evening
   * already counts as a second day's work. Move the boundary to midnight and
   * the same sitting becomes part of today.
   *
   * Asserted through the counts rather than on the hour itself, because the
   * hour is only worth storing if it moves the boundary.
   */
  it('decides which day a small-hours sitting counts towards', async () => {
    const { engine } = await makeEngine('2026-03-02T02:00:00.000Z');
    const card = engine.getQueue().cards[0]!.card;
    await engine.grade(card.id, 3);

    const laterThatMorning = '2026-03-02T10:00:00.000Z';
    const worked = (stats: ReturnType<StudyEngine['getStats']>) =>
      stats.today.newCards + stats.today.reviews;

    // 02:00 is still the 1st; 10:00 is the 2nd. Different study days.
    expect(worked(engine.getStats('zh', laterThatMorning))).toBe(0);

    await engine.setDayStartHour(0);
    // Now both are the 2nd, so the sitting is today's.
    expect(worked(engine.getStats('zh', laterThatMorning))).toBe(1);
  });

  /**
   * An account that set this before the move must not lose it.
   *
   * Without the migration their study day silently returns to four, which
   * breaks a streak for a reason they cannot see.
   */
  it('carries an hour up from an old per-language profile', async () => {
    const store = new MemoryStore();
    const profile: StudyProfile = {
      ...DEFAULT_STUDY_PROFILE,
      languageCode: 'zh',
      examTrackId: 'hsk3',
      targetLevelId: 'hsk3-1',
      dayStartHour: 2,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await store.set(
      STORAGE_KEYS.meta,
      JSON.stringify({
        version: 1,
        activeLanguage: 'zh',
        profiles: { zh: profile },
        schedulerConfig: {},
      }),
    );

    const engine = await StudyEngine.create({
      store,
      seedEntries: SEED_ENTRIES,
      clock: fixedClock(NOW),
    });
    expect(engine.dayStartHour).toBe(2);
  });

  it('leaves a default-hour profile at the default', async () => {
    const store = new MemoryStore();
    await store.set(
      STORAGE_KEYS.meta,
      JSON.stringify({
        version: 1,
        activeLanguage: 'zh',
        profiles: {
          zh: {
            ...DEFAULT_STUDY_PROFILE,
            languageCode: 'zh',
            examTrackId: 'hsk3',
            targetLevelId: 'hsk3-1',
            createdAt: NOW,
            updatedAt: NOW,
          },
        },
        schedulerConfig: {},
      }),
    );

    const engine = await StudyEngine.create({
      store,
      seedEntries: SEED_ENTRIES,
      clock: fixedClock(NOW),
    });
    expect(engine.dayStartHour).toBe(4);
  });
});

/**
 * Preferences have one carrier, and the blob is not it.
 *
 * Appearance, backdrop and the start of the day have their own endpoints. They
 * also sit in the same `meta` key as the deck's bookkeeping, so a synced blob
 * carries a copy — and if that copy wins, choosing dark on one device gets
 * undone by a sync from another that has not heard about it yet.
 */
describe('settings and the synced blob', () => {
  it('keeps this device’s appearance when a blob says otherwise', async () => {
    const { engine } = await makeEngine();
    await engine.setAppearance('dark');
    await engine.setBackdrop('living');
    await engine.setDayStartHour(2);

    // A blob from a device that still thinks the account is light and calm.
    const other = await makeEngine();
    await other.engine.setAppearance('light');
    await other.engine.setBackdrop('calm');
    await other.engine.setDayStartHour(9);
    await engine.importState(await other.engine.exportState());

    expect(engine.appearance).toBe('dark');
    expect(engine.backdrop).toBe('living');
    expect(engine.dayStartHour).toBe(2);
  });

  it('takes the blob’s settings when this device has never chosen', async () => {
    // The other half of the rule: silence is not a preference. A fresh browser
    // signing in should adopt the account's look rather than impose defaults.
    const chosen = await makeEngine();
    await chosen.engine.setAppearance('dark');
    await chosen.engine.setBackdrop('living');

    const fresh = await makeEngine();
    await fresh.engine.importState(await chosen.engine.exportState());

    expect(fresh.engine.appearance).toBe('dark');
    expect(fresh.engine.backdrop).toBe('living');
  });

  it('still carries them in the blob, for an older build reading it', async () => {
    const { engine } = await makeEngine();
    await engine.setAppearance('dark');

    const exported = await engine.exportState();
    const meta = JSON.parse(exported[STORAGE_KEYS.meta]!) as { appearance?: string };
    expect(meta.appearance).toBe('dark');
  });

  it('survives the preserved settings across a restart', async () => {
    const { engine, store } = await makeEngine();
    await engine.setAppearance('dark');

    const other = await makeEngine();
    await other.engine.setAppearance('light');
    await engine.importState(await other.engine.exportState());

    // Written to the store, not only held in memory: an import that only fixed
    // the field in memory would lose it on the next launch.
    const reopened = await StudyEngine.create({
      store,
      seedEntries: SEED_ENTRIES,
      clock: fixedClock(NOW),
    });
    expect(reopened.appearance).toBe('dark');
  });
});

/**
 * Writing books, which are a different activity from the review queue.
 *
 * The queue decides what you see and when. A workbook is the same characters,
 * in order, with the ones you have done marked off — so progress here is a
 * count rather than a schedule.
 */
describe('writing books', () => {
  it('offers books for a language written in characters', async () => {
    const { engine } = await makeEngine();
    const books = engine.getBooks('zh');
    expect(books.length).toBeGreaterThan(0);
    expect(books[0]!.chapters.length).toBeGreaterThan(0);
  });

  it('offers none for a Latin-alphabet language', async () => {
    const { engine } = await makeEngine();
    await engine.setActiveLanguage('vi');
    expect(engine.getBooks('vi')).toEqual([]);
  });

  it('records a character as written, once', async () => {
    const { engine } = await makeEngine();
    const chapter = engine.getBooks('zh')[0]!.chapters[0]!;
    const character = chapter.items[0]!.character;

    await engine.recordWritten(chapter.id, character);
    await engine.recordWritten(chapter.id, character);

    // Writing it twice is practice, not progress. Counting it twice would let
    // a chapter read as finished with half of it never attempted.
    expect(engine.getWritingProgress()[chapter.id]?.written).toEqual([character]);
  });

  it('keeps progress across a restart', async () => {
    const { engine, store } = await makeEngine();
    const chapter = engine.getBooks('zh')[0]!.chapters[0]!;
    await engine.recordWritten(chapter.id, chapter.items[0]!.character);

    const reopened = await StudyEngine.create({
      store,
      seedEntries: SEED_ENTRIES,
      clock: fixedClock(NOW),
    });
    expect(reopened.getWritingProgress()[chapter.id]?.written).toHaveLength(1);
  });

  it('hands back a copy, so a caller cannot write to the engine', async () => {
    const { engine } = await makeEngine();
    const chapter = engine.getBooks('zh')[0]!.chapters[0]!;
    await engine.recordWritten(chapter.id, chapter.items[0]!.character);

    engine.getWritingProgress()[chapter.id]!.written.push('smuggled');
    expect(engine.getWritingProgress()[chapter.id]?.written).not.toContain('smuggled');
  });

  it('travels with the account rather than staying on the device', async () => {
    const { engine } = await makeEngine();
    const chapter = engine.getBooks('zh')[0]!.chapters[0]!;
    await engine.recordWritten(chapter.id, chapter.items[0]!.character);

    // A workbook you are halfway through is exactly the thing that should be
    // on your phone when you pick it up.
    const exported = await engine.exportState();
    expect(exported[STORAGE_KEYS.writing]).toBeDefined();

    const other = await makeEngine();
    await other.engine.importState(exported);
    expect(other.engine.getWritingProgress()[chapter.id]?.written).toHaveLength(1);
  });
});
