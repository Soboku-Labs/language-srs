import {
  SEED_ENTRIES,
  StudyEngine,
  STORAGE_KEYS,
  addDays,
  type KeyValueStore,
  type LanguageCode,
  type Rating,
} from '@language-srs/core';

/**
 * A few weeks of study, so the demo has something to show.
 *
 * The demo opens every account-only feature, and four of them work perfectly
 * well empty — a second language, importing a list, exporting, the writing
 * books. Progress does not. Retention per skill, the fortnight ahead and the
 * streak are all views of a review history, and with none they are a screen of
 * zeroes, which demonstrates nothing.
 *
 * ## Nothing here is a made-up number
 *
 * The tempting shortcut is to write plausible-looking values straight into
 * storage: a streak of 12, retention of 88%, a nice curve. That would be
 * inventing statistics about a learner who does not exist, and the moment one
 * of those figures is screenshotted it is a claim the product is making about
 * how well it works.
 *
 * So this grades real cards through the real engine at real past timestamps.
 * Every number the demo shows afterwards is computed by the same FSRS code
 * from the same review log as anybody's — the streak is a streak because
 * somebody studied on those days, and the retention is whatever those answers
 * actually produce. We choose the behaviour, not the results.
 *
 * ## The behaviour it imitates
 *
 * Someone three weeks in who is doing well but not perfectly, studies most
 * days and not every day, and has a second language they picked up later and
 * touch less. That last part is deliberate: the per-language progress row is
 * one of the things worth seeing, and it needs two languages that are
 * genuinely at different stages.
 */

/**
 * How far back the demo's history goes.
 *
 * Two weeks is long enough for a streak, a retention figure that is not noise,
 * and a forecast with something in it, which is the whole job — and short
 * enough that the demo is a deck somebody can take in rather than a wall.
 *
 * Not a performance limit, though the first version of this comment said it
 * was: three weeks "took 4.6 seconds" only because the measurement contained a
 * four-second sleep. Seeding is 140 reviews and lands in 300-500ms, measured
 * by waiting for the account to appear rather than by waiting a fixed time.
 */
const DAYS = 14;

/**
 * Which days were missed.
 *
 * An unbroken three weeks would be a better-looking demo and a worse one: real
 * study has gaps, the streak logic exists because of them, and a product
 * demonstrating a perfect record is quietly telling people what it expects of
 * them.
 *
 * The most recent gap is eight days back, so the streak on screen is eight
 * days: long enough to be worth showing, and arrived at by actually studying
 * on those days rather than by writing the number 8 somewhere.
 */
const SKIPPED = new Set([13, 9, 8]);

/**
 * How often an answer is wrong, as one in N.
 *
 * Deterministic rather than random, so two people looking at the demo see the
 * same thing and a screenshot stays true. Spread across the run rather than
 * clustered, so no single skill ends up looking broken.
 */
const WRONG_EVERY = 7;

/**
 * Mandarin from the start; Japanese picked up in the second week.
 *
 * The daily amounts are larger than they look like they need to be, and the
 * reason is a threshold rather than a taste: per-skill retention only counts
 * a skill once it has five *reviews* in the window, and a review means a card
 * coming back rather than a card being introduced. Studying nine a day mostly
 * introduced new cards, so several skills never cleared five and the "By
 * skill" section appeared or vanished depending on how FSRS's interval fuzz
 * happened to fall — a demo that was different for different people.
 *
 * At these amounts it is 299 reviews and the section is there on every run;
 * checked three times rather than once, because the thing being ruled out is
 * variance. Seeding still lands in 350-520ms.
 */
const PLAN: { code: LanguageCode; from: number; perDay: number }[] = [
  { code: 'zh', from: DAYS, perDay: 20 },
  { code: 'ja', from: 7, perDay: 8 },
];

/**
 * Fill a demo store, unless it has already been filled.
 *
 * Idempotent on purpose: somebody who leaves the demo and comes back should
 * find it as they left it, not reset — and re-seeding over their own poking
 * about would be the app overwriting what they just did.
 */
export async function seedDemoDeck(store: KeyValueStore): Promise<boolean> {
  const existing = await store.get(STORAGE_KEYS.logs);
  if (existing && existing !== '[]') return false;

  // Wound back, then walked forward. The engine reads this for every `now` it
  // is not given explicitly, including when it decides what is due.
  let clock = addDays(new Date().toISOString(), -DAYS);
  const engine = await StudyEngine.create({
    store,
    seedEntries: SEED_ENTRIES,
    clock: () => clock,
  });

  let answered = 0;

  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo -= 1) {
    clock = addDays(new Date().toISOString(), -daysAgo);
    if (SKIPPED.has(daysAgo)) continue;

    for (const { code, from, perDay } of PLAN) {
      if (daysAgo > from) continue;
      if (!engine.hasProfile(code)) await engine.setActiveLanguage(code);

      const queue = engine.getQueue({ code, now: clock });
      for (const { card } of queue.cards.slice(0, perDay)) {
        answered += 1;
        /*
         * Mostly Good, occasionally Again.
         *
         * Not Easy, ever: a deck graded Easy stretches its intervals so far
         * that the fortnight ahead comes back empty, and an empty forecast is
         * the one view this whole function exists to populate.
         */
        const rating: Rating = answered % WRONG_EVERY === 0 ? 1 : 3;
        await engine.grade(card.id, rating, { now: clock, source: 'app' });
      }
    }
  }

  // Left on Mandarin, which is the one with the longer history, so the demo
  // opens on the language that has the most to show.
  await engine.setActiveLanguage('zh');
  return true;
}
