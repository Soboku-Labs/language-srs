import {
  prunePushed,
  readJson,
  unpushedReviews,
  writeJson,
  type KeyValueStore,
  type MergeResult,
  type StudyEngine,
} from '@mon/core';
import { ConnectError } from '@connectrpc/connect';
import type { MonClient } from './client';
import { cardFromPb, entryFromPb, profileFromPb, reviewLogFromPb } from './decode';
import { languageFromPbStrict, ratingToPb } from './enums';
import * as pb from './gen/mon/v1/mon_pb';

/**
 * Sync: push what this device did, then take what the backend says.
 *
 * ## Why in this order, and never the other way
 *
 * Pull-then-push looks equivalent and loses work. The pull overwrites local
 * cards with the server's, and the server has not seen this device's reviews
 * yet — so the card a learner just graded is replaced by its pre-grading state,
 * and the push that follows applies the grading to a card the server already
 * moved on from. Push first and the server's answer already includes everything
 * this device knows.
 *
 * ## What it does not do
 *
 * It does not resolve conflicts, because there are none to resolve. Reviews are
 * append-only and uniquely identified, so merging them is a set union; cards are
 * taken from the server outright, because the scheduler fuzzes due dates and a
 * client cannot reproduce them. Both rules live in `@mon/core/sync` with the
 * reasoning; this file is the transport around them.
 */

/** Where the pushed-review record and the pull cursor live, under the account's prefix. */
const SYNC_KEY = 'srs:v1:sync';

interface SyncRecord {
  /** Review log ids the backend has acknowledged. See `unpushedReviews`. */
  pushed: string[];
  /** Opaque cursor from the last pull. */
  cursor?: string;
  /** When the last complete sync finished, for showing the learner. */
  syncedAt?: string;
}

export interface SyncResult {
  pushed: number;
  /** Gradings the backend had already applied. A successful retry, not a failure. */
  duplicates: number;
  /** Gradings the backend refused — an unknown card, usually one deleted elsewhere. */
  rejected: { cardId: string; reason: string }[];
  merged: MergeResult;
  syncedAt: string;
}

export interface SyncOptions {
  client: MonClient;
  engine: StudyEngine;
  /** The account-scoped store, so two accounts on one device keep separate cursors. */
  store: KeyValueStore;
  /**
   * Reviews per push, and reviews per pull page.
   *
   * A learner returning after a month offline has thousands; one request with
   * all of them is a request that times out and then retries with all of them
   * again.
   */
  batchSize?: number;
}

const DEFAULT_BATCH = 250;

export async function sync(options: SyncOptions): Promise<SyncResult> {
  const { client, engine, store } = options;
  const batchSize = options.batchSize ?? DEFAULT_BATCH;

  const record = await readJson<SyncRecord>(store, SYNC_KEY, { pushed: [] });
  const pushed = new Set(record.pushed);

  // ------------------------------------------------------------------ push

  const outstanding = unpushedReviews(engine.getReviewLogs(), pushed);
  const rejected: SyncResult['rejected'] = [];
  let pushedCount = 0;
  let duplicates = 0;

  for (let at = 0; at < outstanding.length; at += batchSize) {
    const batch = outstanding.slice(at, at + batchSize);

    const response = await client.study.submitGrades({
      grades: batch.map((log) => ({
        id: log.id,
        cardId: log.cardId,
        rating: ratingToPb(log.rating),
        gradedAt: log.reviewedAt,
        durationMs: log.durationMs,
      })),
    });

    pushedCount += response.applied;
    duplicates += response.duplicates;
    for (const failure of response.failed) {
      rejected.push({ cardId: failure.cardId, reason: failure.reason });
    }

    /*
     * Every id in the batch is marked, including the rejected ones.
     *
     * A rejection is not a transient failure — it means the backend has no such
     * card, which happens when a word was deleted on another device. Retrying it
     * every sync forever would be a permanent error nobody can clear, so it is
     * reported once and then let go.
     */
    for (const log of batch) pushed.add(log.id);
  }

  // ------------------------------------------------------------------ pull

  const merged: MergeResult = { cards: 0, reviews: 0, entries: 0, profiles: 0 };
  let cursor = record.cursor;
  let more = true;
  let guard = 0;

  while (more) {
    // A cursor that does not advance would otherwise spin here forever, hammering
    // the backend. Bounded, and the next sync picks up where this one stopped.
    if (guard >= 100) break;
    guard += 1;

    const page = await client.study.pullState({
      ...(cursor ? { since: cursor } : {}),
      limit: batchSize,
    });

    const profiles = page.profiles.map((profile) => {
      const code = languageFromPbStrict(profile.languageCode);
      // The local record, where there is one, so `createdAt` is not reinvented
      // on every pull.
      const existing = engine.hasProfile(code) ? engine.getProfile(code) : undefined;
      return profileFromPb(profile, engine.now(), existing);
    });

    const result = await engine.applyRemoteState({
      cards: page.cards.map(cardFromPb),
      profiles,
      ...(page.activeLanguage !== pb.LanguageCode.UNSPECIFIED
        ? { activeLanguage: languageFromPbStrict(page.activeLanguage) }
        : {}),
      entries: page.entries.map(entryFromPb),
      reviews: page.reviews.map(reviewLogFromPb),
    });

    merged.cards += result.cards;
    merged.reviews += result.reviews;
    merged.entries += result.entries;
    merged.profiles += result.profiles;

    if (page.cursor === cursor) break;
    cursor = page.cursor;
    more = page.more;
  }

  // ----------------------------------------------------------------- record

  const syncedAt = engine.now();
  await writeJson(store, SYNC_KEY, {
    // Pruned to the reviews still held locally, so the record cannot outgrow the
    // log it describes once old reviews age out.
    pushed: [...prunePushed(pushed, engine.getReviewLogs())],
    ...(cursor ? { cursor } : {}),
    syncedAt,
  } satisfies SyncRecord);

  return { pushed: pushedCount, duplicates, rejected, merged, syncedAt };
}

/** When this device last completed a sync, for showing the learner. */
export async function lastSyncedAt(store: KeyValueStore): Promise<string | undefined> {
  return (await readJson<SyncRecord>(store, SYNC_KEY, { pushed: [] })).syncedAt;
}

/**
 * Forget the sync record.
 *
 * For signing out, and for "something is wrong, start again": dropping the
 * cursor makes the next pull ask for the whole history, which is the only repair
 * a client can perform on its own.
 */
export async function resetSyncRecord(store: KeyValueStore): Promise<void> {
  await store.remove(SYNC_KEY);
}

/** The message to show when a sync fails, from the code rather than the prose. */
export function describeSyncFailure(cause: unknown): string {
  const error = ConnectError.from(cause);
  return error.rawMessage || error.message;
}
