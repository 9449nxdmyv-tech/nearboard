/**
 * The mesh transport surface.
 *
 * The old GATT layout had five characteristics, each carrying one operation
 * (read hub meta, request posts, read posts, upload a post, send engagement).
 * That shape has two problems for a mesh:
 *
 *  - Every characteristic is read-driven, and a GATT read can only be initiated
 *    by the central. A peripheral with something to say has no way to say it,
 *    which is why the old client had to poll in a chunk loop. Notifications
 *    invert that: the peripheral pushes, and the polling disappears.
 *
 *  - Operations baked into the transport cannot be relayed. A relay must be
 *    able to forward a packet it does not understand, which means one opaque
 *    pipe rather than a characteristic per verb.
 *
 * So there are exactly two characteristics: `INBOUND` (write-without-response,
 * peer → us) and `OUTBOUND` (notify, us → peer). Everything else is packet
 * `type`, which relays ignore.
 */

import {
  decodePacket,
  encodePacket,
  type Packet
} from './packet.ts';
import {
  fragmentPacket,
  Reassembler,
  DEFAULT_MTU,
  MIN_MTU
} from './fragment.ts';
import { PacketType } from './packet.ts';

/**
 * Mesh service and characteristics.
 *
 * Distinct from the legacy `0000dead-…` service so that a device running the
 * old build and one running the mesh build do not discover each other and then
 * fail at the first read — they simply do not match.
 */
export const MESH_SERVICE_UUID = '0000be50-0000-1000-8000-00805f9b34fb';
export const CHAR_INBOUND = '0000be51-0000-1000-8000-00805f9b34fb';
export const CHAR_OUTBOUND = '0000be52-0000-1000-8000-00805f9b34fb';

/** What a platform BLE implementation must provide. */
export interface PacketLink {
  /** Negotiated ATT MTU, or DEFAULT_MTU if negotiation has not happened. */
  readonly mtu: number;
  /** Write one already-fragmented frame to the peer. */
  sendFrame(frame: Uint8Array): Promise<void>;
  /** Register for frames pushed by the peer. Returns an unsubscribe function. */
  onFrame(handler: (frame: Uint8Array) => void): () => void;
}

export type PacketHandler = (packet: Packet, peerId: string) => void;

/**
 * Wraps a raw byte link into a packet-oriented one: fragments on the way out,
 * reassembles on the way in, and drops anything malformed rather than letting
 * one bad peer take down the session.
 */
export class PacketChannel {
  private readonly link: PacketLink;
  private readonly peerId: string;
  private readonly reassembler: Reassembler;
  private readonly handlers = new Set<PacketHandler>();
  private readonly onError: (error: Error) => void;
  private unsubscribe: (() => void) | null = null;

  constructor(
    link: PacketLink,
    peerId: string,
    onError: (error: Error) => void = () => {}
  ) {
    this.link = link;
    this.peerId = peerId;
    this.onError = onError;
    this.reassembler = new Reassembler();
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.link.onFrame((frame) => this.receive(frame));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.reassembler.clear();
  }

  onPacket(handler: PacketHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Fragment and write a packet. */
  async send(packet: Packet): Promise<void> {
    const mtu = Math.max(MIN_MTU, this.link.mtu || DEFAULT_MTU);
    for (const frame of fragmentPacket(packet, mtu)) {
      await this.link.sendFrame(frame);
    }
  }

  /**
   * Handle one inbound frame. A peer sending garbage — a truncated packet, a
   * bad fragment, an unknown version — costs us a dropped frame and nothing
   * more; it must never propagate as an exception into the BLE callback.
   */
  private receive(frame: Uint8Array): void {
    let packet: Packet;
    try {
      packet = decodePacket(frame);
    } catch (e) {
      this.onError(e as Error);
      return;
    }

    if (packet.type === PacketType.Fragment) {
      try {
        const whole = this.reassembler.accept(packet);
        if (!whole) return;
        packet = whole;
      } catch (e) {
        this.onError(e as Error);
        return;
      }
    }

    for (const handler of this.handlers) {
      try {
        handler(packet, this.peerId);
      } catch (e) {
        this.onError(e as Error);
      }
    }
  }
}

/** Re-exported so callers need only import from here. */
export { encodePacket, decodePacket, PacketType };
export type { Packet };
