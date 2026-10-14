import { PrefixedStore, type KeyValueStore } from '@language-srs/core';
import { webStore } from './storage';

/**
 * Who is using this browser.
 *
 * A local profile and nothing more. It names the learner, separates two people
 * sharing a laptop, and gives the storage a prefix — and it says exactly that
 * rather than implying a security property it does not have.
 *
 * ## Why this is not the core's problem
 *
 * The backend has accounts, and `@language-srs/core` has the validation rules
 * and response shapes for them. What it does not have is a client that signs in,
 * because signing in needs a transport and the core has none by design — it runs
 * in a browser, on two phones and inside two native widgets.
 *
 * So this is deliberately the *device* half only. Signing in to the server from
 * the web app needs a contract for `main`'s API, which does not exist yet, and
 * a password field with nothing behind it is a lie told to whoever types into
 * it. When that contract lands, an email provider goes beside this one and the
 * sign-in screen grows a form; nothing here has to change.
 */

const ACCOUNT_KEY = 'srs:v1:account';

export interface LocalAccount {
  id: string;
  displayName: string;
  createdAt: string;
}

/** A readable id, because it ends up in a storage prefix somebody may have to read. */
function newId(): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  return [...random].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadAccount(): Promise<LocalAccount | undefined> {
  const raw = await webStore.get(ACCOUNT_KEY);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as LocalAccount;
    return parsed.id ? parsed : undefined;
  } catch {
    // A corrupt record is not worth a crash on launch; the learner signs in
    // again and their deck is untouched, because the deck is stored separately.
    return undefined;
  }
}

export async function createAccount(displayName: string): Promise<LocalAccount> {
  const account: LocalAccount = {
    id: newId(),
    displayName: displayName.trim() || 'This device',
    createdAt: new Date().toISOString(),
  };

  await webStore.set(ACCOUNT_KEY, JSON.stringify(account));
  return account;
}

export async function signOutAccount(): Promise<void> {
  await webStore.remove(ACCOUNT_KEY);
}

/**
 * Where an account's study data lives.
 *
 * The first account on a device keeps the unprefixed keys. That is not tidiness
 * — it is the account a learner already has, and moving its keys on the first
 * launch after accounts shipped would have read to them as their progress being
 * deleted.
 */
export function storeFor(account: LocalAccount | undefined): KeyValueStore {
  if (!account) return webStore;

  const cached = stores.get(account.id);
  if (cached) return cached;

  const store = new PrefixedStore(webStore, `acct:${account.id}:`);
  stores.set(account.id, store);
  return store;
}

/** Memoised, so returning to an account does not remount the engine. */
const stores = new Map<string, KeyValueStore>();
