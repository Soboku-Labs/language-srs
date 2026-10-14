import type { Card, LexicalEntry, StudyProfile } from '../types/card';
import type { LanguageCode } from '../types/language';
import type { ReviewLog } from '../types/review';

/**
 * Sync, as the domain sees it.
 *
 * The types here describe what moves between a device and the backend. The
 * transport does not belong in this package — `packages/api` owns that — but the
 * *shape* does, because what is safe to merge is a domain question and getting
 * it wrong loses a learner's history.
 *
 * ## Which side wins, and why it differs per kind of state
 *
 * - **Cards: the server wins, wholesale.** Card state looks like a pure function
 *   of the reviews applied to it, which tempts you into replaying the log on each
 *   device and skipping the transfer. It is not pure: `applyFuzz` spreads due
 *   dates with an RNG so a hundred cards learned on one evening do not all come
 *   back on one evening. Two devices replaying the same reviews land a day or two
 *   apart, forever, with neither of them wrong. One of them has to be the answer,
 *   and the one every device can reach is the server.
 *
 * - **Reviews: union, by id.** Append-only and uniquely identified, so merging is
 *   a set union with no conflict to resolve. They matter because streaks,
 *   retention and the per-kind breakdown are computed from them — a device
 *   holding only its own half would under-report a learner's streak, which is
 *   the one number in the app people care about being wrong.
 *
 * - **Imported entries: union, server's copy wins on a tie.** This is the part
 *   of a deck that is genuinely lost with a device: seed vocabulary ships in the
 *   app, but a word list the learner imported exists nowhere else.
 *
 * - **Profiles: the server wins.** Exam date and daily limits are small, and a
 *   learner who changed them on their phone meant it.
 */
export interface RemoteState {
  cards: Card[];
  profiles: StudyProfile[];
  activeLanguage?: LanguageCode;
  entries: LexicalEntry[];
  reviews: ReviewLog[];
}

export interface MergeResult {
  /** Cards replaced by the server's copy. */
  cards: number;
  /** Reviews the device did not have. */
  reviews: number;
  entries: number;
  profiles: number;
}

/**
 * Merge remote state into local state.
 *
 * Pure, and separate from the engine, so the merge rules can be tested against
 * handmade inputs rather than by driving two engines through a server. The engine
 * calls this and then persists.
 */
export function mergeRemoteState(
  local: { cards: Card[]; logs: ReviewLog[]; entries: LexicalEntry[] },
  remote: RemoteState,
): {
  cards: Card[];
  logs: ReviewLog[];
  entries: LexicalEntry[];
  result: MergeResult;
} {
  const cards = new Map(local.cards.map((card) => [card.id, card]));
  let replaced = 0;
  for (const card of remote.cards) {
    replaced += 1;
    cards.set(card.id, card);
  }

  /*
   * Reviews the device has and the server does not are kept rather than dropped.
   *
   * A pull can arrive before a push succeeds — a flaky connection, or a crash
   * between the two — and discarding what is only local would quietly delete
   * reviews the learner did. They are pushed on the next attempt, and in the
   * meantime they count towards the streak, which is the honest answer.
   */
  const logs = new Map(local.logs.map((log) => [log.id, log]));
  let newReviews = 0;
  for (const review of remote.reviews) {
    if (!logs.has(review.id)) newReviews += 1;
    logs.set(review.id, review);
  }

  const entries = new Map(local.entries.map((entry) => [entry.id, entry]));
  let newEntries = 0;
  for (const entry of remote.entries) {
    if (!entries.has(entry.id)) newEntries += 1;
    entries.set(entry.id, entry);
  }

  return {
    cards: [...cards.values()],
    // Sorted by when they happened, because everything computed from the log —
    // streaks, retention windows, the undo stack — reads it in order.
    logs: [...logs.values()].sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt)),
    entries: [...entries.values()],
    result: {
      cards: replaced,
      reviews: newReviews,
      entries: newEntries,
      profiles: remote.profiles.length,
    },
  };
}

/**
 * The reviews a device has not pushed yet.
 *
 * ## Why this is a set of ids and not a high-water mark
 *
 * A timestamp mark is the obvious design and it loses reviews. The log is
 * appended in the order gradings are *applied*, which is not the order they
 * happened: a home-screen widget tap is recorded offline and replayed later with
 * its original instant, so a review from three hours ago can land in the log
 * after the mark has moved past it. Under a mark, that review is "already
 * pushed" and is never sent — it is simply gone, and nothing reports it.
 *
 * So: ids. Bounded by the local log, which is already capped, and pruned to it
 * on every pass so the record cannot outgrow the thing it describes.
 *
 * `Grade.id` makes this a safety net rather than a load-bearing guess — a
 * duplicate push is recognised and reported, not counted twice — but the point
 * is to not need rescuing.
 */
export function unpushedReviews(logs: ReviewLog[], pushed: ReadonlySet<string>): ReviewLog[] {
  return logs.filter((log) => !pushed.has(log.id));
}

/**
 * The pushed-id record, trimmed to the reviews still held locally.
 *
 * Logs are dropped oldest-first once past the retention cap, and an id set that
 * kept growing after them would be a slow leak in the one place a browser gives
 * you five megabytes.
 */
export function prunePushed(pushed: Iterable<string>, logs: ReviewLog[]): Set<string> {
  const live = new Set(logs.map((log) => log.id));
  const kept = new Set<string>();
  for (const id of pushed) if (live.has(id)) kept.add(id);
  return kept;
}
