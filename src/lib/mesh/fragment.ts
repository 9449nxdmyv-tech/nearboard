/**
 * Fragmentation and reassembly.
 *
 * A BLE characteristic write cannot exceed the negotiated MTU, which is far
 * smaller than a post: iOS settles around 185 bytes and the 23-byte default
 * applies until negotiation completes. The existing code assumed a flat 512,
 * which is only ever reachable on Android.
 *
 * A packet too large to send whole is split into `Fragment` packets. Each one
 * is an ordinary packet — so a relay forwards fragments without knowing what
 * they reconstruct — whose payload is:
 *
 *   offset  size  field
 *   ------  ----  -----
 *        0     8  fragmentId   groups fragments of one original packet
 *        8     2  index        uint16
 *       10     2  total        uint16
 *       12   ...  chunk
 *
 * Reassembly is deliberately hostile-input aware. Fragments arrive out of
 * order, may never complete, and may be fabricated: a peer that sends one
 * fragment of a thousand-fragment packet and vanishes must not be able to pin
 * memory, so buffers are bounded and expire.
 */

import {
  encodePacket,
  decodePacket,
  makePacket,
  toHex,
  fromHex,
  randomId,
  PacketType,
  HEADER_SIZE,
  type Packet
} from './packet.ts';

export const FRAGMENT_HEADER_SIZE = 12;
export const FRAGMENT_ID_SIZE = 8;

const OFF_FRAGMENT_ID = 0;
const OFF_INDEX = 8;
const OFF_TOTAL = 10;

/** uint16 index/total */
export const MAX_FRAGMENTS = 65535;

/**
 * Conservative default when the negotiated MTU is unknown. iOS commonly lands
 * near 185; leaving headroom avoids a renegotiation silently truncating writes.
 */
export const DEFAULT_MTU = 180;

/** Reassembly buffers older than this are abandoned. */
export const REASSEMBLY_TIMEOUT_MS = 30_000;

/** Cap on concurrently reassembling packets, across all peers. */
export const MAX_PENDING_REASSEMBLIES = 32;

/**
 * Smallest MTU that can carry a fragment at all.
 *
 * Note this is above BLE's 23-byte default: a packet header plus a fragment
 * header is 51 bytes, so the mesh cannot transmit anything until MTU
 * negotiation has completed. Callers must negotiate before sending rather than
 * falling back to the default and silently truncating.
 */
export const MIN_MTU = HEADER_SIZE + FRAGMENT_HEADER_SIZE + 1;

/** Payload bytes of the original packet each fragment can carry. */
export function chunkSize(mtu: number = DEFAULT_MTU): number {
  if (mtu < MIN_MTU) {
    throw new Error(
      `MTU of ${mtu} cannot carry a fragment; at least ${MIN_MTU} is required ` +
        `(BLE negotiates up from the 23-byte default — negotiate before sending)`
    );
  }
  return mtu - HEADER_SIZE - FRAGMENT_HEADER_SIZE;
}

/** Would this packet have to be fragmented at the given MTU? */
export function needsFragmentation(packet: Packet, mtu: number = DEFAULT_MTU): boolean {
  return HEADER_SIZE + packet.payload.byteLength > mtu;
}

/**
 * Split a packet into wire-ready fragment packets, or return the single encoded
 * packet if it already fits.
 *
 * Fragments inherit the original's ttl and senderId so relaying is unchanged,
 * but each gets its own messageId — they are distinct packets for dedup.
 */
export function fragmentPacket(
  packet: Packet,
  mtu: number = DEFAULT_MTU
): Uint8Array<ArrayBuffer>[] {
  const encoded = encodePacket(packet);
  if (encoded.byteLength <= mtu) return [encoded];

  const size = chunkSize(mtu);
  const total = Math.ceil(encoded.byteLength / size);
  if (total > MAX_FRAGMENTS) {
    throw new Error(`Packet needs ${total} fragments, over the ${MAX_FRAGMENTS} limit`);
  }

  const fragmentId = randomId(FRAGMENT_ID_SIZE);
  const idBytes = fromHex(fragmentId, FRAGMENT_ID_SIZE);
  const out: Uint8Array<ArrayBuffer>[] = [];

  for (let index = 0; index < total; index++) {
    const chunk = encoded.subarray(index * size, (index + 1) * size);
    const payload = new Uint8Array(FRAGMENT_HEADER_SIZE + chunk.byteLength);
    const view = new DataView(payload.buffer);

    payload.set(idBytes, OFF_FRAGMENT_ID);
    view.setUint16(OFF_INDEX, index, false);
    view.setUint16(OFF_TOTAL, total, false);
    payload.set(chunk, FRAGMENT_HEADER_SIZE);

    out.push(
      encodePacket(
        makePacket(PacketType.Fragment, packet.senderId, payload, { ttl: packet.ttl })
      )
    );
  }

  return out;
}

export interface FragmentHeader {
  fragmentId: string;
  index: number;
  total: number;
  chunk: Uint8Array;
}

export function parseFragment(packet: Packet): FragmentHeader {
  if (packet.type !== PacketType.Fragment) {
    throw new Error(`Packet type ${packet.type} is not a fragment`);
  }
  if (packet.payload.byteLength < FRAGMENT_HEADER_SIZE) {
    throw new Error('Fragment payload is shorter than its header');
  }

  const { payload } = packet;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const total = view.getUint16(OFF_TOTAL, false);
  const index = view.getUint16(OFF_INDEX, false);

  if (total === 0) throw new Error('Fragment declares a total of zero');
  if (index >= total) throw new Error(`Fragment index ${index} is outside its total of ${total}`);

  return {
    fragmentId: toHex(payload.subarray(OFF_FRAGMENT_ID, OFF_FRAGMENT_ID + FRAGMENT_ID_SIZE)),
    index,
    total,
    chunk: payload.subarray(FRAGMENT_HEADER_SIZE)
  };
}

interface Pending {
  total: number;
  received: number;
  bytes: number;
  chunks: (Uint8Array | undefined)[];
  startedAt: number;
}

/**
 * Collects fragments until a packet is whole.
 *
 * One instance is shared across peers, so the caps below are global. That is
 * intentional: a per-peer cap would let one peer exhaust memory by claiming
 * many identities.
 */
export class Reassembler {
  private pending = new Map<string, Pending>();
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(
    maxBytes: number = 4 * 1024 * 1024,
    timeoutMs: number = REASSEMBLY_TIMEOUT_MS,
    now: () => number = Date.now
  ) {
    this.maxBytes = maxBytes;
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  /** Number of in-flight reassemblies; exposed for tests and diagnostics. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Feed one fragment packet. Returns the reassembled packet once the last
   * piece arrives, otherwise null.
   */
  accept(packet: Packet): Packet | null {
    this.expire();

    const { fragmentId, index, total, chunk } = parseFragment(packet);
    let entry = this.pending.get(fragmentId);

    if (!entry) {
      if (this.pending.size >= MAX_PENDING_REASSEMBLIES) {
        this.dropOldest();
      }
      entry = {
        total,
        received: 0,
        bytes: 0,
        chunks: new Array(total),
        startedAt: this.now()
      };
      this.pending.set(fragmentId, entry);
    }

    // A peer claiming a different total for the same id is inconsistent;
    // discard the whole group rather than trusting either claim.
    if (entry.total !== total) {
      this.pending.delete(fragmentId);
      throw new Error(`Fragment ${fragmentId} changed its total from ${entry.total} to ${total}`);
    }

    // Ignore a repeat rather than double-counting it — the same fragment can
    // arrive by several relay paths.
    if (entry.chunks[index]) return null;

    if (entry.bytes + chunk.byteLength > this.maxBytes) {
      this.pending.delete(fragmentId);
      throw new Error(`Reassembly of ${fragmentId} exceeded ${this.maxBytes} bytes`);
    }

    // Copy: the caller's buffer may be reused by the BLE stack.
    entry.chunks[index] = chunk.slice();
    entry.received++;
    entry.bytes += chunk.byteLength;

    if (entry.received < entry.total) return null;

    this.pending.delete(fragmentId);

    const joined = new Uint8Array(entry.bytes);
    let offset = 0;
    for (const part of entry.chunks) {
      joined.set(part!, offset);
      offset += part!.byteLength;
    }

    return decodePacket(joined);
  }

  /** Discard reassemblies that have been open too long. */
  expire(): void {
    const cutoff = this.now() - this.timeoutMs;
    for (const [id, entry] of this.pending) {
      if (entry.startedAt < cutoff) this.pending.delete(id);
    }
  }

  clear(): void {
    this.pending.clear();
  }

  private dropOldest(): void {
    let oldestId: string | null = null;
    let oldestAt = Infinity;
    for (const [id, entry] of this.pending) {
      if (entry.startedAt < oldestAt) {
        oldestAt = entry.startedAt;
        oldestId = id;
      }
    }
    if (oldestId) this.pending.delete(oldestId);
  }
}
