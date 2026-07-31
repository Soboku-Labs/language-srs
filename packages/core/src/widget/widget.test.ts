import { describe, expect, it } from 'vitest';
import { generateCards } from '../cards/factory';
import { MANDARIN_SEED } from '../data/seed/mandarin';
import { buildStudyQueue } from '../session/queue';
import { gradeCard } from '../srs/scheduler';
import { computeStreak } from '../stats/metrics';
import { computeExamReadiness } from '../stats/readiness';
import { DEFAULT_STUDY_PROFILE, type Card, type StudyProfile } from '../types/card';
import { addDays } from '../utils/date';
import { linkToGrade, parseDeepLink } from './deeplinks';
import { WIDGET_SCHEMA_VERSION, buildWidgetSnapshot, buildWidgetTimeline, pickSpotlight } from './payload';
import { applyPendingGrades } from './pending';

const NOW = '2026-03-01T09:00:00.000Z';

const profile: StudyProfile = {
  ...DEFAULT_STUDY_PROFILE,
  languageCode: 'zh',
  examTrackId: 'hsk3',
  targetLevelId: 'hsk3-1',
  dailyNewLimit: 6,
  createdAt: NOW,
  updatedAt: NOW,
};

const entries = new Map(MANDARIN_SEED.map((entry) => [entry.id, entry]));

function snapshotFor(cards: Card[], overrides: Partial<StudyProfile> = {}, now = NOW) {
  const settings = { ...profile, ...overrides };
  const queue = buildStudyQueue({ now, profile: settings, cards, entries });
  return buildWidgetSnapshot({
    now,
    profile: settings,
    queue,
    streak: computeStreak([], now),
    readiness: computeExamReadiness(cards, settings, now),
    ...(queue.cards.length === 0 ? { spotlight: pickSpotlight(cards, entries, now) } : {}),
  });
}

describe('widget snapshot', () => {
  const cards = generateCards(MANDARIN_SEED, ['hsk3-1'], { now: NOW });

  it('stamps the schema version so old native decoders can bail out safely', () => {
    expect(snapshotFor(cards).schemaVersion).toBe(WIDGET_SCHEMA_VERSION);
  });

  it('is JSON round-trippable, since it crosses a process boundary as a string', () => {
    const snapshot = snapshotFor(cards);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('carries counts that match the queue', () => {
    const snapshot = snapshotFor(cards);
    expect(snapshot.counts.total).toBe(snapshot.counts.due + snapshot.counts.fresh + snapshot.counts.learning);
    expect(snapshot.counts.fresh).toBe(6);
  });

  it('precomputes every string the native side needs, leaving no formatting to Swift or Kotlin', () => {
    const snapshot = snapshotFor(cards, { examDate: '2026-03-24' });
    expect(snapshot.exam.caption).toBe('HSK 1 in 23 days');
    expect(snapshot.streak.caption).toBe('Start your streak');
    expect(snapshot.action.label).toMatch(/^Review \d+$/);
    expect(snapshot.nextCard?.options.every((option) => option.interval.length > 0)).toBe(true);
  });

  it('describes the exam date in words for every case', () => {
    expect(snapshotFor(cards, { examDate: '2026-03-01' }).exam.caption).toBe('HSK 1 — exam today');
    expect(snapshotFor(cards, { examDate: '2026-03-02' }).exam.caption).toBe('HSK 1 — exam tomorrow');
    expect(snapshotFor(cards, { examDate: '2026-02-01' }).exam.caption).toBe('HSK 1 — exam date passed');
    expect(snapshotFor(cards).exam.caption).toBe('HSK 1 — no exam date set');
  });

  it('never leaks the answer into the prompt of a production card', () => {
    const productionOnly = cards.filter((card) => card.kind === 'production');
    const snapshot = snapshotFor(productionOnly, { enabledCardKinds: ['production'] });
    const next = snapshot.nextCard!;
    expect(next.kind).toBe('production');
    expect(next.prompt).toBe(next.answer);
    // The prompt is the gloss; the target word must not appear on the front.
    expect(next.prompt).not.toContain(entries.get(next.entryId)!.target);
  });

  it('offers all four gradings with intervals in increasing order', () => {
    const snapshot = snapshotFor(cards);
    const options = snapshot.nextCard!.options;
    expect(options.map((option) => option.rating)).toEqual([1, 2, 3, 4]);
    expect(options.map((option) => option.label)).toEqual(['Again', 'Hard', 'Good', 'Easy']);
  });

  it('falls back to a spotlight word when nothing is due, rather than going blank', () => {
    const studied = cards.map((card) => ({
      ...card,
      state: 'review' as const,
      stability: 20,
      difficulty: 5,
      reps: 3,
      lastReviewedAt: NOW,
      due: addDays(NOW, 20),
    }));

    const snapshot = snapshotFor(studied, { dailyNewLimit: 0 });
    expect(snapshot.counts.total).toBe(0);
    expect(snapshot.nextCard).toBeUndefined();
    expect(snapshot.spotlight).toBeDefined();
    expect(snapshot.emptyStateCaption).toMatch(/All clear/);
  });

  it('picks the least recently seen card as the spotlight', () => {
    const studied = cards
      .filter((card) => card.kind === 'recognition')
      .map((card, index) => ({
        ...card,
        state: 'review' as const,
        stability: 20,
        difficulty: 5,
        reps: 3,
        lastReviewedAt: addDays(NOW, -index),
        due: addDays(NOW, 10),
      }));

    const spotlight = pickSpotlight(studied, entries, NOW);
    expect(spotlight?.card.id).toBe(studied[studied.length - 1]!.id);
  });
});

describe('widget timeline', () => {
  const cards = generateCards(MANDARIN_SEED, ['hsk3-1'], { now: NOW });

  it('produces one entry per offset with non-overlapping validity windows', () => {
    const timeline = buildWidgetTimeline({
      now: NOW,
      profile,
      queue: buildStudyQueue({ now: NOW, profile, cards, entries }),
      streak: computeStreak([], NOW),
      readiness: computeExamReadiness(cards, profile, NOW),
      hourOffsets: [0, 2, 6],
    });

    expect(timeline.entries).toHaveLength(3);
    for (let index = 1; index < timeline.entries.length; index += 1) {
      const previous = timeline.entries[index - 1]!;
      const current = timeline.entries[index]!;
      expect(Date.parse(current.generatedAt)).toBeGreaterThan(Date.parse(previous.generatedAt));
      expect(previous.validUntil).toBe(current.generatedAt);
    }
  });

  it('reflects future counts when a queue projection is supplied', () => {
    // Cards due in four hours: the first entry should show nothing, a later one
    // should show them, which is the whole point of a timeline.
    const later = cards.map((card) => ({
      ...card,
      state: 'review' as const,
      stability: 5,
      difficulty: 5,
      reps: 2,
      lastReviewedAt: NOW,
      due: addDays(NOW, 4 / 24),
    }));

    const timeline = buildWidgetTimeline({
      now: NOW,
      profile,
      queue: buildStudyQueue({ now: NOW, profile, cards: later, entries }),
      streak: computeStreak([], NOW),
      readiness: computeExamReadiness(later, profile, NOW),
      hourOffsets: [0, 6],
      projectQueue: (at) => buildStudyQueue({ now: at, profile, cards: later, entries }),
    });

    expect(timeline.entries[0]!.counts.due).toBe(0);
    expect(timeline.entries[1]!.counts.due).toBeGreaterThan(0);
  });
});

describe('deep links', () => {
  it('round-trips a grade link', () => {
    const parsed = parseDeepLink(linkToGrade('zh-nihao:recognition', 3));
    expect(parsed).toEqual({ route: 'grade', cardId: 'zh-nihao:recognition', rating: 3 });
  });

  it('encodes card ids containing a colon', () => {
    expect(linkToGrade('zh-nihao:recognition', 1)).toContain('zh-nihao%3Arecognition');
  });

  it('emits web paths when asked, so the same routes work in the browser', () => {
    expect(linkToGrade('c1', 4, { web: true })).toBe('/grade?card=c1&rating=4');
  });

  it('rejects an unknown route and an out-of-range rating', () => {
    expect(parseDeepLink('languagesrs:///nonsense')).toBeUndefined();
    expect(parseDeepLink('languagesrs:///grade?card=c1&rating=9')?.rating).toBeUndefined();
  });
});

describe('pending widget gradings', () => {
  const cards = generateCards(MANDARIN_SEED, ['hsk3-1'], { now: NOW });

  it('replays gradings through the real scheduler and logs them as widget-sourced', () => {
    const target = cards[0]!;
    const result = applyPendingGrades(cards, [{ cardId: target.id, rating: 3, gradedAt: NOW }], { profile });

    expect(result.applied).toBe(1);
    expect(result.logs[0]!.source).toBe('widget');
    expect(result.updated.get(target.id)!.reps).toBe(1);
  });

  it('applies multiple gradings of one card in the order they were tapped', () => {
    const target = cards[0]!;
    const result = applyPendingGrades(
      cards,
      [
        { cardId: target.id, rating: 3, gradedAt: addDays(NOW, 0.002) },
        { cardId: target.id, rating: 3, gradedAt: NOW },
      ],
      { profile },
    );

    expect(result.applied).toBe(2);
    expect(result.updated.get(target.id)!.reps).toBe(2);
  });

  it('drops a grading the app has already superseded rather than rewinding memory state', () => {
    const target = cards[0]!;
    const alreadyGraded = gradeCard(target, 4, { now: addDays(NOW, 1) }).card;
    const pool = cards.map((card) => (card.id === target.id ? alreadyGraded : card));

    const result = applyPendingGrades(pool, [{ cardId: target.id, rating: 1, gradedAt: NOW }], { profile });

    expect(result.applied).toBe(0);
    expect(result.skipped[0]!.reason).toBe('stale');
  });

  it('reports gradings for cards that no longer exist instead of throwing', () => {
    const result = applyPendingGrades(cards, [{ cardId: 'gone:recognition', rating: 3, gradedAt: NOW }], { profile });
    expect(result.applied).toBe(0);
    expect(result.skipped[0]!.reason).toBe('card-not-found');
  });

  it('collapses exact duplicates, which a double-tapped widget button can produce', () => {
    const target = cards[0]!;
    const grade = { cardId: target.id, rating: 3 as const, gradedAt: NOW };
    const result = applyPendingGrades(cards, [grade, { ...grade }], { profile });
    expect(result.applied).toBe(1);
    expect(result.skipped[0]!.reason).toBe('duplicate');
  });
});
