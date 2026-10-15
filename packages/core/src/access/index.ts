/**
 * What is available to whom.
 *
 * The ask was for parts of the app to sit behind something that is not a
 * paywall — an account, free to make — so that people who are getting value
 * are reachable rather than anonymous. That is a reasonable thing to want and
 * a very easy thing to do badly, so the rules are written down here rather
 * than spread across the screens that enforce them.
 *
 * ## The line
 *
 * **Studying one language is free, needs no account, and never asks.** That is
 * not generosity, it is the product: an SRS that interrupts a review session
 * to ask for an email is a worse SRS, and somebody who has not yet studied
 * anything has no reason to sign up. The gate goes where a learner has already
 * decided this is worth keeping — a second language, their own word lists, the
 * history that only matters once there is some.
 *
 * Every gate must therefore be **reached, not hit**. A locked feature is shown,
 * named, and explains what it would do; it is never a dialog over the thing
 * somebody was already doing. If a rule here would interrupt a review, the rule
 * is wrong.
 *
 * ## Why tiers and not a boolean
 *
 * Today there are two states: anonymous, and signed in. There will be a third —
 * practice books are planned, and scanning them is planned after that — and the
 * difference between `signedIn: boolean` and a tier is the difference between
 * adding a case and rewriting every call site. The paid tier exists in the type
 * and nothing is assigned to it yet, which is the point: when something is, it
 * is one line here and the screens already know how to render it.
 */

/** Who is asking. Ordered: each tier includes everything below it. */
export type AccessTier = 'anonymous' | 'account' | 'paid';

const ORDER: AccessTier[] = ['anonymous', 'account', 'paid'];

export type FeatureId =
  /** Reviewing, grading, grammar — the whole study loop, for one language. */
  | 'study'
  /** Studying more than one language at a time. */
  | 'multipleLanguages'
  /** Bringing your own word list in. */
  | 'importVocabulary'
  /** Taking your deck out, as JSON. */
  | 'exportVocabulary'
  /** Retention per skill, the forecast, and history beyond the last week. */
  | 'fullProgress'
  /** The writing books: character practice, a chapter at a time. */
  | 'writingBooks'
  /** Carrying the deck and its schedule between devices. */
  | 'sync'
  /** Practice books, and reading them in with the camera. Not built yet. */
  | 'books';

export interface Feature {
  id: FeatureId;
  /** The lowest tier that may use it. */
  requires: AccessTier;
  /** Shown on the lock. What they would get, in their words, not ours. */
  name: string;
  /** One line on why it is worth having. Never a threat. */
  line: string;
}

export const FEATURES: Record<FeatureId, Feature> = {
  study: {
    id: 'study',
    requires: 'anonymous',
    name: 'Studying',
    line: 'Reviews, grammar and the whole loop, for one language, with no account.',
  },
  multipleLanguages: {
    id: 'multipleLanguages',
    requires: 'account',
    name: 'More than one language',
    line: 'Keep separate decks, exams and schedules for as many languages as you study.',
  },
  importVocabulary: {
    id: 'importVocabulary',
    requires: 'account',
    name: 'Your own word lists',
    line: 'Bring in a class list, a textbook chapter or anything else as CSV.',
  },
  exportVocabulary: {
    id: 'exportVocabulary',
    requires: 'account',
    name: 'Backing up your deck',
    line: 'Take everything out as JSON, including your own notes, whenever you like.',
  },
  fullProgress: {
    id: 'fullProgress',
    requires: 'account',
    name: 'Your full progress',
    line: 'Retention for each skill, the fortnight ahead, and history that goes back further than a week.',
  },
  writingBooks: {
    id: 'writingBooks',
    requires: 'account',
    name: 'Writing practice',
    line: 'Character workbooks, a chapter at a time, with your place kept across your devices.',
  },
  sync: {
    id: 'sync',
    requires: 'account',
    name: 'Your other devices',
    line: 'The same deck and the same schedule on your phone, kept in step.',
  },
  books: {
    id: 'books',
    requires: 'paid',
    name: 'Practice books',
    line: 'Printed practice, and scanning your answers back in. Not built yet.',
  },
};

/**
 * How much history an anonymous learner sees.
 *
 * Not zero. A streak and the last week are what make the first few sessions
 * feel like they went somewhere, and taking those away to drive sign-ups would
 * be charging for the thing that makes the app work. What is behind the account
 * is the part that only means something after a month.
 */
export const ANONYMOUS_HISTORY_DAYS = 7;

export function tierFor({ signedIn, paid = false }: { signedIn: boolean; paid?: boolean }): AccessTier {
  if (paid) return 'paid';
  return signedIn ? 'account' : 'anonymous';
}

/** Whether `tier` reaches `required`. */
export function tierReaches(tier: AccessTier, required: AccessTier): boolean {
  return ORDER.indexOf(tier) >= ORDER.indexOf(required);
}

export function canUse(feature: FeatureId, tier: AccessTier): boolean {
  return tierReaches(tier, FEATURES[feature].requires);
}

/**
 * What a learner would gain by making an account, in the order worth listing.
 *
 * Derived from the table rather than written out again on the sign-in screen,
 * so a feature cannot be gated in one place and advertised as free in another.
 */
export function featuresUnlockedBy(tier: AccessTier): Feature[] {
  return ORDER.slice(0, ORDER.indexOf(tier) + 1).flatMap((step) =>
    Object.values(FEATURES).filter((feature) => feature.requires === step && step !== 'anonymous'),
  );
}
