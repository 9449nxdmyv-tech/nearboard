/**
 * A virtual BLE mesh, for testing routing without radios.
 *
 * Mesh bugs are the kind you cannot find by reading: a packet storm, a routing
 * loop, or a partition-heal race only appears with several nodes, real
 * topology, and unlucky timing. Reproducing those on hardware means a room full
 * of phones and a lot of luck about which of them happened to be in range.
 *
 * So the network is modelled instead. Nodes are connected by explicit links,
 * time is a virtual clock the test advances by hand, and randomness comes from
 * a seeded generator. That makes every scenario — a packet crossing five hops,
 * a partition healing, 30% loss on one link — exactly reproducible, and it runs
 * in milliseconds.
 *
 * What this deliberately does NOT model: the BLE stack itself. MTU negotiation,
 * GATT quirks, iOS background advertising, connection limits. Those are real
 * and they are what the on-device spike is for. Everything above the byte pipe
 * is testable here, so the spike only has to answer "can we advertise and serve
 * GATT", not "is our routing correct".
 */

import type { PacketLink } from '../transport.ts';

/** Deterministic PRNG (mulberry32) so a failing scenario replays exactly. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ScheduledEvent {
  at: number;
  seq: number;
  run: () => void;
}

/**
 * Virtual clock. Tests advance time explicitly rather than waiting, so a
 * scenario spanning minutes of jitter and timeouts runs instantly and never
 * flakes on a slow machine.
 */
export class VirtualClock {
  private currentTime = 0;
  private queue: ScheduledEvent[] = [];
  private seq = 0;

  now = (): number => this.currentTime;

  /** Schedule work. Ties break on insertion order, keeping runs deterministic. */
  schedule = (run: () => void, delayMs: number): void => {
    this.queue.push({ at: this.currentTime + Math.max(0, delayMs), seq: this.seq++, run });
  };

  get pending(): number {
    return this.queue.length;
  }

  /** Run everything due at or before `currentTime + ms`. */
  advance(ms: number): void {
    const target = this.currentTime + ms;
    for (;;) {
      const next = this.nextDue(target);
      if (!next) break;
      this.queue.splice(this.queue.indexOf(next), 1);
      this.currentTime = next.at;
      next.run();
    }
    this.currentTime = target;
  }

  /** Run until nothing is left, with a guard against a scenario that never settles. */
  drain(maxSteps = 100_000): void {
    let steps = 0;
    while (this.queue.length > 0) {
      if (++steps > maxSteps) {
        throw new Error(
          `Network did not settle after ${maxSteps} events — likely a routing loop`
        );
      }
      const next = this.nextDue(Infinity)!;
      this.queue.splice(this.queue.indexOf(next), 1);
      this.currentTime = next.at;
      next.run();
    }
  }

  private nextDue(target: number): ScheduledEvent | null {
    let best: ScheduledEvent | null = null;
    for (const event of this.queue) {
      if (event.at > target) continue;
      if (!best || event.at < best.at || (event.at === best.at && event.seq < best.seq)) {
        best = event;
      }
    }
    return best;
  }
}

export interface LinkQuality {
  /** One-way delay in ms. */
  latencyMs?: number;
  /** Probability in [0,1] that a frame is silently dropped. */
  loss?: number;
  /** Usable payload per frame. */
  mtu?: number;
}

interface Connection {
  a: string;
  b: string;
  quality: Required<LinkQuality>;
  up: boolean;
}

/** One endpoint of a virtual link, satisfying the same interface as real BLE. */
class VirtualLink implements PacketLink {
  readonly mtu: number;
  private handlers = new Set<(frame: Uint8Array) => void>();
  private deliver: (frame: Uint8Array) => void;

  constructor(mtu: number, deliver: (frame: Uint8Array) => void) {
    this.mtu = mtu;
    this.deliver = deliver;
  }

  async sendFrame(frame: Uint8Array): Promise<void> {
    this.deliver(frame);
  }

  onFrame(handler: (frame: Uint8Array) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Called by the network when a frame arrives from the peer. */
  receive(frame: Uint8Array): void {
    for (const handler of this.handlers) handler(frame);
  }
}

export interface NetworkOptions {
  seed?: number;
  defaultLatencyMs?: number;
  defaultLoss?: number;
  defaultMtu?: number;
}

/**
 * A set of nodes joined by links.
 *
 * Nodes are named. `connect` makes a bidirectional link; `partition` and `heal`
 * take links down and up so a test can watch a network split and re-converge.
 */
export class VirtualNetwork {
  readonly clock = new VirtualClock();
  readonly random: () => number;

  private connections: Connection[] = [];
  /** nodeId → peerId → this node's endpoint of the link to that peer. */
  private links = new Map<string, Map<string, VirtualLink>>();
  private defaults: Required<Omit<NetworkOptions, 'seed'>>;

  /** Every frame that crossed the wire, for assertions about traffic volume. */
  readonly delivered: { from: string; to: string; bytes: number; at: number }[] = [];
  readonly dropped: { from: string; to: string; at: number }[] = [];

  constructor(options: NetworkOptions = {}) {
    this.random = seededRandom(options.seed ?? 1);
    this.defaults = {
      defaultLatencyMs: options.defaultLatencyMs ?? 10,
      defaultLoss: options.defaultLoss ?? 0,
      defaultMtu: options.defaultMtu ?? 180
    };
  }

  /** Join two nodes. Both gain a link endpoint for the other. */
  connect(a: string, b: string, quality: LinkQuality = {}): void {
    if (this.linkBetween(a, b)) throw new Error(`${a} and ${b} are already connected`);

    const resolved = {
      latencyMs: quality.latencyMs ?? this.defaults.defaultLatencyMs,
      loss: quality.loss ?? this.defaults.defaultLoss,
      mtu: quality.mtu ?? this.defaults.defaultMtu
    };

    this.connections.push({ a, b, quality: resolved, up: true });

    const linkAtoB = new VirtualLink(resolved.mtu, (frame) => this.transmit(a, b, frame));
    const linkBtoA = new VirtualLink(resolved.mtu, (frame) => this.transmit(b, a, frame));

    this.endpointsOf(a).set(b, linkAtoB);
    this.endpointsOf(b).set(a, linkBtoA);
  }

  /** The link a node should use to reach a peer, or undefined if not joined. */
  linkFor(node: string, peer: string): PacketLink | undefined {
    return this.links.get(node)?.get(peer);
  }

  /** Peers a node is joined to, regardless of whether the link is currently up. */
  peersOf(node: string): string[] {
    return [...(this.links.get(node)?.keys() ?? [])];
  }

  /** Take a link down without removing it. */
  partition(a: string, b: string): void {
    const conn = this.linkBetween(a, b);
    if (!conn) throw new Error(`${a} and ${b} are not connected`);
    conn.up = false;
  }

  /** Bring a link back up. */
  heal(a: string, b: string): void {
    const conn = this.linkBetween(a, b);
    if (!conn) throw new Error(`${a} and ${b} are not connected`);
    conn.up = true;
  }

  /** Take every link down. */
  partitionAll(): void {
    for (const conn of this.connections) conn.up = false;
  }

  healAll(): void {
    for (const conn of this.connections) conn.up = true;
  }

  private endpointsOf(node: string): Map<string, VirtualLink> {
    let map = this.links.get(node);
    if (!map) {
      map = new Map();
      this.links.set(node, map);
    }
    return map;
  }

  private linkBetween(a: string, b: string): Connection | undefined {
    return this.connections.find(
      (c) => (c.a === a && c.b === b) || (c.a === b && c.b === a)
    );
  }

  /** Move one frame across a link, honouring loss and latency. */
  private transmit(from: string, to: string, frame: Uint8Array): void {
    const conn = this.linkBetween(from, to);
    if (!conn || !conn.up) {
      this.dropped.push({ from, to, at: this.clock.now() });
      return;
    }

    if (conn.quality.loss > 0 && this.random() < conn.quality.loss) {
      this.dropped.push({ from, to, at: this.clock.now() });
      return;
    }

    // Copy: the sender may reuse its buffer, as a real BLE stack does.
    const copy = frame.slice();
    this.clock.schedule(() => {
      this.delivered.push({ from, to, bytes: copy.byteLength, at: this.clock.now() });
      this.links.get(to)?.get(from)?.receive(copy);
    }, conn.quality.latencyMs);
  }
}
