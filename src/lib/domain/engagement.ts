/**
 * Engagement as a CRDT.
 *
 * Counters cannot survive a mesh. `likeCount: number` incremented by +1 deltas
 * double-counts as soon as the same like reaches a device by two different
 * relay paths, and there is no way to tell a duplicate from a second genuine
 * like. Devices then disagree about the feed order permanently.
 *
 * Instead each engagement is keyed by its author, and the count is derived from
 * the set. This is an LWW-Element-Set: every author has at most one entry, and
 * the newest entry wins on merge. That makes engagement:
 *
 *  - idempotent  — the same like arriving twice is the same entry
 *  - commutative — merge order does not matter
 *  - toggleable  — unlike is a later entry with `on: 0`, not a deletion
 *
 * Ties on timestamp resolve to `on` so that concurrent like/unlike converges
 * the same way on every device rather than depending on arrival order.
 */

/** authorId → [timestampMs, on] */
export type EngagementSet = Record<string, [number, 0 | 1]>;

/** The kinds of engagement a post carries, matching the fields on `Post`. */
export type EngagementKind = 'like' | 'reshare' | 'derank';

/** Number of authors currently engaged. */
export function count(set: EngagementSet | undefined): number {
  if (!set) return 0;
  let n = 0;
  for (const key in set) if (set[key][1] === 1) n++;
  return n;
}

/** Has this author currently engaged? */
export function has(set: EngagementSet | undefined, authorId: string): boolean {
  return set?.[authorId]?.[1] === 1;
}

/** Return a new set with `authorId` toggled at `at`. */
export function toggle(
  set: EngagementSet | undefined,
  authorId: string,
  at: number = Date.now()
): EngagementSet {
  const current = set ?? {};
  const on = has(current, authorId) ? 0 : 1;
  return { ...current, [authorId]: [at, on] };
}

/** Return a new set with `authorId` engaged (idempotent). */
export function add(
  set: EngagementSet | undefined,
  authorId: string,
  at: number = Date.now()
): EngagementSet {
  return { ...(set ?? {}), [authorId]: [at, 1] };
}

/**
 * Merge two sets. Per author the later timestamp wins; on a tie, `on` wins so
 * that every device resolves the conflict identically.
 */
export function merge(
  a: EngagementSet | undefined,
  b: EngagementSet | undefined
): EngagementSet {
  const out: EngagementSet = { ...(a ?? {}) };
  const other = b ?? {};

  for (const key in other) {
    const incoming = other[key];
    const existing = out[key];
    if (!existing) {
      out[key] = incoming;
    } else if (incoming[0] > existing[0]) {
      out[key] = incoming;
    } else if (incoming[0] === existing[0] && incoming[1] === 1) {
      out[key] = incoming;
    }
  }

  return out;
}
