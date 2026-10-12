import { describe, expect, it } from 'vitest';
import { StudyEngine } from './engine';
import { SEED_ENTRIES } from './data/seed';
import { resolvePalette } from './theme/palettes';
import { WIDGET_SCHEMA_VERSION } from './widget/payload';
import { MemoryStore } from './storage/port';
import { computeStreak } from './stats/metrics';
import { computeExamReadiness, suggestDailyNewLimit } from './stats/readiness';
import { DEFAULT_STUDY_PROFILE, type StudyProfile } from './types/card';
import type { ReviewLog } from './types/review';
import { addDays, fixedClock } from './utils/date';
import { generateCards } from './cards/factory';
import { getExamLevel } from './exams';
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

  it('still has something to study after a track switch', async () => {
    // The regression that made this test exist: card ids are `entryId:kind` and
    // carry no level, so every card stayed tagged `hsk3-1` after switching to
    // HSK 2.0. The queue filters on `levelId`, nothing matched `hsk2-1`, and the
    // app went permanently empty while the dashboard said "all caught up".
    const { engine } = await makeEngine();
    const before = engine.getQueue({ code: 'zh' }).cards.length;
    expect(before).toBeGreaterThan(0);

    await engine.setExamTrack('zh', 'hsk2');

    expect(engine.getQueue({ code: 'zh' }).cards.length).toBeGreaterThan(0);

    // Every card for a kind the new level examines follows the learner across.
    // Kinds it does not examine stay behind on purpose — HSK 2.0 Level 1 prints
    // pinyin on the paper and has no production section — and the queue filters
    // them out rather than the history being deleted.
    const examined = new Set(Object.keys(getExamLevel('hsk2-1').cardWeights));
    const stranded = engine
      .getAllCards('zh')
      .filter((card) => !card.levelId.startsWith('hsk2-') && examined.has(card.kind));
    expect(stranded).toEqual([]);
  });

  it('carries review history through a track switch', async () => {
    const { engine } = await makeEngine();
    const card = engine.getQueue({ code: 'zh' }).cards[0]!.card;
    await engine.grade(card.id, 3, { source: 'app' });

    const graded = engine.getAllCards('zh').find((candidate) => candidate.id === card.id)!;
    await engine.setExamTrack('zh', 'hsk2');
    const after = engine.getAllCards('zh').find((candidate) => candidate.id === card.id)!;

    // Only the tag moves. The memory state is the learner's.
    expect(after.levelId).not.toBe(graded.levelId);
    expect(after.reps).toBe(graded.reps);
    expect(after.stability).toBe(graded.stability);
    expect(after.due).toBe(graded.due);
  });

  it('survives a round trip between tracks', async () => {
    const { engine } = await makeEngine();
    await engine.setExamTrack('zh', 'hsk2');
    await engine.setExamTrack('zh', 'hsk3');
    expect(engine.getQueue({ code: 'zh' }).cards.length).toBeGreaterThan(0);
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
    // Both palettes travel, so the widget can follow the home screen's own
    // appearance rather than whichever mode the app last rendered.
    expect(parsed.theme.light.canvas).toBe(resolvePalette('zh', 'light').canvas);
    expect(parsed.theme.dark.canvas).toBe(resolvePalette('zh', 'dark').canvas);
    expect(parsed.theme.light.gradeColors).toHaveLength(4);
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
    // A deck that holds the whole syllabus has nothing to caveat, so the
    // headline is free to ask for the date.
    const readiness = computeExamReadiness(cards, profile(), NOW, 500);
    expect(readiness.verdict).toBe('no-exam-set');
    expect(readiness.headline).toMatch(/Set an exam date/);
  });

  it('names the gap between the deck and the syllabus instead of a bare percentage', () => {
    // The seed deck holds 27 of HSK 1's 500 words. Reporting "5% known" and
    // "473 words remaining" implied 473 words were in here to study.
    const readiness = computeExamReadiness(cards, profile(), NOW, 27);

    expect(readiness.coverage).toBe(0);
    expect(readiness.wordsRemaining).toBe(27);
    expect(readiness.syllabusShortfall).toBe(473);
    expect(readiness.headline).toContain('of 27');
    expect(readiness.headline).toContain('473');
  });

  it('lets deck progress reach the end', () => {
    // Mastering everything the app holds is 100% of the deck — and still only 5%
    // of the paper, which is the number readiness is scored on.
    const known = cards.map((card) => ({
      ...card,
      state: 'review' as const,
      stability: 40,
      difficulty: 5,
      reps: 4,
      lastReviewedAt: NOW,
    }));
    const readiness = computeExamReadiness(known, profile(), NOW, 27);

    expect(readiness.coverage).toBe(1);
    expect(readiness.wordsRemaining).toBe(0);
    expect(readiness.syllabusCoverage).toBeCloseTo(27 / 500, 3);
  });

  it('reports not-started when nothing has been studied', () => {
    const readiness = computeExamReadiness(cards, profile({ examDate: '2026-06-01' }), NOW);
    expect(readiness.verdict).toBe('not-started');
    expect(readiness.score).toBe(0);
  });

  it('calls out an insufficient daily pace, against words that exist', () => {
    // 400 words in the deck, none started, 10 days, 5 a day: not going to happen.
    // Paced against the deck rather than the syllabus, because no daily limit
    // gets through words the app does not have.
    const readiness = computeExamReadiness(
      cards.map((card) => ({ ...card, state: 'new' as const })),
      profile({ examDate: '2026-03-11', dailyNewLimit: 5 }),
      NOW,
      400,
    );

    expect(readiness.requiredNewPerDay).toBeGreaterThan(5);
    expect(readiness.paceIsSufficient).toBe(false);
  });

  it('does not demand a pace through words the deck does not contain', () => {
    // Everything available already started: there is no pace that could be
    // insufficient, and the old code called this "behind" forever.
    const studied = cards.map((card) => ({
      ...card,
      state: 'review' as const,
      stability: 30,
      difficulty: 5,
      reps: 3,
      lastReviewedAt: NOW,
    }));
    const readiness = computeExamReadiness(
      studied,
      profile({ examDate: '2026-03-11', dailyNewLimit: 5 }),
      NOW,
      27,
    );

    expect(readiness.requiredNewPerDay).toBe(0);
    expect(readiness.paceIsSufficient).toBe(true);
    expect(readiness.wordsRemaining).toBe(0);
  });

  it('blames the deck, not the learner, when the syllabus cannot be reached', () => {
    const readiness = computeExamReadiness(
      cards.map((card) => ({ ...card, state: 'new' as const })),
      profile({ examDate: '2026-03-11', dailyNewLimit: 500 }),
      NOW,
      27,
    );

    expect(readiness.verdict).toBe('not-started');
    expect(readiness.syllabusShortfall).toBe(473);
  });

  it('caps a suggested pace at the words actually available', () => {
    const uncapped = suggestDailyNewLimit('hsk3-1', NOW, '2026-03-11');
    const capped = suggestDailyNewLimit('hsk3-1', NOW, '2026-03-11', 27);
    expect(uncapped).toBeGreaterThan(capped);
    expect(capped).toBeLessThanOrEqual(27);
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

describe('rescuing a word that is fighting back', () => {
  /**
   * Fail a card until the scheduler gives up on it.
   *
   * Time has to move. Lapses are only counted against a card already in review,
   * and with the clock frozen a card walks the one- and ten-minute learning steps
   * forever without ever graduating, so no amount of failing it registers.
   */
  async function makeLeech() {
    const { engine, store } = await makeEngine();
    const card = engine.getQueue({ code: 'zh' }).cards[0]!.card;
    let now = NOW;

    // Easy graduates straight out of the learning ladder into review.
    await engine.grade(card.id, 4, { source: 'app', now });

    for (let attempt = 0; attempt < 15; attempt += 1) {
      const current = engine.getAllCards('zh').find((candidate) => candidate.id === card.id)!;
      if (current.leech) break;

      now = addDays(now, 1);
      await engine.grade(card.id, 1, { source: 'app', now });
      now = addDays(now, 1);
      await engine.grade(card.id, 4, { source: 'app', now });
    }

    return { engine, store, cardId: card.id, lastNow: now };
  }

  it('surfaces a leech the learner can act on', async () => {
    const { engine, cardId } = await makeLeech();
    const struggling = engine.getStrugglingCards('zh');

    expect(struggling.length).toBeGreaterThan(0);
    expect(struggling.some((row) => row.card.id === cardId)).toBe(true);
    expect(engine.getStats('zh').coverage.leeches).toBeGreaterThan(0);
  });

  it('starts a card over without rewriting history', async () => {
    const { engine, cardId } = await makeLeech();
    const logsBefore = engine.getStats('zh').retention.reviews;

    await engine.resetCard(cardId);
    const card = engine.getAllCards('zh').find((candidate) => candidate.id === cardId)!;

    expect(card.state).toBe('new');
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.leech).toBeFalsy();
    expect(card.stability).toBe(0);

    // The log is what actually happened; deleting it would flatter retention.
    expect(engine.getStats('zh').retention.reviews).toBe(logsBefore);
  });

  it('puts a reset card back in front of the learner', async () => {
    const { engine, cardId } = await makeLeech();
    await engine.resetCard(cardId);
    expect(engine.getQueue({ code: 'zh' }).cards.some((pair) => pair.card.id === cardId)).toBe(true);
  });

  it('keeps a reset card suspended if that is where it was', async () => {
    const { engine, cardId } = await makeLeech();
    await engine.setCardSuspended(cardId, true);
    await engine.resetCard(cardId);

    const card = engine.getAllCards('zh').find((candidate) => candidate.id === cardId)!;
    expect(card.suspended).toBe(true);
  });

  it('clears the flag for good, not until the next lapse', async () => {
    const { engine, cardId } = await makeLeech();
    await engine.clearLeech(cardId);

    const card = engine.getAllCards('zh').find((candidate) => candidate.id === cardId)!;
    expect(card.leech).toBe(false);
    // Lapses go too: the scheduler re-raises the flag from the count, so leaving
    // it would make the button appear to do nothing on the very next failure.
    expect(card.lapses).toBe(0);
    expect(engine.getStrugglingCards('zh').some((row) => row.card.id === cardId)).toBe(false);
  });

  it('leaves the schedule alone when only the flag is cleared', async () => {
    const { engine, cardId } = await makeLeech();
    const before = engine.getAllCards('zh').find((candidate) => candidate.id === cardId)!;

    await engine.clearLeech(cardId);
    const after = engine.getAllCards('zh').find((candidate) => candidate.id === cardId)!;

    expect(after.due).toBe(before.due);
    expect(after.stability).toBe(before.stability);
    expect(after.reps).toBe(before.reps);
  });

  it('ignores an unknown card id', async () => {
    const { engine } = await makeEngine();
    await expect(engine.resetCard('nope:recognition')).resolves.toBeUndefined();
    await expect(engine.clearLeech('nope:recognition')).resolves.toBeUndefined();
  });
});

describe('notes on a word', () => {
  it('saves a note and gives it back', async () => {
    const { engine } = await makeEngine();
    await engine.setEntryNote('zh-nihao', '  Sounds like "knee how"  ');
    expect(engine.getEntry('zh-nihao')?.mnemonic).toBe('Sounds like "knee how"');
  });

  it('survives a relaunch', async () => {
    const { engine, store } = await makeEngine();
    await engine.setEntryNote('zh-nihao', 'knee how');

    const reopened = await StudyEngine.create({ store, seedEntries: SEED_ENTRIES, clock: fixedClock(NOW) });
    expect(reopened.getEntry('zh-nihao')?.mnemonic).toBe('knee how');
  });

  it('removes the note when it is emptied rather than storing a blank', async () => {
    const { engine } = await makeEngine();
    await engine.setEntryNote('zh-nihao', 'knee how');
    await engine.setEntryNote('zh-nihao', '   ');
    expect(engine.getEntry('zh-nihao')?.mnemonic).toBeUndefined();
  });

  it('changes nothing else about the word', async () => {
    const { engine } = await makeEngine();
    const before = engine.getEntry('zh-nihao')!;
    await engine.setEntryNote('zh-nihao', 'knee how');
    const after = engine.getEntry('zh-nihao')!;

    expect(after.target).toBe(before.target);
    expect(after.meanings).toEqual(before.meanings);
    expect(after.levelIds).toEqual(before.levelIds);
    expect(after.tones).toEqual(before.tones);
  });

  it('does not disturb the cards that already exist for it', async () => {
    const { engine } = await makeEngine();
    const card = engine.getQueue({ code: 'zh' }).cards.find((pair) => pair.entry.id === 'zh-nihao')!.card;
    await engine.grade(card.id, 3, { source: 'app' });
    const graded = engine.getAllCards('zh').find((candidate) => candidate.id === card.id)!;

    await engine.setEntryNote('zh-nihao', 'knee how');

    const after = engine.getAllCards('zh').find((candidate) => candidate.id === card.id)!;
    expect(after.reps).toBe(graded.reps);
    expect(after.due).toBe(graded.due);
  });

  it('ignores an unknown word', async () => {
    const { engine } = await makeEngine();
    await expect(engine.setEntryNote('zh-nope', 'hello')).resolves.toBeUndefined();
  });
});
