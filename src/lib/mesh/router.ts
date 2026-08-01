/**
 * Flood routing.
 *
 * There is no routing table and no path discovery. A node that receives a
 * packet it has not seen before hands it to the app and re-broadcasts it to
 * every peer except the one it came from, with one hop deducted. That reaches
 * everyone connected by any path, survives arbitrary topology changes, and
 * needs no agreement between nodes about who is where — which matters when the
 * topology is "whoever happens to be in the room".
 *
 * Three things keep flooding from being a disaster:
 *
 *  - the seen-set, so a packet is relayed at most once per node
 *  - the TTL, so even a bug in the seen-set cannot produce infinite hops
 *  - jitter before relaying, so N peers receiving a packet simultaneously do
 *    not all re-broadcast in the same instant. Without it every hop multiplies
 *    into a synchronised burst, and BLE — which has no collision avoidance
 *    worth the name at this layer — drops most of it.
 *
 * Store-and-forward covers the other half of the problem: the people a post is
 * for are often not in the room yet. Recent packets are cached and replayed to
 * peers as they arrive, so walking into a cafe pulls in what was said before
 * you got there.
 */

import { decrementTtl, type Packet } from './packet.ts';
import { SeenSet } from './seen.ts';
import type { PacketChannel } from './transport.ts';

/** Jitter bounds before relaying, in ms. */
export const MIN_RELAY_JITTER_MS = 50;
export const MAX_RELAY_JITTER_MS = 500;

/**
 * TTL clamping by local topology.
 *
 * A flat TTL treats a crowded room and a sparse one identically, which is
 * wrong in both directions. Where a node has many neighbours the packet is
 * already reaching everyone within a hop or two, so spending the full seven
 * multiplies traffic for nothing. Where a node has almost none, every hop
 * counts and the packet needs its full depth to escape a thin chain.
 *
 * Thresholds follow bitchat, which arrived at them from deployment rather than
 * theory.
 */
export const DENSE_PEER_THRESHOLD = 6;
export const DENSE_TTL_CAP = 5;
export const SPARSE_PEER_THRESHOLD = 2;

/** Clamp a packet's outgoing TTL for the topology this node can see. */
export function clampTtlForTopology(ttl: number, peerCount: number): number {
  if (peerCount >= DENSE_PEER_THRESHOLD) return Math.min(ttl, DENSE_TTL_CAP);
  // Sparse or middling: leave it alone. A thin network needs its full reach.
  return ttl;
}

/** How long a packet stays available to replay to arriving peers. */
export const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
export const DEFAULT_CACHE_MAX = 500;

export interface MeshNodeOptions {
  now?: () => number;
  schedule?: (fn: () => void, delayMs: number) => void;
  random?: () => number;
  seenTtlMs?: number;
  seenMax?: number;
  cacheTtlMs?: number;
  cacheMax?: number;
  minJitterMs?: number;
  maxJitterMs?: number;
  onError?: (error: Error) => void;
}

interface CachedPacket {
  packet: Packet;
  at: number;
}

export type DeliveryHandler = (packet: Packet, fromPeerId: string) => void;

export class MeshNode {
  readonly id: string;

  private peers = new Map<string, PacketChannel>();
  private seen: SeenSet;
  private cache: CachedPacket[] = [];
  private handlers = new Set<DeliveryHandler>();
  private detach = new Map<string, () => void>();

  private readonly now: () => number;
  private readonly schedule: (fn: () => void, delayMs: number) => void;
  private readonly random: () => number;
  private readonly cacheTtlMs: number;
  private readonly cacheMax: number;
  private readonly minJitterMs: number;
  private readonly maxJitterMs: number;
  private readonly onError: (error: Error) => void;

  /** Counters for diagnostics and for asserting on traffic in tests. */
  readonly stats = { originated: 0, received: 0, relayed: 0, deduped: 0, expired: 0 };

  constructor(id: string, options: MeshNodeOptions = {}) {
    this.id = id;
    this.now = options.now ?? Date.now;
    this.schedule =
      options.schedule ?? ((fn, delay) => void setTimeout(fn, delay));
    this.random = options.random ?? Math.random;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cacheMax = options.cacheMax ?? DEFAULT_CACHE_MAX;
    this.minJitterMs = options.minJitterMs ?? MIN_RELAY_JITTER_MS;
    this.maxJitterMs = options.maxJitterMs ?? MAX_RELAY_JITTER_MS;
    this.onError = options.onError ?? (() => {});
    this.seen = new SeenSet(options.seenTtlMs, options.seenMax, this.now);
  }

  get peerCount(): number {
    return this.peers.size;
  }

  get peerIds(): string[] {
    return [...this.peers.keys()];
  }

  get cacheSize(): number {
    return this.cache.length;
  }

  onDelivery(handler: DeliveryHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Register a peer and start listening to it.
   *
   * The cached backlog is flushed to the new peer, which is what makes a board
   * appear populated to someone who has only just walked in.
   */
  addPeer(peerId: string, channel: PacketChannel): void {
    if (this.peers.has(peerId)) return;

    this.peers.set(peerId, channel);
    this.detach.set(
      peerId,
      channel.onPacket((packet) => this.handleIncoming(packet, peerId))
    );

    this.flushCacheTo(peerId);
  }

  removePeer(peerId: string): void {
    this.detach.get(peerId)?.();
    this.detach.delete(peerId);
    this.peers.delete(peerId);
  }

  /** Originate a packet: cache it, mark it seen, and send to every peer. */
  async originate(packet: Packet): Promise<void> {
    this.seen.add(packet.messageId);
    this.remember(packet);
    this.stats.originated++;
    await this.sendToPeers(packet, null);
  }

  /**
   * Handle a packet arriving from `fromPeerId`.
   *
   * Delivery to the app happens immediately; the relay is deferred by jitter.
   * Doing it in that order means a node's own user sees a post as soon as it
   * arrives, rather than waiting on a delay that exists only to protect the
   * radio.
   */
  private handleIncoming(packet: Packet, fromPeerId: string): void {
    if (this.seen.add(packet.messageId)) {
      this.stats.deduped++;
      return;
    }

    this.stats.received++;
    this.remember(packet);

    for (const handler of this.handlers) {
      try {
        handler(packet, fromPeerId);
      } catch (e) {
        this.onError(e as Error);
      }
    }

    const decremented = decrementTtl(packet);
    if (!decremented) {
      this.stats.expired++;
      return;
    }

    // Spend fewer hops where the network is dense enough not to need them.
    const clamped = clampTtlForTopology(decremented.ttl, this.peers.size);
    const next = clamped === decremented.ttl ? decremented : { ...decremented, ttl: clamped };

    this.schedule(() => {
      this.stats.relayed++;
      void this.sendToPeers(next, fromPeerId).catch((e) => this.onError(e as Error));
    }, this.jitter());
  }

  /** Send to every peer except `exclude` (the one it came from). */
  private async sendToPeers(packet: Packet, exclude: string | null): Promise<void> {
    const sends: Promise<void>[] = [];
    for (const [peerId, channel] of this.peers) {
      if (peerId === exclude) continue;
      sends.push(channel.send(packet).catch((e) => this.onError(e as Error)));
    }
    await Promise.all(sends);
  }

  private jitter(): number {
    const span = Math.max(0, this.maxJitterMs - this.minJitterMs);
    return this.minJitterMs + Math.floor(this.random() * (span + 1));
  }

  private remember(packet: Packet): void {
    this.cache.push({ packet, at: this.now() });
    this.expireCache();
  }

  private expireCache(): void {
    const cutoff = this.now() - this.cacheTtlMs;
    // Appended in time order, so everything before the first live entry is stale.
    let firstLive = 0;
    while (firstLive < this.cache.length && this.cache[firstLive].at < cutoff) firstLive++;
    if (firstLive > 0) this.cache.splice(0, firstLive);

    if (this.cache.length > this.cacheMax) {
      this.cache.splice(0, this.cache.length - this.cacheMax);
    }
  }

  /**
   * Replay the backlog to a peer that has just appeared.
   *
   * The packets go out with their stored TTL untouched: this is not a relay
   * hop, it is the same packet being offered to someone who was not reachable
   * when it first went round. The receiving node's own seen-set decides whether
   * it is new to them.
   */
  private flushCacheTo(peerId: string): void {
    const channel = this.peers.get(peerId);
    if (!channel) return;

    this.expireCache();
    for (const { packet } of [...this.cache]) {
      void channel.send(packet).catch((e) => this.onError(e as Error));
    }
  }
}
