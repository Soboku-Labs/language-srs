import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../engine';
import { mergeStateValues } from './index';

/**
 * The merge rules.
 *
 * The same cases as `clients/kotlin`'s `MergeTest` and `clients/swift`'s
 * `MergeTests`, assertion for assertion. Three apps that resolved one conflict
 * differently would produce three different accounts, and the cheapest way to
 * keep them honest is for all three suites to make the same claims.
 */

const log = (id: string, reviewedAt: string) =>
  JSON.stringify({ id, cardId: 'zh-nihao:recognition', reviewedAt, rating: 3 });

const logs = (...entries: string[]) => `[${entries.join(',')}]`;

const idsIn = (values: Record<string, string>): string[] =>
  (JSON.parse(values[STORAGE_KEYS.logs]!) as { id: string }[]).map((entry) => entry.id);

describe('mergeStateValues', () => {
  it('keeps reviews from both devices', () => {
    const merged = mergeStateValues(
      { [STORAGE_KEYS.logs]: logs(log('r_a', '2026-03-01T09:00:00.000Z')) },
      { [STORAGE_KEYS.logs]: logs(log('r_b', '2026-03-01T10:00:00.000Z')) },
    );

    // The whole point: a learner who studied on their laptop and their phone did
    // all of that work, and the server's 409 exists so neither half is dropped.
    expect(idsIn(merged.values)).toEqual(['r_a', 'r_b']);
    expect(merged.localOnlyReviews).toBe(1);
    expect(merged.remoteOnlyReviews).toBe(1);
  });

  it('orders the merged log by when reviews happened', () => {
    const merged = mergeStateValues(
      {
        [STORAGE_KEYS.logs]: logs(
          log('r_late', '2026-03-01T18:00:00.000Z'),
          log('r_early', '2026-03-01T08:00:00.000Z'),
        ),
      },
      { [STORAGE_KEYS.logs]: logs(log('r_mid', '2026-03-01T12:00:00.000Z')) },
    );

    expect(idsIn(merged.values)).toEqual(['r_early', 'r_mid', 'r_late']);
  });

  it('counts a review both devices have only once', () => {
    const shared = { [STORAGE_KEYS.logs]: logs(log('r_same', '2026-03-01T09:00:00.000Z')) };
    const merged = mergeStateValues(shared, shared);

    expect(idsIn(merged.values)).toEqual(['r_same']);
    expect(merged.localOnlyReviews).toBe(0);
    expect(merged.remoteOnlyReviews).toBe(0);
  });

  it("takes the server's cards rather than this device's", () => {
    const merged = mergeStateValues(
      { [STORAGE_KEYS.cards]: '[{"id":"c1","due":"2026-03-10T00:00:00.000Z"}]' },
      { [STORAGE_KEYS.cards]: '[{"id":"c1","due":"2026-03-14T00:00:00.000Z"}]' },
    );

    // Not the later date, not a merge — the server's, because fuzzed due dates
    // mean both are plausible and only one can be the answer.
    expect(merged.values[STORAGE_KEYS.cards]).toBe('[{"id":"c1","due":"2026-03-14T00:00:00.000Z"}]');
  });

  it('keeps a key only this device has', () => {
    const merged = mergeStateValues({ [STORAGE_KEYS.entries]: '[]' }, {});
    // A server that has never seen imported vocabulary must not be read as an
    // instruction to delete it.
    expect(merged.values[STORAGE_KEYS.entries]).toBe('[]');
  });

  it('survives a corrupt log on either side', () => {
    const good = logs(log('r_a', '2026-03-01T09:00:00.000Z'));

    expect(
      idsIn(mergeStateValues({ [STORAGE_KEYS.logs]: 'not json' }, { [STORAGE_KEYS.logs]: good }).values),
    ).toEqual(['r_a']);
    expect(
      idsIn(mergeStateValues({ [STORAGE_KEYS.logs]: good }, { [STORAGE_KEYS.logs]: '{}' }).values),
    ).toEqual(['r_a']);
  });

  it('drops entries that are not reviews rather than carrying them through', () => {
    // A half-written log should not become a card with no id that every later
    // sort and lookup has to tolerate.
    const merged = mergeStateValues(
      { [STORAGE_KEYS.logs]: '[{"nope":true},null,3]' },
      { [STORAGE_KEYS.logs]: logs(log('r_a', '2026-03-01T09:00:00.000Z')) },
    );
    expect(idsIn(merged.values)).toEqual(['r_a']);
  });

  it('leaves state alone when neither side has reviews', () => {
    const merged = mergeStateValues(
      { [STORAGE_KEYS.meta]: '{}' },
      { [STORAGE_KEYS.meta]: '{"activeLanguage":"ja"}' },
    );

    expect(merged.values[STORAGE_KEYS.meta]).toBe('{"activeLanguage":"ja"}');
    expect(merged.values[STORAGE_KEYS.logs]).toBeUndefined();
  });
});
