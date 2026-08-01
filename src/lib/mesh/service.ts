/**
 * The mesh, as the app sees it.
 *
 * Everything below this file is transport and routing; everything above is
 * posts and hubs. This is the seam: it runs both BLE roles at once, turns
 * discovered peers into router peers, and translates between packets and the
 * app's data model.
 *
 * Running both roles simultaneously is the part that makes this a mesh rather
 * than a client. A device advertises (so others can find it) *and* scans (so it
 * can find others). Which side happened to open a connection is irrelevant
 * once the link exists — `MeshNode` treats both identically.
 */

import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';

import { MeshNode } from './router.ts';
import { PacketChannel, MESH_SERVICE_UUID, CHAR_INBOUND, CHAR_OUTBOUND } from './transport.ts';
import { CapacitorPacketLink, WebPacketLink } from './links.ts';
import { MeshAdvertiser } from './peripheral.ts';
import { makePacket, PacketType, type Packet } from './packet.ts';

import { preflight, applyFix, type Blocker, type FixAction } from './readiness.ts';
import { getOrCreateIdentity } from '$lib/crypto/identity';
import { toWire, fromWire, type WirePost } from '$lib/domain/wire';
import { mergePost } from '$lib/domain/mergePost';
import { savePost, getPost, getAllHubs } from '$lib/db/localDb';
import type { Post } from '$lib/domain/types';

const isNative = Capacitor.isNativePlatform();

/** How often to sweep for new peers, in ms. */
const SCAN_INTERVAL_MS = 15_000;
/** How long each scan window stays open. */
const SCAN_DURATION_MS = 6_000;

/**
 * What the mesh is doing, as one value the UI can switch on.
 *
 * `searching` and `connected` are deliberately separate from `blocked`: the
 * first two mean everything works and the room is simply quiet, the third means
 * something needs fixing. Collapsing them is what made every failure look like
 * an empty room.
 */
export type MeshPhase =
  | 'idle' // not started yet
  | 'checking' // preflight running
  | 'blocked' // a precondition failed; see `blocker`
  | 'searching' // healthy, nobody in range
  | 'connected'; // healthy, at least one peer

export interface MeshStatus {
  phase: MeshPhase;
  peerCount: number;
  advertising: boolean;
  canAdvertise: boolean;
  blocker: Blocker | null;
  /**
   * When a peer was last connected, and when a packet last arrived. Silence
   * with a timestamp is honest; silence alone cannot be told from a fault.
   */
  lastPeerAt: number | null;
  lastPacketAt: number | null;
}

export type StatusListener = (status: MeshStatus) => void;
export type PostListener = (post: Post) => void;

/** A device id is a UUID; the wire wants 8 bytes of hex. */
function senderIdFrom(deviceId: string): string {
  return deviceId.replace(/-/g, '').slice(0, 16).padEnd(16, '0');
}

export class MeshService {
  private node: MeshNode | null = null;
  private advertiser: MeshAdvertiser | null = null;
  private senderId = '';

  /** Peers we have an open channel to, so we do not connect twice. */
  private connected = new Set<string>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  private statusListeners = new Set<StatusListener>();
  private postListeners = new Set<PostListener>();

  private status: MeshStatus = {
    phase: 'idle',
    peerCount: 0,
    advertising: false,
    canAdvertise: true,
    blocker: null,
    lastPeerAt: null,
    lastPacketAt: null
  };

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  /** Fires whenever a post arrives from the mesh and has been persisted. */
  onPost(listener: PostListener): () => void {
    this.postListeners.add(listener);
    return () => this.postListeners.delete(listener);
  }

  getStatus(): MeshStatus {
    return { ...this.status };
  }

  /** Is the mesh past preflight and actually running? */
  private get isRunning(): boolean {
    return this.status.phase === 'searching' || this.status.phase === 'connected';
  }

  async start(): Promise<void> {
    if (this.isRunning || this.status.phase === 'checking') return;

    // Preflight before anything else, so a missing precondition is reported as
    // itself rather than surfacing later as an unexplained absence of peers.
    this.setStatus({ phase: 'checking', blocker: null });
    const blocker = await preflight();
    if (blocker) {
      this.setStatus({ phase: 'blocked', blocker });
      return;
    }

    const { deviceId } = await getOrCreateIdentity();
    this.senderId = senderIdFrom(deviceId);
    this.node = new MeshNode(this.senderId, {
      onError: (e) => this.setStatus({ blocker: this.toBlocker(e) })
    });

    this.node.onDelivery((packet) => {
      this.setStatus({ lastPacketAt: Date.now() });
      void this.handlePacket(packet);
    });

    this.setStatus({ phase: 'searching', blocker: null });

    if (isNative) {
      // Runs once at startup; the output tells us whether the radio is working
      // at all before any of our own filtering is involved.
      void this.diagnoseScan().catch((e) =>
        console.log(`[mesh-diag] diagnostic scan failed: ${(e as Error).message}`)
      );
      await this.startAdvertising();
      await this.startScanning();
    }
    // On the web there is no peripheral role and no background scan — the user
    // must pick a device from the browser's chooser. `connectToChosenDevice`
    // below covers that path.
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }

    if (isNative) {
      try {
        await BleClient.stopLEScan();
      } catch {
        // Not scanning.
      }
    }

    await this.advertiser?.stop();
    this.advertiser = null;

    this.connected.clear();
    this.node = null;
    this.setStatus({ phase: "idle", advertising: false, peerCount: 0, blocker: null });
  }

  // ---- Publishing ----

  /** Put a post onto the mesh. */
  async publishPost(post: Post): Promise<void> {
    if (!this.node) return;
    const payload = new TextEncoder().encode(JSON.stringify(toWire(post)));
    await this.node.originate(makePacket(PacketType.Post, this.senderId, payload));
  }

  /**
   * Re-publish a post whose engagement changed.
   *
   * The whole post goes out rather than a delta. That looks wasteful, and for a
   * post with an image it is — but engagement is a CRDT keyed by author, so a
   * full copy merges correctly no matter what order copies arrive in, while a
   * delta would need its own dedup and ordering rules to avoid double-counting.
   */
  async publishEngagement(post: Post): Promise<void> {
    await this.publishPost(post);
  }

  // ---- Peripheral role ----

  private async startAdvertising(): Promise<void> {
    this.advertiser = new MeshAdvertiser({
      onPeerConnected: (peerId, link) => {
        if (this.connected.has(peerId)) return;
        const channel = new PacketChannel(link, peerId, (e) =>
          this.setStatus({ blocker: this.toBlocker(e) })
        );
        channel.start();
        this.node?.addPeer(peerId, channel);
        this.connected.add(peerId);
        this.notePeerChange();
      },
      onPeerDisconnected: (peerId) => {
        this.node?.removePeer(peerId);
        this.connected.delete(peerId);
        this.notePeerChange();
      },
      onError: (e) => this.setStatus({ blocker: this.toBlocker(e) })
    });

    try {
      await this.advertiser.start({
        serviceUuid: MESH_SERVICE_UUID,
        inboundUuid: CHAR_INBOUND,
        outboundUuid: CHAR_OUTBOUND,
        localName: 'nearboard'
      });
      this.setStatus({ advertising: true, canAdvertise: true });
    } catch (e) {
      // Not every chipset supports the peripheral role. This is a capability
      // limit, not a blocker: the device still works as a pure central, it just
      // cannot be discovered. Recording it as `canAdvertise: false` lets the UI
      // say so plainly instead of leaving the user wondering why nobody finds
      // them.
      this.advertiser = null;
      this.setStatus({
        advertising: false,
        canAdvertise: false
      });
      console.warn('Peripheral role unavailable:', (e as Error).message);
    }
  }

  // ---- Central role ----

  private async startScanning(): Promise<void> {
    await BleClient.initialize({ androidNeverForLocation: false });
    await this.sweep();
    this.scanTimer = setInterval(() => void this.sweep(), SCAN_INTERVAL_MS);
  }

  /**
   * Scan without a service filter and log everything in range.
   *
   * A filtered scan that returns nothing is ambiguous — it cannot distinguish
   * "no peers here" from "our advertising is invisible" from "the filter is
   * wrong". This separates them: if other devices appear but ours does not,
   * the problem is on the advertising side.
   */
  async diagnoseScan(windowMs = 6000): Promise<string[]> {
    const seen: string[] = [];
    await BleClient.initialize({ androidNeverForLocation: false });
    await BleClient.requestLEScan({ allowDuplicates: false }, (result) => {
      const services = result.device.uuids ?? result.uuids ?? [];
      seen.push(
        `${result.device.deviceId} name=${result.device.name ?? result.localName ?? '?'} ` +
          `rssi=${result.rssi ?? '?'} services=[${services.join(',')}]`
      );
    });
    await new Promise((r) => setTimeout(r, windowMs));
    try {
      await BleClient.stopLEScan();
    } catch {
      // Already stopped.
    }
    console.log(`[mesh-diag] unfiltered scan saw ${seen.length} advertisements`);
    for (const line of seen) console.log(`[mesh-diag] ${line}`);
    return seen;
  }

  /** One scan window: look for peers, connect to any we do not already have. */
  private async sweep(): Promise<void> {
    if (!this.node) return;

    const found = new Set<string>();
    try {
      await BleClient.requestLEScan({ services: [MESH_SERVICE_UUID] }, (result) => {
        console.log(`[mesh-diag] filtered hit: ${result.device.deviceId} ${result.device.name ?? ''}`);
        found.add(result.device.deviceId);
      });
    } catch (e) {
      this.setStatus({ blocker: this.toBlocker(e as Error, "Scan failed") });
      console.log(`[mesh-diag] filtered scan failed: ${(e as Error).message}`);
      return;
    }

    await new Promise((r) => setTimeout(r, SCAN_DURATION_MS));
    try {
      await BleClient.stopLEScan();
    } catch {
      // Already stopped.
    }

    for (const deviceId of found) {
      if (this.connected.has(deviceId)) continue;
      await this.connectTo(deviceId);
    }
  }

  private async connectTo(deviceId: string): Promise<void> {
    if (!this.node || this.connected.has(deviceId)) return;

    // Claim the slot before awaiting, or a scan sweep that overlaps the connect
    // will start a second connection to the same device.
    this.connected.add(deviceId);

    try {
      const link = await CapacitorPacketLink.connect(deviceId);
      const channel = new PacketChannel(link, deviceId, (e) =>
        this.setStatus({ blocker: this.toBlocker(e) })
      );
      channel.start();
      this.node.addPeer(deviceId, channel);
      this.notePeerChange();
    } catch (e) {
      this.connected.delete(deviceId);
      this.setStatus({ blocker: this.toBlocker(e as Error, "Connect failed") });
    }
  }

  /**
   * Web-only: connect to a device the user picked from the browser chooser.
   * Must be called from a user gesture.
   */
  async connectToChosenDevice(): Promise<void> {
    if (!this.node) throw new Error('Mesh is not running');

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [MESH_SERVICE_UUID] }]
    });
    if (this.connected.has(device.id)) return;

    this.connected.add(device.id);
    try {
      const link = await WebPacketLink.connect(device);
      const channel = new PacketChannel(link, device.id, (e) =>
        this.setStatus({ blocker: this.toBlocker(e) })
      );
      channel.start();
      this.node.addPeer(device.id, channel);
      this.notePeerChange();
    } catch (e) {
      this.connected.delete(device.id);
      throw e;
    }
  }

  // ---- Inbound ----

  private async handlePacket(packet: Packet): Promise<void> {
    if (packet.type !== PacketType.Post) return;

    let wire: WirePost;
    try {
      wire = JSON.parse(new TextDecoder().decode(packet.payload)) as WirePost;
    } catch {
      // A peer sending malformed JSON costs us one dropped packet. The router
      // has already relayed it, which is correct — a relay forwards bytes it
      // does not need to understand.
      return;
    }

    if (!wire?.postId || typeof wire.text !== 'string' || !wire.hubId) return;

    const incoming = fromWire(wire);

    // Relay everything, store only what the user has joined. A device that
    // carries traffic for hubs it is not a member of is what makes the mesh
    // work for everyone; showing them would not be.
    const hubs = await getAllHubs();
    if (!hubs.some((h) => h.hubId === incoming.hubId)) return;

    const existing = await getPost(incoming.postId);
    const merged = mergePost(existing, incoming);
    await savePost(merged);

    for (const listener of this.postListeners) listener(merged);
  }

  // ---- Status ----

  /**
   * Recompute peer count and phase together.
   *
   * Phase is derived from peer count rather than set by hand, so `connected`
   * and `searching` cannot drift out of step with reality — which is precisely
   * the sort of lie this refactor exists to prevent.
   */
  private notePeerChange(): void {
    const peerCount = this.node?.peerCount ?? 0;
    const patch: Partial<MeshStatus> = { peerCount };

    if (this.isRunning) {
      patch.phase = peerCount > 0 ? 'connected' : 'searching';
    }
    if (peerCount > 0) {
      patch.lastPeerAt = Date.now();
      // A working connection clears any earlier transient failure.
      patch.blocker = null;
    }

    this.setStatus(patch);
  }

  /**
   * Turn a runtime error into something a user can act on.
   *
   * Transient radio errors are not preconditions, so they do not move the phase
   * to `blocked` — the mesh keeps running and retrying. They are surfaced so a
   * quiet app is never quiet for an unexplained reason.
   */
  private toBlocker(error: Error, context?: string): Blocker {
    const message = error?.message ?? String(error);
    return {
      kind: 'error',
      title: context ?? 'Bluetooth problem',
      detail: message,
      actionLabel: 'Try again',
      action: 'retry'
    };
  }

  /** Run the fix a blocker offers, then re-check. */
  async resolveBlocker(action: FixAction): Promise<void> {
    const readyToRetry = await applyFix(action);
    if (readyToRetry) {
      this.setStatus({ phase: 'idle', blocker: null });
      await this.start();
    }
  }

  /** Re-run preflight and start, for a manual retry after changing settings. */
  async retry(): Promise<void> {
    this.setStatus({ phase: 'idle', blocker: null });
    await this.start();
  }

  private setStatus(patch: Partial<MeshStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.statusListeners) listener(this.status);
  }
}

/** The app runs a single mesh. */
export const mesh = new MeshService();
