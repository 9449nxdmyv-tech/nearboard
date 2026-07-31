/**
 * The set of packets this node has already handled.
 *
 * Flooding only terminates because nodes refuse to re-broadcast what they have
 * already seen. Without this a three-node triangle re-sends a packet forever:
 * A relays to B and C, B relays to C, C relays to B, and so on until the TTL
 * runs out — and TTL alone bounds the damage at 7 hops of exponential fan-out,
 * which on a busy board is still a storm.
 *
 * Both bounds matter and they fail in opposite directions:
 *
 *  - Unbounded in size, a long-lived anchor node accumulates every messageId it
 *    has ever seen and eventually dies.
 *  - Bounded too tightly in time, an entry expires while the packet is still
 *    circulating on a slow path, the node accepts it as new, and the loop it
 *    was supposed to stop restarts.
 *
 * So entries expire on age, and the size cap evicts oldest-first only as a
 * backstop when traffic outruns the age window.
 */

export const DEFAULT_SEEN_TTL_MS = 5 * 60_000;
export const DEFAULT_SEEN_MAX = 2000;

export class SeenSet {
  /** messageId → when we first saw it. Insertion-ordered, so oldest is first. */
  private entries = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly now: () => number;

  constructor(
    ttlMs: number = DEFAULT_SEEN_TTL_MS,
    max: number = DEFAULT_SEEN_MAX,
    now: () => number = Date.now
  ) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Has this id been recorded and not yet expired? */
  has(messageId: string): boolean {
    const at = this.entries.get(messageId);
    if (at === undefined) return false;
    if (at < this.now() - this.ttlMs) {
      this.entries.delete(messageId);
      return false;
    }
    return true;
  }

  /**
   * Record an id. Returns true if it was already present — the caller uses this
   * as "drop this packet", so the check and the insert must be one step or two
   * copies arriving in the same tick both look new.
   */
  add(messageId: string): boolean {
    if (this.has(messageId)) return true;

    this.expire();
    this.entries.set(messageId, this.now());

    // Backstop: only reached when arrivals outpace the age window.
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }

    return false;
  }

  /** Drop entries past the age window. */
  expire(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, at] of this.entries) {
      // Insertion-ordered, so the first live entry means the rest are live too.
      if (at >= cutoff) break;
      this.entries.delete(id);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
