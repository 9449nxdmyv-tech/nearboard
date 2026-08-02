import { writable, get } from 'svelte/store';

/**
 * Whether a post has actually been handed to anyone.
 *
 * This is the question the app never answered. You write something, it appears
 * in your feed identically whether it reached ten people or nobody, and there
 * is no way to tell which. On a mesh that ambiguity is constant — you are
 * frequently the only person in range — so leaving it unanswered means the app
 * always feels slightly broken.
 *
 * There is no delivery receipt to be had. Nobody acknowledges a flood packet,
 * and asking for acknowledgements would mean tracking who exists, which is
 * exactly what a network with no accounts avoids. But the device does know
 * something true and useful: how many peers it had to hand the post to at the
 * moment it went out.
 *
 * So the claim is deliberately modest — "shared with 2 nearby" means it was
 * given to two devices, not that two people read it. Overstating that would be
 * worse than saying nothing.
 *
 * Kept out of the Post record on purpose: this is local bookkeeping, it must
 * never travel, and it must never be part of what a signature covers.
 */

export interface DeliveryState {
  /** Peers the post was handed to, at its best moment so far. */
  peers: number;
  /** When it was first handed to at least one peer. */
  sharedAt: number | null;
}

const STORAGE_KEY = 'nearboard_delivery';
const MAX_TRACKED = 500;

function load(): Record<string, DeliveryState> {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export const delivery = writable<Record<string, DeliveryState>>(load());

function persist(next: Record<string, DeliveryState>) {
  // Bounded: this grows with every post ever written and is only ever a hint.
  const keys = Object.keys(next);
  if (keys.length > MAX_TRACKED) {
    const trimmed: Record<string, DeliveryState> = {};
    for (const key of keys.slice(-MAX_TRACKED)) trimmed[key] = next[key];
    next = trimmed;
  }

  delivery.set(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full; the in-memory value still drives the UI this session.
  }
}

/**
 * Record that a post went out to `peers` peers.
 *
 * Takes the best result so far rather than the latest: a post shared with three
 * people and later re-published to one should not downgrade to "1". The number
 * describes reach, and reach does not shrink.
 */
export function recordDelivery(postId: string, peers: number): void {
  const current = get(delivery);
  const existing = current[postId];

  const next: DeliveryState = {
    peers: Math.max(existing?.peers ?? 0, peers),
    sharedAt: existing?.sharedAt ?? (peers > 0 ? Date.now() : null)
  };

  if (existing && existing.peers === next.peers && existing.sharedAt === next.sharedAt) return;
  persist({ ...current, [postId]: next });
}

export function deliveryFor(
  state: Record<string, DeliveryState>,
  postId: string
): DeliveryState | null {
  return state[postId] ?? null;
}

/** Wording for a post's reach. Null when the post came from someone else. */
export function deliveryLabel(state: DeliveryState | null): string | null {
  if (!state) return null;
  if (state.peers === 0) return 'waiting for someone nearby';
  return `shared with ${state.peers} nearby`;
}
