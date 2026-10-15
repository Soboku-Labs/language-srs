import { PrefixedStore, type KeyValueStore } from '@language-srs/core';
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
 */

const ACCOUNT_KEY = 'srs:v1:account';

export interface StoredAccount {
  id: string;
  displayName: string;
  createdAt: string;
  /** Present for a server account; absent for a device profile. */
  email?: string;
  /** The bearer token, for a server account. */
  token?: string;
  /** When the token stops being accepted. */
  expiresAt?: string;
}

/** Whether this account's progress is carried off the device. */
export const isRemote = (account: StoredAccount | undefined): boolean => Boolean(account?.token);

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
