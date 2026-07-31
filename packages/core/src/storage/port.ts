/**
 * The one thing the domain needs from a platform: somewhere to put strings.
 *
 * Web has localStorage, native has AsyncStorage, the widget has an App Group
 * container, and tests have a Map. Rather than teach the domain about any of
 * them, everything goes through this port and each platform supplies an adapter.
 * That is what lets `@language-srs/core` stay free of React, React Native and
 * DOM imports, and be exercised in plain Node.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Optional; used only by maintenance helpers such as `clearAll`. */
  keys?(): Promise<string[]>;
}

export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.data.keys()];
  }
}

/**
 * A store that mirrors writes to a second store.
 *
 * Used on device to keep the App Group / SharedPreferences container the widget
 * reads in step with the app's own storage, without the app having to remember
 * to write twice. Reads always come from the primary; a failing mirror is
 * reported rather than thrown, because a widget that is briefly out of date is a
 * much smaller problem than a review that fails to save.
 */
export class MirroringStore implements KeyValueStore {
  constructor(
    private readonly primary: KeyValueStore,
    private readonly mirror: KeyValueStore,
    private readonly options: { keys?: (key: string) => boolean; onMirrorError?: (error: unknown) => void } = {},
  ) {}

  private shouldMirror(key: string): boolean {
    return this.options.keys ? this.options.keys(key) : true;
  }

  async get(key: string): Promise<string | null> {
    return this.primary.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.primary.set(key, value);
    if (!this.shouldMirror(key)) return;
    try {
      await this.mirror.set(key, value);
    } catch (error) {
      this.options.onMirrorError?.(error);
    }
  }

  async remove(key: string): Promise<void> {
    await this.primary.remove(key);
    if (!this.shouldMirror(key)) return;
    try {
      await this.mirror.remove(key);
    } catch (error) {
      this.options.onMirrorError?.(error);
    }
  }

  async keys(): Promise<string[]> {
    return this.primary.keys?.() ?? [];
  }
}

/**
 * A store that lives inside a prefix.
 *
 * How two people sharing a device keep separate decks. The engine writes the
 * same keys it always has — `srs:v1:cards` and the rest — and this puts them
 * under `acct:<user>:` without the domain knowing accounts exist.
 *
 * The empty prefix is meaningful: it is the signed-out learner, whose data sits
 * exactly where it did before accounts were added. That is not a special case
 * for tidiness, it is the upgrade path — anyone who studied before signing up
 * finds their cards where they left them.
 */
export class PrefixedStore implements KeyValueStore {
  constructor(
    private readonly inner: KeyValueStore,
    private readonly prefix: string,
  ) {}

  private full(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get(key: string): Promise<string | null> {
    return this.inner.get(this.full(key));
  }

  async set(key: string, value: string): Promise<void> {
    await this.inner.set(this.full(key), value);
  }

  async remove(key: string): Promise<void> {
    await this.inner.remove(this.full(key));
  }

  /** Only this namespace's keys, with the prefix stripped back off. */
  async keys(): Promise<string[]> {
    const all = (await this.inner.keys?.()) ?? [];
    if (this.prefix === '') return all;
    return all.filter((key) => key.startsWith(this.prefix)).map((key) => key.slice(this.prefix.length));
  }
}

/** The storage prefix for an account, or the empty prefix when signed out. */
export function accountPrefix(userId?: string): string {
  return userId ? `acct:${userId}:` : '';
}

export async function readJson<T>(store: KeyValueStore, key: string, fallback: T): Promise<T> {
  const raw = await store.get(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt value: prefer the fallback over crashing at launch. The next write
    // replaces it.
    return fallback;
  }
}

export async function writeJson(store: KeyValueStore, key: string, value: unknown): Promise<void> {
  await store.set(key, JSON.stringify(value));
}
