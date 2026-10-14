import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { KeyValueStore } from '@mon/core';

/**
 * The storage port, on a filesystem.
 *
 * One directory per account, one file per key. No database, because the engine
 * only ever asks for strings by key and a dependency that turns that into SQL
 * would be a dependency to install, migrate and back up for no behaviour the
 * port can express.
 *
 * Writes go to a temporary file and are renamed into place. `rename` is atomic
 * within a filesystem, so a process that dies mid-write leaves the previous
 * version intact rather than a half-written card list — which, for the file that
 * holds every review a learner has ever done, is the difference between a
 * crash and a loss.
 */
export class FileStore implements KeyValueStore {
  // Written out rather than declared as a constructor parameter property:
  // those emit code, so Node's type-stripping cannot run this file without an
  // experimental transform. Explicit fields work under the stable subset.
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  /** `srs:v1:cards` is not a filename; the colons are the problem on Windows. */
  private pathFor(key: string): string {
    const safe = key.replace(/[^A-Za-z0-9._-]/g, '_');
    return join(this.directory, `${safe}.json`);
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(this.pathFor(key), 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });

    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, value, 'utf8');
    await rename(temporary, target);
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async keys(): Promise<string[]> {
    try {
      const files = await readdir(this.directory);
      return files.filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    }
  }
}
