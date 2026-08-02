import type { CardKind } from '../types/exam';

/**
 * Card ids are derived, not generated.
 *
 * A card is uniquely identified by the entry it tests and the kind of prompt it
 * uses, so `entryId:kind` is a natural key. Deriving it means re-running card
 * generation after a level's card weights change is idempotent: existing cards
 * keep their memory state instead of being duplicated under fresh random ids.
 */
export function cardId(entryId: string, kind: CardKind): string {
  return `${entryId}:${kind}`;
}

export function parseCardId(id: string): { entryId: string; kind: CardKind } {
  const separator = id.lastIndexOf(':');
  if (separator <= 0) throw new Error(`Malformed card id: ${id}`);
  return {
    entryId: id.slice(0, separator),
    kind: id.slice(separator + 1) as CardKind,
  };
}

let sequence = 0;

/**
 * A sortable, collision-resistant id for review logs.
 *
 * Time-prefixed so logs sort chronologically by id, with a counter to separate
 * entries written in the same millisecond and a random tail so logs written on
 * two devices in the same millisecond do not collide when they sync.
 */
export function reviewLogId(atMs: number = Date.now()): string {
  return sortableId('r', atMs);
}

/**
 * The same scheme for study sittings.
 *
 * Sortable and collision-resistant matters more here than for logs: session
 * records are merged across devices by id when an account syncs, so two phones
 * finishing a sitting in the same millisecond must not produce one record that
 * silently overwrites the other.
 */
export function studySessionId(atMs: number = Date.now()): string {
  return sortableId('s', atMs);
}

function sortableId(prefix: string, atMs: number): string {
  sequence = (sequence + 1) % 0x1000;
  const time = atMs.toString(36).padStart(9, '0');
  const counter = sequence.toString(36).padStart(3, '0');
  const random = Math.floor(Math.random() * 0x1000)
    .toString(36)
    .padStart(3, '0');
  return `${prefix}_${time}${counter}${random}`;
}
