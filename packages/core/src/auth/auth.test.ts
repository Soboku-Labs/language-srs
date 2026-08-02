import { describe, expect, it } from 'vitest';
import type { StudySessionRecord } from '../sessions';
import { mergeStudySessions } from './sync';
import {
  PASSWORD_MIN_LENGTH,
  normaliseEmail,
  resolveDisplayName,
  validateEmail,
  validatePassword,
} from './types';

describe('email handling', () => {
  it('compares addresses case- and space-insensitively', () => {
    expect(normaliseEmail('  Learner@Example.COM ')).toBe('learner@example.com');
  });

  it('accepts ordinary addresses', () => {
    for (const email of ['a@b.co', 'learner+hsk@example.com', 'Học@example.vn']) {
      expect(validateEmail(email), email).toBeUndefined();
    }
  });

  it('rejects the typo class', () => {
    for (const email of ['', 'learner', 'learner@', '@example.com', 'a b@example.com', 'learner@example']) {
      expect(validateEmail(email), email).toBeDefined();
    }
  });

  it('rejects an address longer than the addressing standard allows', () => {
    expect(validateEmail(`${'a'.repeat(250)}@example.com`)).toBeDefined();
  });
});

describe('password rules', () => {
  it('accepts a long passphrase without composition rules', () => {
    expect(validatePassword('correct horse battery staple')).toBeUndefined();
  });

  it('rejects anything shorter than the stated minimum', () => {
    const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
    expect(validatePassword(short)).toMatch(new RegExp(String(PASSWORD_MIN_LENGTH)));
  });

  /** A slow hash handed a megabyte is a denial-of-service surface, not strength. */
  it('rejects an absurdly long password', () => {
    expect(validatePassword('a'.repeat(5_000))).toBeDefined();
  });

  it('rejects whitespace pretending to be a password', () => {
    expect(validatePassword('          ')).toBeDefined();
  });

  it('rejects a password that is just the email address', () => {
    expect(validatePassword('learner@example.com', 'Learner@Example.com')).toBeDefined();
  });

  it('states the rule it enforces, so the form can show the same one', () => {
    expect(validatePassword('short')).toContain(String(PASSWORD_MIN_LENGTH));
  });
});

describe('display names', () => {
  it('falls back to the local part of the email', () => {
    expect(resolveDisplayName(undefined, 'ha.eun@example.com')).toBe('ha.eun');
  });

  it('prefers what the learner typed', () => {
    expect(resolveDisplayName('  Ha-eun  ', 'x@example.com')).toBe('Ha-eun');
  });

  it('caps a name that would break every layout it appears in', () => {
    expect(resolveDisplayName('n'.repeat(500), 'x@example.com')).toHaveLength(60);
  });
});

describe('mergeStudySessions', () => {
  const session = (id: string, startedAt: string, extra: Partial<StudySessionRecord> = {}): StudySessionRecord => ({
    id,
    languageCode: 'zh',
    startedAt,
    endedAt: startedAt,
    reviewed: 5,
    recalled: 4,
    activeMs: 60_000,
    ...extra,
  });

  it('unions two histories and orders them oldest first', () => {
    const merged = mergeStudySessions(
      [session('b', '2026-07-02T09:00:00.000Z')],
      [session('a', '2026-07-01T09:00:00.000Z')],
    );
    expect(merged.map((record) => record.id)).toEqual(['a', 'b']);
  });

  it('does not duplicate a sitting already held', () => {
    const existing = [session('a', '2026-07-01T09:00:00.000Z')];
    expect(mergeStudySessions(existing, existing)).toHaveLength(1);
  });

  /**
   * A recorded sitting knows when the learner sat down; a reconstructed one only
   * knows when they graded. When both exist for the same id, the real one wins.
   */
  it('lets a recorded sitting replace a derived one, but not the reverse', () => {
    const derived = session('a', '2026-07-01T09:05:00.000Z', { derived: true });
    const recorded = session('a', '2026-07-01T09:00:00.000Z');

    expect(mergeStudySessions([derived], [recorded])[0]?.derived).toBeUndefined();
    expect(mergeStudySessions([recorded], [derived])[0]?.derived).toBeUndefined();
  });

  it('leaves the inputs untouched', () => {
    const existing = [session('a', '2026-07-01T09:00:00.000Z')];
    mergeStudySessions(existing, [session('b', '2026-07-02T09:00:00.000Z')]);
    expect(existing).toHaveLength(1);
  });
});
