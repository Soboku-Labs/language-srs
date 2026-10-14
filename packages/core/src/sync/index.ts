import { STORAGE_KEYS } from '../engine';
import type { ReviewLog } from '../types/review';

/**
 * Merging two devices' state.
 *
 * `StateService` on the server stores an opaque blob behind an optimistic
 * revision check, and returns 409 with the current state "so the app can decide
 * rather than silently clobbering another device". This is that decision.
 *
 * ## What the alternatives lose
 *
 * Both obvious answers lose a learner's work, and it is worth being precise
 * about whose:
 *
 * - **Take the server's state** and this device's reviews since the last sync
 *   are gone — the evening you just spent studying on a train.
 * - **Overwrite with this device's** and the other device's are gone instead.
 *
 * Neither is acceptable for review logs, and neither is necessary: logs are
 * append-only with unique ids, so a union is always correct and nobody loses
 * anything. The conflict only exists for keys where two values describe the same
 * thing, and for those the server wins.
 *
 * ## The rules, per key
 *
 * - **Review logs: union by id.** The one thing here that cannot be recreated.
 *   Streaks, retention and the per-kind breakdown are all computed from them.
 * - **Cards: the server's copy.** They look derivable from the reviews and are
 *   not — `applyFuzz` spreads due dates with an RNG, so replaying the same
 *   reviews on two devices lands them a day or two apart with neither wrong.
 *   Somebody has to be the answer, and the server is the one every device
 *   reaches.
 * - **Everything else: the server's copy.** Profiles and settings are small, and
 *   a learner who changed their daily limit on their phone meant it.
 * - **A key only one side has is kept.** A server that has never seen imported
 *   vocabulary is not issuing an instruction to delete it.
 *
 * This is the reference implementation. `clients/kotlin` and `clients/swift`
 * mirror it rule for rule and test case for test case, because two apps that
 * resolved one conflict differently would produce two different accounts.
 */

export interface StateMergeResult {
  values: Record<string, string>;
  /** Reviews this device had that the server did not. */
  localOnlyReviews: number;
  /** Reviews the server had that this device did not. */
  remoteOnlyReviews: number;
}

export function mergeStateValues(
  local: Record<string, string>,
  remote: Record<string, string>,
): StateMergeResult {
  /*
   * Start from this device, then let the server overwrite.
   *
   * Starting from the server's values reads as the same thing and is not: a key
   * the server has never seen would simply vanish.
   */
  const values: Record<string, string> = { ...local, ...remote };

  const localLogs = parseLogs(local[STORAGE_KEYS.logs]);
  const remoteLogs = parseLogs(remote[STORAGE_KEYS.logs]);
  if (localLogs.length === 0 && remoteLogs.length === 0) {
    return { values, localOnlyReviews: 0, remoteOnlyReviews: 0 };
  }

  const byId = new Map<string, ReviewLog>();
  for (const log of remoteLogs) byId.set(log.id, log);
  const remoteIds = new Set(byId.keys());

  let localOnly = 0;
  for (const log of localLogs) {
    if (!remoteIds.has(log.id)) localOnly += 1;
    // Set, not skip: an id on both sides describes the same grading, so either
    // copy is correct.
    byId.set(log.id, log);
  }

  const localIds = new Set(localLogs.map((log) => log.id));
  const remoteOnly = [...remoteIds].filter((id) => !localIds.has(id)).length;

  // Ordered by when they happened, because everything computed from the log
  // reads it in order and two devices appending independently produce two
  // sequences that only interleave correctly once sorted.
  const ordered = [...byId.values()].sort((left, right) =>
    left.reviewedAt.localeCompare(right.reviewedAt),
  );

  values[STORAGE_KEYS.logs] = JSON.stringify(ordered);
  return { values, localOnlyReviews: localOnly, remoteOnlyReviews: remoteOnly };
}

/**
 * A corrupt log on either side is treated as empty rather than thrown.
 *
 * The alternative is an account that can never sync again, and the other side's
 * copy is probably intact.
 */
function parseLogs(raw: string | undefined): ReviewLog[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ReviewLog =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as ReviewLog).id === 'string' &&
        typeof (entry as ReviewLog).reviewedAt === 'string',
    );
  } catch {
    return [];
  }
}
