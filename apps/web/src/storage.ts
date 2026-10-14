import type { KeyValueStore } from '@mon/core';

/**
 * The storage port, backed by localStorage.
 *
 * The Expo app went through AsyncStorage so one adapter could serve three
 * platforms. A web app has no such obligation: localStorage is synchronous and
 * present, and the port's promises are satisfied trivially.
 *
 * Writes are guarded. A browser in private mode, or one with site data blocked,
 * throws on `setItem` rather than returning an error, and an unhandled throw
 * there would surface to the learner as a review that failed to save.
 */
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
    } catch (cause) {
      // Quota exceeded is worth surfacing — it means the deck has outgrown the
      // origin's allowance and the next write will lose data.
      console.warn('mon: could not persist', key, cause);
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
