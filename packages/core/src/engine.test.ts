import { describe, expect, it } from 'vitest';
import { StudyEngine } from './engine';
import { SEED_ENTRIES } from './data/seed';
import { getLanguageTheme } from './theme/palettes';
import { WIDGET_SCHEMA_VERSION } from './widget/payload';
import { MemoryStore } from './storage/port';
import { computeStreak } from './stats/metrics';
import { computeExamReadiness, suggestDailyNewLimit } from './stats/readiness';
import { DEFAULT_STUDY_PROFILE, type StudyProfile } from './types/card';
import type { ReviewLog } from './types/review';
import { addDays, fixedClock } from './utils/date';
import { generateCards } from './cards/factory';
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
