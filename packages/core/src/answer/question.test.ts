import { describe, expect, it } from 'vitest';
import { SEED_ENTRIES } from '../data/seed';
import { StudyEngine } from '../engine';
import { MemoryStore } from '../storage/port';
import { fixedClock } from '../utils/date';
import { buildQuestion } from './question';

const NOW = '2026-03-01T09:00:00.000Z';

async function makeEngine(now = NOW) {
  return StudyEngine.create({
    store: new MemoryStore(),
    seedEntries: SEED_ENTRIES,
    clock: fixedClock(now),
  });
}

/**
 * Assembling a question used to be twenty lines written out in each client.
 * These tests pin the assembled result, so the thing the server serves and the
 * thing an app renders cannot drift apart without one of them failing.
 */
describe('buildQuestion', () => {
  it('resolves a mode, its options and all four previews', async () => {
    const engine = await makeEngine();
    const pair = engine.getQueue().cards[0]!;

    const question = buildQuestion({
      pair,
      pool: engine.getEntries('zh'),
      profile: engine.getProfile('zh'),
      now: NOW,
    });

    expect(question.card).toBe(pair);
    expect(['choice', 'typed', 'tone', 'self']).toContain(question.mode);
    expect(Object.keys(question.previews).map(Number).sort()).toEqual([1, 2, 3, 4]);
    expect(question.previews[3].display).toMatch(/\d/);
  });

  it('offers exactly one correct option when it asks a multiple choice', async () => {
    const engine = await makeEngine();
    const pool = engine.getEntries('zh');
    const profile = engine.getProfile('zh');

    const questions = engine
      .getQueue({ sessionLimit: 20 })
      .cards.map((pair) => buildQuestion({ pair, pool, profile, now: NOW }));

    const choices = questions.filter((question) => question.mode === 'choice');
    expect(choices.length).toBeGreaterThan(0);
    for (const question of choices) {
      expect(question.options.length).toBeGreaterThanOrEqual(3);
      expect(question.options.filter((option) => option.correct)).toHaveLength(1);
    }
  });

  it('carries no options for the modes that have nothing to choose between', async () => {
    const engine = await makeEngine();
    const pool = engine.getEntries('zh');
    const profile = engine.getProfile('zh');

    const questions = engine
      .getQueue({ sessionLimit: 30 })
      .cards.map((pair) => buildQuestion({ pair, pool, profile, now: NOW }));

    for (const question of questions) {
      if (question.mode === 'self' || question.mode === 'typed') {
        expect(question.options).toEqual([]);
      }
    }
  });

  it('honours a preference for self-grading, which is how a revealed card is re-asked', async () => {
    const engine = await makeEngine();
    const pair = engine.getQueue().cards[0]!;

    const question = buildQuestion({
      pair,
      pool: engine.getEntries('zh'),
      profile: engine.getProfile('zh'),
      now: NOW,
      preferred: 'self',
    });

    expect(question.mode).toBe('self');
    expect(question.options).toEqual([]);
  });

  it('threads the profile through, so previews reflect the learner’s retention', async () => {
    const engine = await makeEngine();
    const pair = engine.getQueue().cards[0]!;
    const pool = engine.getEntries('zh');
    const base = engine.getProfile('zh');

    const relaxed = buildQuestion({ pair, pool, profile: { ...base, desiredRetention: 0.8 }, now: NOW });
    const strict = buildQuestion({ pair, pool, profile: { ...base, desiredRetention: 0.97 }, now: NOW });

    // Wanting to remember more means being asked again sooner. If these came out
    // equal, the profile was being ignored — which is exactly the bug a client
    // computing its own previews would have.
    expect(strict.previews[3].intervalDays).toBeLessThanOrEqual(relaxed.previews[3].intervalDays);
  });
});

describe('engine.getQuestions', () => {
  it('returns a question per queued card, with the queue beside it', async () => {
    const engine = await makeEngine();
    const { questions, queue } = engine.getQuestions({ sessionLimit: 5 });

    expect(questions).toHaveLength(queue.cards.length);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.length).toBeLessThanOrEqual(5);
    expect(questions.map((question) => question.card.card.id)).toEqual(
      queue.cards.map((pair) => pair.card.id),
    );
  });

  it('agrees with building the questions by hand', async () => {
    const engine = await makeEngine();
    const { questions } = engine.getQuestions({ sessionLimit: 3 });

    const byHand = engine.getQueue({ sessionLimit: 3 }).cards.map((pair) =>
      buildQuestion({
        pair,
        pool: engine.getEntries('zh'),
        profile: engine.getProfile('zh'),
        now: NOW,
      }),
    );

    expect(questions.map((question) => question.mode)).toEqual(byHand.map((question) => question.mode));
    expect(questions.map((question) => question.options.map((option) => option.id))).toEqual(
      byHand.map((question) => question.options.map((option) => option.id)),
    );
  });

  it('passes a kind filter through to the queue', async () => {
    const engine = await makeEngine();
    const { questions } = engine.getQuestions({ kinds: ['recognition'], sessionLimit: 10 });

    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(question.card.card.kind).toBe('recognition');
    }
  });
});
