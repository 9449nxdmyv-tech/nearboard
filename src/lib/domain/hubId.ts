/**
 * Hub identity derived from the hub's name.
 *
 * A `crypto.randomUUID()` hubId cannot be arrived at independently: two people
 * who both create "Coffee Shop Wall" get two unrelated boards that never merge,
 * and the only way to join an existing hub is to receive its exact UUID. That
 * makes a hub un-joinable by name, which is the thing a local board is for.
 *
 * Deriving the id from the normalised name instead means the name *is* the
 * address — the same channel-as-name model bitchat uses for `#channel`. Anyone
 * who knows the name reaches the same board.
 */

/**
 * Normalise a hub name so trivial variations agree:
 * case, surrounding space, internal whitespace runs, and Unicode form.
 */
export function normalizeHubName(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * hubId = SHA-256(normalised name), hex, truncated to 128 bits.
 *
 * 128 bits is far beyond collision range for the number of hub names that will
 * ever exist, and keeps the id short enough to sit comfortably in a QR code.
 */
export async function deriveHubId(name: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeHubName(name));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest).subarray(0, 16)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The join URL encoded into a hub's QR code. */
export function hubJoinUrl(origin: string, hubId: string, name: string): string {
  const url = new URL('/join', origin);
  url.searchParams.set('id', hubId);
  url.searchParams.set('name', name);
  return url.toString();
}
