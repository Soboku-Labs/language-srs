import { describe, expect, it } from 'vitest';
import type { ReviewLog } from '../types/review';
import {
  addGradeToSession,
  finishStudySession,
  formatDuration,
  groupLogsIntoSessions,
  startStudySession,
  summariseSessions,
  type StudySessionRecord,
} from './index';

const NOW = '2026-07-31T10:00:00.000Z';

function log(id: string, reviewedAt: string, overrides: Partial<ReviewLog> = {}): ReviewLog {
  return {
    id,
    cardId: 'zh-nihao:recognition',
    entryId: 'zh-nihao',
    reviewedAt,
    rating: 3,
    stateBefore: 'new',
    stateAfter: 'learning',
    stabilityBefore: 0,
    stabilityAfter: 1,
    difficultyBefore: 0,
    difficultyAfter: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    predictedRetrievability: 0.9,
    durationMs: 4_000,
    source: 'app',
    ...overrides,
  };
}

function record(overrides: Partial<StudySessionRecord> = {}): StudySessionRecord {
  return {
    id: 's1',
    languageCode: 'zh',
    startedAt: NOW,
    endedAt: NOW,
    reviewed: 10,
    recalled: 8,
    activeMs: 300_000,
    ...overrides,
  };
}

describe('recording a sitting', () => {
  it('accumulates cards, recalls and time', () => {
    let draft = startStudySession({ languageCode: 'zh', now: NOW, id: 's1' });
    draft = addGradeToSession(draft, 3, 4_000);
    draft = addGradeToSession(draft, 1, 9_000);
    draft = addGradeToSession(draft, 4, 2_000);

    const finished = finishStudySession(draft, '2026-07-31T10:05:00.000Z');
    expect(finished).toMatchObject({ reviewed: 3, recalled: 2, activeMs: 15_000 });
  });

  it('never mutates the draft it is given', () => {
    const draft = startStudySession({ languageCode: 'ja', now: NOW, id: 's1' });
    addGradeToSession(draft, 3, 1_000);
    expect(draft.reviewed).toBe(0);
  });

  /**
   * Opening the review screen, seeing what is there and backing out is not a
   * study session. Recording it would put zeroes through every average.
   */
  it('produces nothing for a sitting where no card was graded', () => {
    const draft = startStudySession({ languageCode: 'ko', now: NOW, id: 's1' });
    expect(finishStudySession(draft, NOW)).toBeUndefined();
  });

  it('caps a card left on screen while the learner answered the door', () => {
    let draft = startStudySession({ languageCode: 'vi', now: NOW, id: 's1' });
    draft = addGradeToSession(draft, 3, 45 * 60_000);
    expect(finishStudySession(draft, NOW)?.activeMs).toBe(120_000);
  });

  it('ignores a negative duration rather than subtracting study time', () => {
    let draft = startStudySession({ languageCode: 'zh', now: NOW, id: 's1' });
    draft = addGradeToSession(draft, 3, -5_000);
    expect(finishStudySession(draft, NOW)?.activeMs).toBe(0);
  });

  it('carries the device through, so an account reads across phones', () => {
    let draft = startStudySession({ languageCode: 'zh', now: NOW, id: 's1', device: 'iPhone' });
    draft = addGradeToSession(draft, 3, 1_000);
    expect(finishStudySession(draft, NOW)?.device).toBe('iPhone');
  });
});

describe('reconstructing sittings from logs', () => {
  const languageOf = () => 'zh' as const;

  it('groups reviews that run together into one sitting', () => {
    const sessions = groupLogsIntoSessions(
      [
        log('a', '2026-07-31T09:00:00.000Z'),
        log('b', '2026-07-31T09:04:00.000Z'),
        log('c', '2026-07-31T09:07:00.000Z'),
      ],
      { languageOf },
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ reviewed: 3, derived: true });
    expect(sessions[0]?.endedAt).toBe('2026-07-31T09:07:00.000Z');
  });

  it('splits on a gap longer than the threshold', () => {
    const sessions = groupLogsIntoSessions(
      [log('a', '2026-07-31T09:00:00.000Z'), log('b', '2026-07-31T09:40:00.000Z')],
      { languageOf },
    );
    expect(sessions).toHaveLength(2);
  });

  /**
   * Switching language switches the whole deck. Merging two languages into one
   * sitting would report a session that belongs to neither.
   */
  it('splits when the language changes, even with no gap', () => {
    const sessions = groupLogsIntoSessions(
      [log('a', '2026-07-31T09:00:00.000Z'), log('b', '2026-07-31T09:01:00.000Z', { cardId: 'ja-hon:recognition' })],
      { languageOf: (entry) => (entry.cardId.startsWith('ja') ? 'ja' : 'zh') },
    );
    expect(sessions.map((session) => session.languageCode)).toEqual(['zh', 'ja']);
  });

  it('skips logs whose card no longer exists rather than guessing a language', () => {
    const sessions = groupLogsIntoSessions([log('a', '2026-07-31T09:00:00.000Z')], {
      languageOf: () => undefined,
    });
    expect(sessions).toEqual([]);
  });

  it('sorts out-of-order logs before grouping them', () => {
    const sessions = groupLogsIntoSessions(
      [log('b', '2026-07-31T09:05:00.000Z'), log('a', '2026-07-31T09:00:00.000Z')],
      { languageOf },
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.startedAt).toBe('2026-07-31T09:00:00.000Z');
  });

  it('counts a lapse as reviewed but not recalled', () => {
    const sessions = groupLogsIntoSessions(
      [log('a', '2026-07-31T09:00:00.000Z', { rating: 1 }), log('b', '2026-07-31T09:01:00.000Z')],
      { languageOf },
    );
    expect(sessions[0]).toMatchObject({ reviewed: 2, recalled: 1 });
  });
});

describe('summarising sittings', () => {
  it('totals cards, recalls and accuracy across the window', () => {
    const summary = summariseSessions(
      [
        record({ id: 'a', startedAt: '2026-07-30T09:00:00.000Z', reviewed: 10, recalled: 8 }),
        record({ id: 'b', startedAt: '2026-07-31T09:00:00.000Z', reviewed: 10, recalled: 6 }),
      ],
      { now: NOW },
    );

    expect(summary.sessions).toBe(2);
    expect(summary.reviewed).toBe(20);
    expect(summary.accuracy).toBe(0.7);
    expect(summary.averageReviewed).toBe(10);
  });

  it('reports zero accuracy rather than dividing by nothing', () => {
    const summary = summariseSessions([], { now: NOW });
    expect(summary.accuracy).toBe(0);
    expect(summary.averageReviewed).toBe(0);
  });

  it('gives one bucket per day in the window, including empty ones', () => {
    const summary = summariseSessions([record()], { now: NOW, days: 7 });
    expect(summary.perDay).toHaveLength(7);
    expect(summary.perDay.filter((day) => day.sessions > 0)).toHaveLength(1);
    expect(summary.perDay[summary.perDay.length - 1]?.day).toBe('2026-07-31');
  });

  it('excludes sittings older than the window from the totals', () => {
    const summary = summariseSessions(
      [record({ id: 'old', startedAt: '2026-01-01T09:00:00.000Z' }), record({ id: 'new' })],
      { now: NOW, days: 7 },
    );
    expect(summary.sessions).toBe(1);
  });

  /**
   * The same rollover the streak uses. Two definitions of "day" in one app
   * produces a streak of 6 next to a chart with 7 bars and no way to tell which
   * is lying.
   */
  it('counts a small-hours sitting towards the day it started in', () => {
    const summary = summariseSessions([record({ startedAt: '2026-07-31T01:30:00.000Z' })], {
      now: NOW,
      days: 3,
      dayStartHour: 4,
    });
    const busy = summary.perDay.find((day) => day.sessions > 0);
    expect(busy?.day).toBe('2026-07-30');
  });

  it('finds the busiest sitting', () => {
    const summary = summariseSessions(
      [record({ id: 'a', reviewed: 5 }), record({ id: 'b', reviewed: 40 }), record({ id: 'c', reviewed: 12 })],
      { now: NOW },
    );
    expect(summary.longest?.id).toBe('b');
  });

  it('lists recent sittings newest first, capped', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      record({ id: `s${index}`, startedAt: new Date(Date.parse(NOW) - index * 3_600_000).toISOString() }),
    );
    const summary = summariseSessions(many, { now: NOW, recentLimit: 5 });
    expect(summary.recent).toHaveLength(5);
    expect(summary.recent[0]?.id).toBe('s0');
  });
});

describe('formatDuration', () => {
  it('says something honest about a very short sitting', () => {
    expect(formatDuration(20_000)).toBe('under a minute');
  });

  it('uses minutes below an hour and hours above it', () => {
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration(64 * 60_000)).toBe('1h 04m');
  });
});
