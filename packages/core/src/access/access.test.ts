import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_HISTORY_DAYS,
  FEATURES,
  canUse,
  featuresUnlockedBy,
  tierFor,
  tierReaches,
  type FeatureId,
} from './index';

describe('who can use what', () => {
  it('never puts studying behind anything', () => {
    // The one rule that must not be quietly relaxed later. An SRS that asks
    // for an email before the first review is a worse SRS.
    expect(canUse('study', 'anonymous')).toBe(true);
    expect(FEATURES.study.requires).toBe('anonymous');
  });

  it('includes every lower tier', () => {
    expect(tierReaches('paid', 'account')).toBe(true);
    expect(tierReaches('account', 'anonymous')).toBe(true);
    expect(tierReaches('anonymous', 'account')).toBe(false);
    // Paying must never lose somebody a feature they already had.
    for (const id of Object.keys(FEATURES) as FeatureId[]) {
      if (canUse(id, 'account')) expect(canUse(id, 'paid')).toBe(true);
      if (canUse(id, 'anonymous')) expect(canUse(id, 'account')).toBe(true);
    }
  });

  it('reads the tier off who is signed in', () => {
    expect(tierFor({ signedIn: false })).toBe('anonymous');
    expect(tierFor({ signedIn: true })).toBe('account');
    expect(tierFor({ signedIn: true, paid: true })).toBe('paid');
  });

  it('leaves a first week of history to somebody with no account', () => {
    // Taking the streak away to drive sign-ups would be charging for the thing
    // that makes the first few sessions feel like they went somewhere.
    expect(ANONYMOUS_HISTORY_DAYS).toBeGreaterThan(0);
  });

  it('lists what an account is actually worth', () => {
    const unlocked = featuresUnlockedBy('account');
    expect(unlocked.map((feature) => feature.id)).toContain('sync');
    expect(unlocked.map((feature) => feature.id)).toContain('multipleLanguages');
    // Never advertises something free as a reason to sign up.
    expect(unlocked.map((feature) => feature.id)).not.toContain('study');
    // Nor something that does not exist yet.
    expect(unlocked.map((feature) => feature.id)).not.toContain('books');
  });

  it('gives every feature words a learner could read', () => {
    for (const feature of Object.values(FEATURES)) {
      expect(feature.name.length).toBeGreaterThan(0);
      expect(feature.line.length).toBeGreaterThan(0);
      // Sentence case, not a shouty label.
      expect(feature.name).not.toBe(feature.name.toUpperCase());
    }
  });
});
