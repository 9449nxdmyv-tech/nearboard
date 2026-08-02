/**
 * Wires MeshNodes onto a VirtualNetwork so a test can describe a topology in a
 * line or two and then assert on what reached whom.
 */

import { VirtualNetwork, type LinkQuality, type NetworkOptions } from './network.ts';
import { MeshNode } from '../router.ts';
import { PacketChannel } from '../transport.ts';
import { makePacket, PacketType, type Packet } from '../packet.ts';

export interface HarnessOptions extends NetworkOptions {
  minJitterMs?: number;
  maxJitterMs?: number;
  seenTtlMs?: number;
  cacheTtlMs?: number;
  cacheMax?: number;
}

export interface Received {
  packet: Packet;
  from: string;
  at: number;
}

export class MeshHarness {
  readonly net: VirtualNetwork;
  readonly nodes = new Map<string, MeshNode>();
  readonly received = new Map<string, Received[]>();
  readonly errors: Error[] = [];

  private options: HarnessOptions;

  constructor(options: HarnessOptions = {}) {
    this.options = options;
    this.net = new VirtualNetwork(options);
  }

  /** Create a node. Its delivery handler records everything for assertions. */
  add(id: string): MeshNode {
    const node = new MeshNode(id, {
      now: this.net.clock.now,
      schedule: this.net.clock.schedule,
      random: this.net.random,
      minJitterMs: this.options.minJitterMs ?? 50,
      maxJitterMs: this.options.maxJitterMs ?? 500,
      seenTtlMs: this.options.seenTtlMs,
      cacheTtlMs: this.options.cacheTtlMs,
      cacheMax: this.options.cacheMax,
      onError: (e) => this.errors.push(e)
    });

    this.received.set(id, []);
    node.onDelivery((packet, from) => {
      this.received.get(id)!.push({ packet, from, at: this.net.clock.now() });
    });

    this.nodes.set(id, node);
    return node;
  }

  /** Add several nodes at once. */
  addAll(...ids: string[]): MeshNode[] {
    return ids.map((id) => this.add(id));
  }

  /** Join two nodes, creating a channel on each side. */
  link(a: string, b: string, quality: LinkQuality = {}): void {
    this.net.connect(a, b, quality);

    const nodeA = this.nodes.get(a);
    const nodeB = this.nodes.get(b);
    if (!nodeA || !nodeB) throw new Error(`link(${a}, ${b}): both nodes must exist`);

    const channelA = new PacketChannel(this.net.linkFor(a, b)!, b, (e) => this.errors.push(e));
    const channelB = new PacketChannel(this.net.linkFor(b, a)!, a, (e) => this.errors.push(e));
    channelA.start();
    channelB.start();

    nodeA.addPeer(b, channelA);
    nodeB.addPeer(a, channelB);
  }

  /** A chain: a — b — c — … */
  chain(...ids: string[]): void {
    for (let i = 0; i < ids.length - 1; i++) this.link(ids[i], ids[i + 1]);
  }

  /** Every node joined to every other. */
  mesh(...ids: string[]): void {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) this.link(ids[i], ids[j]);
    }
  }

  /** A closed loop, the shape that exposes relay storms. */
  ring(...ids: string[]): void {
    this.chain(...ids);
    if (ids.length > 2) this.link(ids[ids.length - 1], ids[0]);
  }

  /** Originate a packet from a node and let the network settle. */
  send(from: string, text: string, options: { ttl?: number } = {}): Packet {
    const node = this.nodes.get(from);
    if (!node) throw new Error(`unknown node ${from}`);

    const packet = makePacket(
      PacketType.Post,
      from.padEnd(16, '0').slice(0, 16),
      new TextEncoder().encode(text),
      options
    );
    void node.originate(packet);
    return packet;
  }

  /**
   * Originate an arbitrary packet from a node.
   *
   * `send` only makes text posts; replies, curation and announcements need to
   * be routed too, and they are the ones most likely to be got wrong — a new
   * packet type that fails to relay looks exactly like a working one until two
   * devices are in a room together.
   */
  sendPacket(
    from: string,
    type: PacketType,
    payload: unknown,
    options: { ttl?: number } = {}
  ): Packet {
    const node = this.nodes.get(from);
    if (!node) throw new Error(`unknown node ${from}`);

    const packet = makePacket(
      type,
      from.padEnd(16, '0').slice(0, 16),
      new TextEncoder().encode(JSON.stringify(payload)),
      options
    );
    void node.originate(packet);
    return packet;
  }

  /** Decoded payloads of a given type that reached a node. */
  payloadsAt<T>(id: string, type: PacketType): T[] {
    return (this.received.get(id) ?? [])
      .filter((r) => r.packet.type === type)
      .map((r) => JSON.parse(new TextDecoder().decode(r.packet.payload)) as T);
  }


  /**
   * Run the network until nothing is in flight.
   *
   * This alternates between flushing pending promise callbacks and draining the
   * virtual clock, and it has to. `PacketChannel.send` awaits between fragments,
   * so a multi-fragment packet only queues its first frame synchronously — the
   * rest are scheduled from microtasks. Draining the clock without flushing
   * those first makes any packet larger than one MTU vanish, while every
   * single-frame packet appears to work perfectly.
   *
   * Each round settles one "wave": flush schedules everything the current
   * callbacks want to send, drain delivers it, and delivery queues the next
   * round's callbacks. It converges in roughly one round per hop.
   */
  async settle(maxRounds = 1000): Promise<void> {
    for (let round = 0; round < maxRounds; round++) {
      // setImmediate fires after the microtask queue is fully drained, so this
      // flushes every pending await, not just one turn of the chain.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (this.net.clock.pending === 0) return;
      this.net.clock.drain();
    }
    throw new Error(`Network did not settle after ${maxRounds} rounds`);
  }

  /** Which nodes received a given packet. */
  reachedBy(messageId: string): string[] {
    const out: string[] = [];
    for (const [id, list] of this.received) {
      if (list.some((r) => r.packet.messageId === messageId)) out.push(id);
    }
    return out.sort();
  }

  /** Payloads a node received, in arrival order. */
  textsAt(id: string): string[] {
    return (this.received.get(id) ?? []).map((r) =>
      new TextDecoder().decode(r.packet.payload)
    );
  }

  /** How many times a node was handed a given packet. Should never exceed one. */
  deliveryCount(id: string, messageId: string): number {
    return (this.received.get(id) ?? []).filter((r) => r.packet.messageId === messageId).length;
  }

  /** Total frames that crossed any link. */
  get framesOnWire(): number {
    return this.net.delivered.length;
  }
}
