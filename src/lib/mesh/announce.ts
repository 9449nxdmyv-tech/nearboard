/**
 * Telling peers which boards you carry.
 *
 * Deriving a hub id from its name is what makes a board reachable — two people
 * who type the same name land on the same board with nothing to exchange. But
 * it also makes the name load-bearing in a way that is unforgiving: "Coffee
 * shop wall" and "Coffee Shop Wall" normalise the same, while "Coffee Shop
 * Walls" is a different board forever, silently, with no error and no way to
 * tell from inside the app.
 *
 * Asking someone to type a name character for character is a poor way to join
 * a room you are standing in. So peers announce what they hold, and the app can
 * offer those boards directly — typing a name goes back to being how you
 * *create* one.
 *
 * An announcement carries the hub id and the name. The name is already known to
 * anyone in range who could hear the id, since the id is derived from it; what
 * it buys is showing something human on screen rather than a hash.
 */

import { makePacket, PacketType, type Packet } from './packet.ts';

/** One board a peer is carrying. */
export interface AnnouncedHub {
  hubId: string;
  name: string;
  /**
   * Key of the board's curator, if the announcer has one.
   *
   * Recorded on joining and honoured thereafter. Announced rather than
   * derived, because there is nothing in a name-derived hubId that could
   * identify who runs the board.
   */
  curatorId?: string;
}

export interface AnnouncePayload {
  hubs: AnnouncedHub[];
}

/**
 * Cap on hubs per announcement.
 *
 * Keeps a single packet small enough to cross without fragmenting, and bounds
 * what a peer can make every device in range allocate.
 */
export const MAX_ANNOUNCED_HUBS = 10;

/** Longest hub name accepted from a peer, to bound display and memory. */
const MAX_NAME_LENGTH = 80;

export function encodeAnnounce(senderId: string, hubs: AnnouncedHub[]): Packet {
  const payload: AnnouncePayload = {
    hubs: hubs.slice(0, MAX_ANNOUNCED_HUBS).map((h) => ({
      hubId: h.hubId,
      name: h.name.slice(0, MAX_NAME_LENGTH),
      ...(h.curatorId ? { curatorId: h.curatorId } : {})
    }))
  };

  return makePacket(
    PacketType.Announce,
    senderId,
    new TextEncoder().encode(JSON.stringify(payload)),
    // Announcements describe who is immediately around, so they are not
    // relayed. A board three hops away is not one you can join by walking over
    // to it, and flooding them would drown the traffic that matters.
    { ttl: 1 }
  );
}

/**
 * Read an announcement, discarding anything malformed.
 *
 * Everything here came from a stranger, so each field is checked rather than
 * trusted: a peer must not be able to put an unbounded string or a
 * wrong-shaped id onto another device's screen.
 */
export function decodeAnnounce(packet: Packet): AnnouncedHub[] {
  if (packet.type !== PacketType.Announce) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(packet.payload));
  } catch {
    return [];
  }

  const hubs = (parsed as AnnouncePayload)?.hubs;
  if (!Array.isArray(hubs)) return [];

  const out: AnnouncedHub[] = [];
  for (const hub of hubs.slice(0, MAX_ANNOUNCED_HUBS)) {
    const hubId = typeof hub?.hubId === 'string' ? hub.hubId : '';
    const name = typeof hub?.name === 'string' ? hub.name.trim() : '';

    // A hub id is 128 bits of hex. Rejecting anything else keeps a malformed
    // or hostile id from ever reaching storage or a route.
    if (!/^[0-9a-f]{32}$/.test(hubId)) continue;
    if (!name || name.length > MAX_NAME_LENGTH) continue;

    // A curator id must look like a public key or it is dropped — an
    // ill-formed one could never verify a claim anyway.
    const curatorId =
      typeof hub?.curatorId === 'string' && /^[0-9a-f]{64}$/.test(hub.curatorId)
        ? hub.curatorId
        : undefined;

    out.push({ hubId, name, ...(curatorId ? { curatorId } : {}) });
  }

  return out;
}

/**
 * Boards seen recently on the mesh.
 *
 * Entries expire so the list reflects what is actually around: a board whose
 * only carrier walked out should stop being offered rather than linger as a
 * dead option.
 */
export class NearbyHubs {
  private entries = new Map<string, { hub: AnnouncedHub; at: number; peerId: string }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs: number = 60_000, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  /** Record hubs a peer just announced. Returns true if anything changed. */
  record(hubs: AnnouncedHub[], peerId: string): boolean {
    const at = this.now();
    let changed = false;

    for (const hub of hubs) {
      const existing = this.entries.get(hub.hubId);
      if (!existing || existing.hub.name !== hub.name) changed = true;
      this.entries.set(hub.hubId, { hub, at, peerId });
    }

    return changed;
  }

  /** Boards still considered present, newest first. */
  list(): AnnouncedHub[] {
    this.expire();
    return [...this.entries.values()].sort((a, b) => b.at - a.at).map((e) => e.hub);
  }

  /** Drop a peer's boards when it disconnects, unless another peer carries them. */
  forgetPeer(peerId: string): void {
    for (const [hubId, entry] of this.entries) {
      if (entry.peerId === peerId) this.entries.delete(hubId);
    }
  }

  expire(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [hubId, entry] of this.entries) {
      if (entry.at < cutoff) this.entries.delete(hubId);
    }
  }

  get size(): number {
    this.expire();
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
