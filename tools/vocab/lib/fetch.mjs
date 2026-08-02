import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';

const CACHE = new URL('../.cache/', import.meta.url).pathname;

/**
 * Download once, keep it.
 *
 * The scraper gets run repeatedly while its output is being tuned, and
 * re-downloading two hundred megabytes of Wiktionary each time is rude to
 * somebody who is giving the data away for nothing. The cache is gitignored;
 * delete it to force a refresh.
 */
export async function download(url, name) {
  await mkdir(CACHE, { recursive: true });
  const path = join(CACHE, name);

  try {
    const existing = await stat(path);
    if (existing.size > 0) {
      process.stderr.write(`  cached  ${name} (${mb(existing.size)})\n`);
      return path;
    }
  } catch {
    // Not cached yet.
  }

  process.stderr.write(`  fetching ${url}\n`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} from ${url}`);

  await mkdir(dirname(path), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));

  const written = await stat(path);
  process.stderr.write(`  saved    ${name} (${mb(written.size)})\n`);
  return path;
}

export async function downloadText(url, name) {
  const path = await download(url, name);
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8');
}

export async function downloadJson(url, name) {
  return JSON.parse(await downloadText(url, name));
}

/**
 * Read a JSONL file one object at a time.
 *
 * Wiktionary's Korean extract is 195MB and its Vietnamese one 78MB. Parsing
 * either in one go is a few gigabytes of heap for a result that is a few
 * thousand short strings, so callers get a line at a time and keep what they
 * want.
 */
export async function* streamJsonl(path) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.length === 0) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // A truncated final line in a partially-downloaded file. Skip it rather
      // than failing a twenty-minute build over one record.
    }
  }
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
