import type { KeyValueStore } from '@language-srs/core';

/**
 * The storage port, backed by localStorage.
 *
 * The Expo app went through AsyncStorage so one adapter could serve three
 * platforms. A web app has no such obligation: localStorage is synchronous and
 * present, and the port's promises are satisfied trivially.
 *
 * Writes are guarded. A browser in private mode, or one with site data blocked,
 * throws on `setItem` rather than returning an error, and an unhandled throw
 * there would reach the learner as a crash mid-session.
 *
 * ## A failed write is reported, not swallowed
 *
 * Guarding it is not enough, and for a while this file did only that. With the
 * origin at its quota a learner can grade card after card — the engine's
 * in-memory state advances, the queue counts down, every screen looks right —
 * and nothing is persisted. Reloading loses the session with no indication it
 * was ever at risk. Measured: eight graded cards, zero written, two console
 * warnings nobody reads.
 *
 * So the write still does not throw, because an SRS that crashes mid-review is
 * worse than one that cannot save, but it now tells somebody. `onWriteFailed`
 * is what the app subscribes to in order to say so out loud.
 */

/**
 * The outcome of a write.
 *
 * Both outcomes are reported, not just the failures, because the interesting
 * question is not "did something once fail" but "are writes landing now". A
 * full origin is a condition that lifts — removing words, or another tab of the
 * same site releasing its data, makes room again.
 *
 * Reporting the successes is what removes the need to guess. The obvious
 * alternative, probing with a throwaway `setItem`, is wrong in a way that is
 * easy to miss and was caught here only by measurement: a probe writes a few
 * bytes where a real write is hundreds of kilobytes, so it succeeds against an
 * origin with no room for anything that matters and reports a recovery that
 * has not happened. The app's own writes are the only honest test of whether
 * the app's writes work.
 */
export interface WriteOutcome {
  key: string;
  ok: boolean;
  /** The browser's reason, when it refused. */
  cause?: unknown;
}

type WriteListener = (outcome: WriteOutcome) => void;

const listeners = new Set<WriteListener>();

/** Subscribe to write outcomes. Returns the unsubscribe. */
export function onWrite(listener: WriteListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function report(outcome: WriteOutcome): void {
  if (!outcome.ok) {
    // Still logged: a developer looking at a console deserves the detail, and
    // the learner-facing message deliberately carries none of it.
    console.warn('mon: could not persist', outcome.key, outcome.cause);
  }
  for (const listener of listeners) {
    try {
      listener(outcome);
    } catch {
      // A broken listener must not turn a write into a failed render.
    }
  }
}

export const webStore: KeyValueStore = {
  async get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value);
      report({ key, ok: true });
    } catch (cause) {
      report({ key, ok: false, cause });
    }
  },
  async remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing useful to do; the value is already unreachable.
    }
  },
  async keys() {
    try {
      return Object.keys(localStorage);
    } catch {
      return [];
    }
  },
};
