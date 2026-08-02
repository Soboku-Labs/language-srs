import type { Timestamp } from '../types/card';
import type { StudySessionRecord } from '../sessions';

/**
 * What an account carries between devices.
 *
 * The server stores the learner's state as an opaque bag of storage keys rather
 * than as a schema of its own. That is a deliberate limitation, and the reason
 * for it is that the schema already exists, in `engine.ts`, and is versioned
 * there — teaching the server about cards and FSRS stability would mean every
 * change to the domain needing a matching migration on a service that has no
 * opinion about any of it. The server's job is to hold bytes for a user and to
 * say which copy is newer.
 *
 * The consequence, stated plainly because it decides how the app behaves:
 * **this is last-writer-wins at whole-account granularity.** Two devices used
 * offline in the same period will not merge; the one that syncs second wins for
 * everything except study sessions, which are merged by id because they are
 * append-only and losing a sitting somebody actually did is the one outcome
 * worth writing extra code to avoid.
 */
export interface AccountState {
  /**
   * Increments on every accepted write.
   *
   * A client sends the revision it based its write on; a mismatch is a conflict
   * rather than a silent overwrite, so the app can decide what to do with the
   * knowledge that somebody else moved first.
   */
  revision: number;
  updatedAt: Timestamp;
  /** The device that wrote this revision, for the account screen. */
  device: string;
  /** Engine storage keys to their serialised values. Opaque to the server. */
  values: Record<string, string>;
}

/** A state write. `baseRevision` is the revision the client last saw. */
export interface PutStateRequest {
  baseRevision: number;
  device: string;
  values: Record<string, string>;
}

export interface PutStateResponse {
  revision: number;
  updatedAt: Timestamp;
}

/**
 * Rejected write, with the state the client should reconcile against.
 *
 * Returned with 409 rather than 200-and-a-flag: a write that did not happen
 * should not look like one that did.
 */
export interface StateConflict {
  error: 'conflict';
  message: string;
  current: AccountState;
}

export interface StudySessionsResponse {
  sessions: StudySessionRecord[];
}

/**
 * Merge two sets of sittings by id, newest wins on a tie.
 *
 * Used on both sides: the server folds an upload into what it has, and the app
 * folds a download into what it has. Sittings are append-only and immutable
 * once finished, so "merge" is really "union" — but doing it in one tested
 * function beats two implementations that disagree about duplicates.
 */
export function mergeStudySessions(
  existing: StudySessionRecord[],
  incoming: StudySessionRecord[],
): StudySessionRecord[] {
  const byId = new Map<string, StudySessionRecord>();
  for (const record of existing) byId.set(record.id, record);

  for (const record of incoming) {
    const current = byId.get(record.id);
    // A recorded sitting always beats a derived one: it knows when the learner
    // actually sat down, where reconstruction only knows when they graded.
    if (!current || (current.derived && !record.derived)) {
      byId.set(record.id, record);
    }
  }

  return [...byId.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}
