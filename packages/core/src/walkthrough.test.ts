import { describe, expect, it } from 'vitest';
import { StudyEngine } from './engine';
import { SEED_ENTRIES } from './data/seed';
import { EXAM_TRACKS, getLevelIdsInScope } from './exams';
import { MemoryStore } from './storage/port';
import { LANGUAGE_CODES } from './types/language';
import { addDays } from './utils/date';

/**
 * End-to-end walkthroughs.
 *
 * The unit tests each check one rule; these drive the engine the way a learner
 * does — pick a language, pick a level, study until there is nothing left — and
 * assert that the numbers on the way through are ones a person could act on.
 *
 * Both defects this file was written to catch were invisible to the unit tests
 * because each component was individually correct. A card kept its level tag
 * (correct in isolation) while the queue filtered on that tag (also correct), and
 * together they emptied the app on a track switch. Coverage divided by the exam's
 * vocabulary target (a true number) and reported 5% to someone who had learned
 * every word the app contained.
 */

const START = '2026-03-01T09:00:00.000Z';

/** Study to exhaustion, advancing the clock the way days actually pass. */
async function studyEverything(engine: StudyEngine, setNow: (at: string) => void, from: string): Promise<number> {
  let now = from;
  let graded = 0;

  for (let day = 0; day < 30; day += 1) {
    for (let round = 0; round < 40; round += 1) {
      const queue = engine.getQueue();
      if (queue.cards.length === 0) break;
      for (const { card } of queue.cards) {
        await engine.grade(card.id, 3, { source: 'app' });
        graded += 1;
      }
      // Learning steps are minute-scale; move enough to clear them.
      now = new Date(Date.parse(now) + 11 * 60_000).toISOString();
      setNow(now);
    }
    now = addDays(now, 1);
    setNow(now);
  }

  return graded;
}

async function engineAt(levelId: string, trackId: string, code: 'zh' | 'ja' | 'ko' | 'vi') {
  let now = START;
  const engine = await StudyEngine.create({
    store: new MemoryStore(),
    seedEntries: SEED_ENTRIES,
    clock: () => now,
  });
  await engine.setActiveLanguage(code);
  await engine.setExamTrack(code, trackId);
  await engine.updateProfile(code, { targetLevelId: levelId, dailyNewLimit: 40 });
  return { engine, setNow: (at: string) => { now = at; }, get now() { return now; } };
}

describe('a whole level, start to finish', () => {
  it('takes HSK 1 from nothing to everything without lying about the numbers', async () => {
    const ctx = await engineAt('hsk3-1', 'hsk3', 'zh');
    const { engine } = ctx;

    const available = engine.getAvailableWordCount('zh');
    const before = engine.getStats('zh');
    expect(before.coverage.entriesKnown).toBe(0);
    expect(before.coverage.fraction).toBe(0);
    // The deck is a fraction of the syllabus, and the two are different numbers.
    expect(available).toBeGreaterThan(0);
    expect(before.coverage.target).toBe(500);
    expect(available).toBeLessThan(before.coverage.target);

    const graded = await studyEverything(engine, ctx.setNow, START);
    expect(graded).toBeGreaterThan(0);

    const after = engine.getStats('zh');
    const readiness = engine.getReadiness('zh');

    // Everything the app holds is now known.
    expect(after.coverage.entriesKnown).toBe(available);

    /*
     * And it still does not claim the learner is ready for a 500-word paper.
     *
     * `fraction` and `coverage` are measured against the official syllabus,
     * not against what the deck happens to contain, so learning every word
     * the app ships reads as 5% rather than 100%. That is deliberate — the
     * alternative tells somebody with 27 of 500 words that they are done —
     * but it does mean the number on the dashboard is about the exam rather
     * than about their progress through the app, and the settings screen has
     * to show both for either to be meaningful.
     */
    expect(after.coverage.fraction).toBeLessThan(0.2);
    expect(readiness.coverage).toBeLessThan(0.2);
    expect(readiness.wordsRemaining).toBe(500 - available);

    // Nothing is left to serve, under any session size. `getQueue` no longer
    // takes a `mode`; the learn/review split is decided by the queue itself.
    expect(engine.getQueue().cards).toHaveLength(0);
    expect(engine.getQueue({ sessionLimit: 500 }).cards).toHaveLength(0);
    expect(engine.getDeck('zh').every((row) => row.status !== 'learning')).toBe(true);
  });

  it('never promises words it does not have', async () => {
    // Across every level of every track: "remaining" must be reachable.
    for (const code of LANGUAGE_CODES) {
      for (const track of EXAM_TRACKS.filter((candidate) => candidate.languageCode === code)) {
        for (const level of track.levels) {
          const { engine } = await engineAt(level.id, track.id, code);
          const readiness = engine.getReadiness(code);
          /*
           * `wordsRemaining` counts against the exam's published syllabus, so
           * it is routinely larger than the deck — that is the honest number
           * about the paper. What must never happen is a figure that is
           * impossible on its face: more remaining than the exam contains, a
           * coverage over 100%, or a pace of Infinity words a day.
           */
          expect(readiness.wordsRemaining).toBeGreaterThanOrEqual(0);
          expect(readiness.wordsRemaining).toBeLessThanOrEqual(level.vocabularyTarget);
          expect(readiness.coverage).toBeLessThanOrEqual(1);
          expect(Number.isFinite(readiness.requiredNewPerDay)).toBe(true);
        }
      }
    }
  });

  it('serves cards at every level that has words for it', async () => {
    // The track-switch defect showed up as a silently empty queue, so this
    // asserts the opposite everywhere rather than only where it was noticed.
    for (const code of LANGUAGE_CODES) {
      for (const track of EXAM_TRACKS.filter((candidate) => candidate.languageCode === code)) {
        for (const level of track.levels) {
          const { engine } = await engineAt(level.id, track.id, code);
          const scope = new Set(getLevelIdsInScope(level.id));
          const available = engine
            .getEntries(code)
            .filter((entry) => entry.levelIds.some((id) => scope.has(id))).length;

          if (available === 0) continue;
          expect(
            engine.getQueue().cards.length,
            `${track.id}/${level.id} has ${available} words but served nothing`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps working across a track switch mid-study', async () => {
    const ctx = await engineAt('hsk3-1', 'hsk3', 'zh');
    const { engine } = ctx;

    // Study a bit, then change exam standard the way the settings screen offers.
    const first = engine.getQueue().cards.slice(0, 5);
    for (const { card } of first) await engine.grade(card.id, 3, { source: 'app' });
    const repsBefore = engine.getAllCards('zh').reduce((sum, card) => sum + card.reps, 0);

    await engine.setExamTrack('zh', 'hsk2');

    expect(engine.getQueue().cards.length).toBeGreaterThan(0);
    expect(engine.getAllCards('zh').reduce((sum, card) => sum + card.reps, 0)).toBe(repsBefore);

    // And the level can still be finished from there.
    await studyEverything(engine, ctx.setNow, ctx.now);
    expect(engine.getQueue().cards).toHaveLength(0);
    expect(engine.getStats('zh').coverage.entriesKnown).toBeGreaterThan(0);
  });

  it('walks up the levels, carrying history and gaining words', async () => {
    const ctx = await engineAt('jlpt-n5', 'jlpt', 'ja');
    const { engine } = ctx;

    await studyEverything(engine, ctx.setNow, START);
    const known = engine.getStats('ja').coverage.entriesKnown;
    expect(known).toBeGreaterThan(0);

    await engine.updateProfile('ja', { targetLevelId: 'jlpt-n4' });

    // Nothing is forgotten by moving up, and the syllabus denominator grows.
    expect(engine.getStats('ja').coverage.entriesKnown).toBe(known);
    expect(engine.getStats('ja').coverage.target).toBe(1500);
  });
});
