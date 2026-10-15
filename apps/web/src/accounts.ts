import {
  PrefixedStore,
  STORAGE_KEYS,
  SYNCED_STORAGE_KEYS,
  type KeyValueStore,
} from '@language-srs/core';
import { webStore } from './storage';

/**
 * Who is using this browser.
 *
 * Two kinds of account, and the difference is what happens when you open the app
 * somewhere else:
 *
 * - **A device profile** names whoever is sitting here and separates two people
 *   sharing a laptop. Nothing leaves the browser. It says exactly that rather
 *   than implying a security property it does not have.
 * - **An account** is the same thing plus a server, so the deck, every card's
 *   schedule and the whole review history follow you to your phone.
 *
 * The device profile is not a lesser option. For somebody studying on one
 * machine it is the right one, and the app is complete without ever signing in.
 *
 * There is a third, which is not a way of using the app but a way of looking at
 * it: **the demo**. It opens the account-only features so somebody can see what
 * an account is for before making one. It exists entirely in this browser —
 * there is no demo user on the server, nothing is sent anywhere, and the only
 * thing it has in common with an account is which parts of the UI are
 * reachable. See `createDemoAccount`.
 */

const ACCOUNT_KEY = 'srs:v1:account';

export interface StoredAccount {
  id: string;
  displayName: string;
  createdAt: string;
  /** A look around rather than an account. See `createDemoAccount`. */
  demo?: true;
  /** Present for a server account; absent for a device profile. */
  email?: string;
  /** The bearer token, for a server account. */
  token?: string;
  /** When the token stops being accepted. */
  expiresAt?: string;
}

/** Whether this account's progress is carried off the device. */
export const isRemote = (account: StoredAccount | undefined): boolean => Boolean(account?.token);

/** Whether this is the demo rather than somebody's own profile. */
export const isDemo = (account: StoredAccount | undefined): boolean => account?.demo === true;

/**
 * A fixed id, so the demo is one sandbox rather than a new one per visit.
 *
 * Also why it is readable: it ends up as a storage prefix, and somebody
 * looking at their own browser storage should be able to tell at a glance
 * which slice is the demo and which is theirs.
 */
export const DEMO_ACCOUNT_ID = 'demo';

/**
 * A look around, with the account-only features open.
 *
 * Most of what an account unlocks cannot be described, only used — a second
 * language, importing a word list, the writing books. Asking somebody to make
 * an account to find out whether they want one is the wrong way round.
 *
 * **There is no demo user on the server, in production or anywhere else.** It
 * is not a credential: nothing is registered, no password exists, and nothing
 * can be signed in as. It is this browser deciding to show the whole UI, which
 * is a decision about rendering rather than about authentication. That is also
 * why it cannot be abused — there is nothing to abuse, only a local flag that
 * grants no access to any server resource.
 *
 * It gets its own storage slice, so looking around does not touch the deck
 * somebody has been building on this device, and leaving does not take
 * anything of theirs with it.
 *
 * `token` is deliberately absent, so `isRemote` is false and the sync layer
 * stays switched off. The demo never talks to a server, which is the honest
 * behaviour: there is no account for it to sync to.
 */
export async function createDemoAccount(): Promise<StoredAccount> {
  return saveAccount({
    id: DEMO_ACCOUNT_ID,
    displayName: 'Demo',
    createdAt: new Date().toISOString(),
    demo: true,
  });
}

/** A readable id, because it ends up in a storage prefix somebody may have to read. */
function newId(): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  return [...random].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadAccount(): Promise<StoredAccount | undefined> {
  const raw = await webStore.get(ACCOUNT_KEY);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as StoredAccount;
    return parsed.id ? parsed : undefined;
  } catch {
    // A corrupt record is not worth a crash on launch; the learner signs in
    // again and their deck is untouched, because the deck is stored separately.
    return undefined;
  }
}

export async function saveAccount(account: StoredAccount): Promise<StoredAccount> {
  await webStore.set(ACCOUNT_KEY, JSON.stringify(account));
  return account;
}

export async function createDeviceAccount(displayName: string): Promise<StoredAccount> {
  return saveAccount({
    id: newId(),
    displayName: displayName.trim() || 'This device',
    createdAt: new Date().toISOString(),
  });
}

export async function forgetAccount(): Promise<void> {
  await webStore.remove(ACCOUNT_KEY);
}

/**
 * Where an account's study data lives.
 *
 * Keyed by account id, so two people on one laptop keep separate decks — and so
 * signing out and back in finds the same deck rather than an empty one.
 *
 * A server account is prefixed by its *server* id, which is what makes the same
 * account on two browsers resolve to the same slice: the deck that syncs down
 * lands where the deck that syncs up came from.
 */
export function storeFor(account: StoredAccount | undefined): KeyValueStore {
  if (!account) return webStore;

  const cached = stores.get(account.id);
  if (cached) return cached;

  const store = new PrefixedStore(webStore, `acct:${account.id}:`);
  stores.set(account.id, store);
  return store;
}

/** Memoised, so returning to an account does not remount the engine. */
const stores = new Map<string, KeyValueStore>();

/**
 * Carry work done before signing in into the account that now owns it.
 *
 * The app can be used without an account, which means somebody can study for a
 * week and then decide to sign in. An account keeps its deck under its own
 * prefix, so without this that week would simply stop being visible: still on
 * disk, under a prefix nothing looks at any more, which to the person who
 * studied it is indistinguishable from having been deleted by signing in.
 *
 * Two conditions, both narrow on purpose:
 *
 * - **Only from a deck with no other home.** A device profile, or no account at
 *   all. Never from one signed-in account into another — that deck belongs
 *   somewhere and is waiting on its own server.
 * - **Only into an empty one.** If the account already has cards here, it has
 *   been used in this browser before and its own state is the truth.
 *
 * What lands on the server afterwards is then the ordinary sync: this writes
 * locally, the engine mounts on it, and the first push either creates the
 * account's state or conflicts and merges with what is already there.
 */
export async function adoptDeck(from: KeyValueStore, to: KeyValueStore): Promise<number> {
  const existing = await to.get(STORAGE_KEYS.cards);
  if (existing && existing !== '[]') return 0;

  let carried = 0;
  for (const key of SYNCED_STORAGE_KEYS) {
    const value = await from.get(key);
    if (value === null) continue;
    await to.set(key, value);
    if (key === STORAGE_KEYS.logs) carried = countReviews(value);
  }
  return carried;
}

/** How much was carried, for saying so. Never worth a throw. */
function countReviews(raw: string): number {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
