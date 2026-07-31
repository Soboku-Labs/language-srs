import { mergeStudySessions, type AccountState, type StudySessionRecord } from '@language-srs/core';
import { ApiError } from '../http/errors.ts';
import type { ServerStore } from '../store/types.ts';

/**
 * What an account carries between devices.
 *
 * Two different merge rules here, and the difference is the whole design:
 *
 * - **State is last-writer-wins, with a revision check.** The blob is the
 *   engine's own storage keys, which the server cannot interpret and must not
 *   try to. A client sends the revision it based its write on; if the stored
 *   revision has moved, the write is rejected with 409 and the current state, so
 *   the app can decide rather than silently clobbering another device.
 * - **Sittings are merged by id.** They are append-only and immutable once
 *   finished, so a union is always correct — and losing a session somebody
 *   actually sat through is the one outcome worth writing extra code to avoid.
 */
export class StateService {
  constructor(private readonly store: ServerStore) {}

  async get(userId: string): Promise<AccountState> {
    return (
      (await this.store.getState(userId)) ?? {
        revision: 0,
        updatedAt: new Date(0).toISOString(),
        device: '',
        values: {},
      }
    );
  }

  async put(
    userId: string,
    input: { baseRevision: number; device: string; values: Record<string, string> },
    now = new Date(),
  ): Promise<AccountState> {
    const current = await this.get(userId);

    if (input.baseRevision !== current.revision) {
      throw new StateConflictError(current);
    }

    const next: AccountState = {
      revision: current.revision + 1,
      updatedAt: now.toISOString(),
      device: input.device.slice(0, 60),
      values: input.values,
    };

    await this.store.putState(userId, next);
    return next;
  }

  async listStudySessions(userId: string): Promise<StudySessionRecord[]> {
    return this.store.listStudySessions(userId);
  }

  /** Fold uploaded sittings into what the account already has. */
  async addStudySessions(userId: string, incoming: StudySessionRecord[]): Promise<StudySessionRecord[]> {
    const existing = await this.store.listStudySessions(userId);
    const merged = mergeStudySessions(existing, incoming);
    await this.store.putStudySessions(userId, merged);
    return merged;
  }
}

/**
 * A rejected write, carrying the state to reconcile against.
 *
 * Subclassed rather than thrown as a plain `ApiError` so the route can attach
 * the current state to the body — a 409 that does not say what it conflicted
 * with leaves the client with nothing to do but guess.
 */
export class StateConflictError extends ApiError {
  constructor(readonly current: AccountState) {
    super(409, 'conflict', 'This account was updated on another device.');
  }
}
