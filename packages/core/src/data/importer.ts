import { findExamLevel } from '../exams';
import type { LexicalEntry } from '../types/card';
import { isLanguageCode, type LanguageCode } from '../types/language';

/**
 * Bulk vocabulary import.
 *
 * The seed decks deliberately do not pretend to be the HSK or JLPT syllabus, so
 * there has to be a supported path from an official or community word list to
 * studiable cards. This module is that path, for both CSV (what word lists are
 * usually distributed as) and JSON (what an export from this app produces).
 *
 * Every row is validated and reported on rather than silently coerced. A word
 * list with a mistyped level id would otherwise import cleanly and produce cards
 * that never appear in any queue, which is close to impossible to diagnose from
 * inside the app.
 */

export interface ImportIssue {
  /** 1-based row number for CSV, array index for JSON. */
  row: number;
  field?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ImportResult {
  entries: LexicalEntry[];
  issues: ImportIssue[];
  /** Rows that produced a usable entry. */
  accepted: number;
  /** Rows dropped because of an error. */
  rejected: number;
}

/**
 * CSV columns, in order.
 *
 * A header row is recognised and skipped if its first cell is `id`. Columns after
 * `tags` are ignored, so a list carrying extra metadata imports without editing.
 */
export const CSV_COLUMNS = [
  'id',
  'target',
  'reading',
  'meanings',
  'levelIds',
  'partOfSpeech',
  'tones',
  'components',
  'examples',
  'tags',
  'frequencyRank',
] as const;

export interface ParseCsvOptions {
  /** Language for every row. CSVs of word lists rarely carry it per row. */
  languageCode: LanguageCode;
  /**
   * Level to assign when a row leaves `levelIds` empty — the usual case when
   * importing a single level's list as one file.
   */
  defaultLevelId?: string;
  /** Prefix for generated ids when a row has no `id`. Defaults to the language code. */
  idPrefix?: string;
  delimiter?: string;
  /** Separator inside multi-value cells such as `meanings` and `tags`. */
  multiValueSeparator?: string;
}

/**
 * Parse a word list.
 *
 * Multi-value cells use `;` by default so that `,` stays available inside
 * meanings, which matters: "hello, hi" is one gloss list and splitting it on the
 * column delimiter would corrupt every row that has more than one sense.
 *
 * `examples` cells hold `target|translation` pairs separated by the multi-value
 * separator.
 */
export function parseVocabularyCsv(text: string, options: ParseCsvOptions): ImportResult {
  const delimiter = options.delimiter ?? ',';
  const separator = options.multiValueSeparator ?? ';';
  const issues: ImportIssue[] = [];
  const entries: LexicalEntry[] = [];
  let rejected = 0;

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { entries: [], issues: [{ row: 0, message: 'File is empty', severity: 'error' }], accepted: 0, rejected: 0 };
  }

  const startIndex = lines[0]!.split(delimiter)[0]?.trim().toLowerCase() === 'id' ? 1 : 0;

  for (let index = startIndex; index < lines.length; index += 1) {
    const row = index + 1;
    const cells = splitCsvLine(lines[index]!, delimiter);
    const get = (column: (typeof CSV_COLUMNS)[number]): string =>
      (cells[CSV_COLUMNS.indexOf(column)] ?? '').trim();

    const target = get('target');
    if (!target) {
      issues.push({ row, field: 'target', message: 'Missing target word; row skipped', severity: 'error' });
      rejected += 1;
      continue;
    }

    const meanings = splitList(get('meanings'), separator);
    if (meanings.length === 0) {
      issues.push({ row, field: 'meanings', message: `No meanings for "${target}"; row skipped`, severity: 'error' });
      rejected += 1;
      continue;
    }

    const levelIds = splitList(get('levelIds'), separator);
    const resolvedLevels = levelIds.length > 0 ? levelIds : options.defaultLevelId ? [options.defaultLevelId] : [];

    if (resolvedLevels.length === 0) {
      issues.push({
        row,
        field: 'levelIds',
        message: `No exam level for "${target}" and no defaultLevelId given; row skipped`,
        severity: 'error',
      });
      rejected += 1;
      continue;
    }

    const unknownLevels = resolvedLevels.filter((levelId) => !findExamLevel(levelId));
    if (unknownLevels.length > 0) {
      issues.push({
        row,
        field: 'levelIds',
        message: `Unknown exam level(s) ${unknownLevels.join(', ')} for "${target}"; row skipped`,
        severity: 'error',
      });
      rejected += 1;
      continue;
    }

    const tones = splitList(get('tones'), separator)
      .flatMap((value) => value.split(/[\s,]+/))
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 6);

    const rawTones = get('tones');
    if (rawTones && tones.length === 0) {
      issues.push({
        row,
        field: 'tones',
        message: `Could not read tones "${rawTones}" for "${target}"; imported without tones`,
        severity: 'warning',
      });
    }

    const rank = Number(get('frequencyRank'));

    entries.push({
      id: get('id') || `${options.idPrefix ?? options.languageCode}-${slugify(target)}`,
      languageCode: options.languageCode,
      target,
      reading: get('reading'),
      meanings,
      levelIds: resolvedLevels,
      examples: parseExamples(get('examples'), separator),
      tags: splitList(get('tags'), separator),
      ...(get('partOfSpeech') ? { partOfSpeech: get('partOfSpeech') } : {}),
      ...(tones.length > 0 ? { tones } : {}),
      ...(splitList(get('components'), separator).length > 0
        ? { components: splitList(get('components'), separator) }
        : {}),
      ...(Number.isFinite(rank) && rank > 0 ? { frequencyRank: rank } : {}),
    });
  }

  return { entries, issues, accepted: entries.length, rejected };
}

/** Parse a JSON array of entries, e.g. an export from this app. */
export function parseVocabularyJson(text: string): ImportResult {
  const issues: ImportIssue[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      entries: [],
      issues: [{ row: 0, message: `Invalid JSON: ${(error as Error).message}`, severity: 'error' }],
      accepted: 0,
      rejected: 0,
    };
  }

  const rows = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown[] })?.entries;
  if (!Array.isArray(rows)) {
    return {
      entries: [],
      issues: [{ row: 0, message: 'Expected an array of entries, or an object with an `entries` array', severity: 'error' }],
      accepted: 0,
      rejected: 0,
    };
  }

  const entries: LexicalEntry[] = [];
  let rejected = 0;

  rows.forEach((row, index) => {
    const result = validateEntry(row, index);
    if (result.entry) entries.push(result.entry);
    else rejected += 1;
    issues.push(...result.issues);
  });

  return { entries, issues, accepted: entries.length, rejected };
}

function validateEntry(value: unknown, row: number): { entry?: LexicalEntry; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  if (typeof value !== 'object' || value === null) {
    return { issues: [{ row, message: 'Entry is not an object; skipped', severity: 'error' }] };
  }

  const candidate = value as Partial<LexicalEntry>;
  const fail = (field: string, message: string) => {
    issues.push({ row, field, message, severity: 'error' });
  };

  if (!candidate.target) fail('target', 'Missing target');
  if (!candidate.languageCode || !isLanguageCode(candidate.languageCode)) {
    fail('languageCode', `Missing or unsupported languageCode: ${String(candidate.languageCode)}`);
  }
  if (!Array.isArray(candidate.meanings) || candidate.meanings.length === 0) fail('meanings', 'Missing meanings');
  if (!Array.isArray(candidate.levelIds) || candidate.levelIds.length === 0) fail('levelIds', 'Missing levelIds');

  const unknownLevels = (candidate.levelIds ?? []).filter((levelId) => !findExamLevel(levelId));
  if (unknownLevels.length > 0) fail('levelIds', `Unknown exam level(s): ${unknownLevels.join(', ')}`);

  if (issues.length > 0) return { issues };

  return {
    entry: {
      id: candidate.id || `${candidate.languageCode}-${slugify(candidate.target!)}`,
      languageCode: candidate.languageCode as LanguageCode,
      target: candidate.target!,
      reading: candidate.reading ?? '',
      meanings: candidate.meanings!,
      levelIds: candidate.levelIds!,
      examples: candidate.examples ?? [],
      tags: candidate.tags ?? [],
      ...(candidate.partOfSpeech ? { partOfSpeech: candidate.partOfSpeech } : {}),
      ...(candidate.tones ? { tones: candidate.tones } : {}),
      ...(candidate.components ? { components: candidate.components } : {}),
      ...(candidate.variants ? { variants: candidate.variants } : {}),
      ...(candidate.frequencyRank !== undefined ? { frequencyRank: candidate.frequencyRank } : {}),
      ...(candidate.audioUrl ? { audioUrl: candidate.audioUrl } : {}),
      ...(candidate.mnemonic ? { mnemonic: candidate.mnemonic } : {}),
    },
    issues,
  };
}

/** Serialise entries for backup or for moving a deck between devices. */
export function exportVocabularyJson(entries: LexicalEntry[]): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries }, null, 2);
}

/**
 * Split one CSV line, honouring double-quoted cells.
 *
 * Word lists quote cells routinely, because glosses contain commas. Splitting on
 * the delimiter alone shifts every column after the first quoted comma, so the
 * levels end up in the tags and nothing is studiable.
 */
function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;

    if (char === '"') {
      // A doubled quote inside a quoted cell is a literal quote.
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function splitList(value: string, separator: string): string[] {
  return value
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseExamples(value: string, separator: string): LexicalEntry['examples'] {
  return splitList(value, separator)
    .map((pair) => {
      const [target = '', translation = '', reading] = pair.split('|').map((part) => part.trim());
      return { target, translation, ...(reading ? { reading } : {}) };
    })
    .filter((example) => example.target.length > 0);
}

function slugify(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]/gu, '');
  // Non-Latin targets slugify to nothing useful, so fall back to a stable hash of
  // the original string rather than colliding every entry on an empty id.
  return cleaned.length > 0 && /[a-z0-9]/.test(cleaned) ? cleaned : `x${hash(value).toString(36)}`;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
