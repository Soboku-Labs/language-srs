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
 * A store that prefixes every key.
 *
 * This is what keeps two accounts on one device from reading each other's decks.
 * Namespacing at the store rather than at each call site means the engine never
 * learns that accounts exist — it asks for `srs:v1:cards` as it always did, and
 * which cards that resolves to is decided once, at wiring time.
 *
 * `passthrough` exempts keys that are deliberately global. The widget snapshot is
 * the one that matters: the home screen shows whoever is signed in now, so it is
 * a single shared slot rather than one per account, and the native widget reads
 * it at a fixed key it cannot be told about.
 */
export class PrefixedStore implements KeyValueStore {
  constructor(
    private readonly inner: KeyValueStore,
    private readonly prefix: string,
    private readonly options: { passthrough?: (key: string) => boolean } = {},
  ) {}

  private resolve(key: string): string {
    return this.options.passthrough?.(key) ? key : `${this.prefix}${key}`;
  }

  async get(key: string): Promise<string | null> {
    return this.inner.get(this.resolve(key));
  }

  async set(key: string, value: string): Promise<void> {
    await this.inner.set(this.resolve(key), value);
  }

  async remove(key: string): Promise<void> {
    await this.inner.remove(this.resolve(key));
  }

  async keys(): Promise<string[]> {
    const all = (await this.inner.keys?.()) ?? [];
    // Reported unprefixed, so a caller enumerating keys sees the same namespace
    // it writes to rather than a mix of both.
    return all
      .filter((key) => key.startsWith(this.prefix))
      .map((key) => key.slice(this.prefix.length));
  }
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
