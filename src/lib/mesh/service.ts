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
import { NostrLink } from './nostr.ts';
import { MeshScanner } from './central.ts';
import { makePacket, PacketType, type Packet } from './packet.ts';
import { encodeAnnounce, decodeAnnounce, NearbyHubs, type AnnouncedHub } from './announce.ts';

import { preflight, applyFix, type Blocker, type FixAction } from './readiness.ts';
import { getOrCreateIdentity } from '$lib/crypto/identity';
import { verifyPost } from '$lib/crypto/signing';
import { toWire, fromWire, type WirePost } from '$lib/domain/wire';
import { mergePost } from '$lib/domain/mergePost';
import { savePost, getPost, getAllHubs } from '$lib/db/localDb';
import type { Post } from '$lib/domain/types';

const isNative = Capacitor.isNativePlatform();

/**
 * Sweep cadence, adapted to whether anyone has been found.
 *
 * A flat interval is wrong at both ends. Alone, it makes walking into a room
 * feel slow — the mesh should be eager when it has nobody. Already connected,
 * it burns battery scanning for peers that are mostly already known, so it
 * should back off and jitter so a group of phones does not synchronise into
 * simultaneous scan windows.
 */
const SCAN_INTERVAL_ISOLATED_MS = 4_000;
const SCAN_INTERVAL_CONNECTED_MIN_MS = 15_000;
const SCAN_INTERVAL_CONNECTED_MAX_MS = 30_000;
/** How long each scan window stays open. */
const SCAN_DURATION_MS = 6_000;
/** Idle gap between stopping a scan and connecting, so the stack settles. */
const SCAN_SETTLE_MS = 600;
/** Attempts per peer before giving up until the next sweep. */
const CONNECT_ATTEMPTS = 3;
/** Base backoff between connect attempts; multiplied by attempt number. */
const CONNECT_RETRY_MS = 800;

/** The mesh service and its two characteristics, passed to the native plugins. */
const MESH_UUIDS = {
  serviceUuid: MESH_SERVICE_UUID,
  inboundUuid: CHAR_INBOUND,
  outboundUuid: CHAR_OUTBOUND
};

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
  private scanner: MeshScanner | null = null;
  private senderId = '';

  /** Boards other people nearby are carrying. */
  private nearbyHubs = new NearbyHubs();
  private nearbyListeners = new Set<(hubs: AnnouncedHub[]) => void>();

  /** Hubs currently carried over the internet, keyed by hubId. */
  private internetLinks = new Map<string, NostrLink>();

  /** Peers seen in a scan and not yet connected to. */
  private pendingPeers = new Set<string>();

  /** Peers we have an open channel to, so we do not connect twice. */
  private connected = new Set<string>();
  private scanTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** Subscribe to boards seen nearby. Fires with the current list immediately. */
  onNearbyHubs(listener: (hubs: AnnouncedHub[]) => void): () => void {
    this.nearbyListeners.add(listener);
    listener(this.nearbyHubs.list());
    return () => this.nearbyListeners.delete(listener);
  }

  /** Boards currently visible on the mesh. */
  getNearbyHubs(): AnnouncedHub[] {
    return this.nearbyHubs.list();
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

    this.node.onDelivery((packet, fromPeerId) => {
      this.setStatus({ lastPacketAt: Date.now() });
      void this.handlePacket(packet, fromPeerId);
    });

    this.setStatus({ phase: 'searching', blocker: null });

    if (isNative) {
      // Advertising first, then scanning. Never both plus a connect attempt at
      // once: Android's stack rejects a connection issued while a scan is live
      // with "LE Create Connection attempt failed, status=0x12", surfacing as
      // the generic GATT 133. `diagnoseScan` is deliberately not called here —
      // running a second scan concurrently reproduces exactly that.
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
      clearTimeout(this.scanTimer);
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
        this.nearbyHubs.forgetPeer(peerId);
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
    // Our own plugin, not the community one. The community plugin resolves a
    // device with getRemoteDevice(address), which assumes a PUBLIC address
    // type, while Android advertises with a RANDOM one and rotates it — so
    // every connect targeted a wrong-typed, possibly stale address and timed
    // out. This keeps the BluetoothDevice the scanner handed over.
    this.scanner = new MeshScanner({
      // Collected here rather than in sweep(), because the scan callback is a
      // long-lived native listener — a per-sweep collector would miss peers
      // reported outside its own window.
      onPeerFound: (deviceId) => {
        if (!this.connected.has(deviceId)) this.pendingPeers.add(deviceId);
      },
      onPeerReady: (deviceId, link) => {
        if (this.connected.has(deviceId)) return;
        const channel = new PacketChannel(link, deviceId, (e) =>
          this.setStatus({ blocker: this.toBlocker(e) })
        );
        channel.start();
        this.node?.addPeer(deviceId, channel);
        this.connected.add(deviceId);
        this.notePeerChange();
      },
      onPeerLost: (deviceId) => {
        this.nearbyHubs.forgetPeer(deviceId);
        this.node?.removePeer(deviceId);
        this.connected.delete(deviceId);
        this.notePeerChange();
      },
      onError: (e) => console.warn('[mesh] central:', e.message)
    });

    await this.scanner.start(MESH_UUIDS);
    void this.sweepLoop();
  }

  /** How long to wait before the next sweep, given what we found last time. */
  private nextSweepDelay(): number {
    if ((this.node?.peerCount ?? 0) === 0) return SCAN_INTERVAL_ISOLATED_MS;
    const span = SCAN_INTERVAL_CONNECTED_MAX_MS - SCAN_INTERVAL_CONNECTED_MIN_MS;
    return SCAN_INTERVAL_CONNECTED_MIN_MS + Math.floor(Math.random() * span);
  }

  /**
   * Sweep on a self-scheduling loop rather than a fixed interval.
   *
   * A fixed interval can overlap its own previous run once a sweep takes longer
   * than the gap — connect retries make that routine — and two concurrent scans
   * are exactly what produces GATT 133.
   */
  private async sweepLoop(): Promise<void> {
    while (this.isRunning) {
      await this.sweep();
      if (!this.isRunning) break;
      await new Promise((r) => {
        this.scanTimer = setTimeout(r, this.nextSweepDelay());
      });
    }
  }

  /** One scan window: look for peers, connect to any we do not already have. */
  private async sweep(): Promise<void> {
    if (!this.node || !this.scanner) return;

    try {
      await this.scanner.scan(MESH_UUIDS);
    } catch (e) {
      this.setStatus({ blocker: this.toBlocker(e as Error, 'Scan failed') });
      return;
    }

    await new Promise((r) => setTimeout(r, SCAN_DURATION_MS));
    await this.scanner.stopScan().catch(() => {});

    // The stack needs a moment after a scan before it will accept a connection.
    await new Promise((r) => setTimeout(r, SCAN_SETTLE_MS));

    for (const deviceId of this.pendingPeers) {
      if (this.connected.has(deviceId)) continue;
      await this.connectTo(deviceId);
    }
    this.pendingPeers.clear();
  }

  /**
   * Connect, retrying on the transient failures Android produces routinely.
   *
   * GATT 133 is generic and frequently succeeds on a later attempt; treating
   * the first failure as final makes a peer that is plainly in range look
   * unreachable.
   */
  private async connectTo(deviceId: string): Promise<void> {
    if (!this.node || !this.scanner || this.connected.has(deviceId)) return;

    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
      try {
        await this.scanner.connect(deviceId);
        return; // onPeerReady wires up the channel
      } catch (e) {
        const message = (e as Error)?.message ?? String(e);
        console.log(`[mesh] connect to ${deviceId} attempt ${attempt} failed: ${message}`);
        if (attempt < CONNECT_ATTEMPTS) {
          await this.scanner.disconnect(deviceId).catch(() => {});
          await new Promise((r) => setTimeout(r, CONNECT_RETRY_MS * attempt));
        }
      }
    }
    console.log(`[mesh] giving up on ${deviceId} after ${CONNECT_ATTEMPTS} attempts`);
  }

  // ---- Internet transport ----

  /**
   * Join a hub's traffic over Nostr as well as Bluetooth.
   *
   * Off by default and per hub: local-first stays the default and reaching the
   * internet is the user's choice. Payloads are encrypted with a key derived
   * from the hub name before they leave the device, so relays store opaque
   * blobs rather than readable posts.
   *
   * The relay becomes an ordinary peer, so `MeshNode` bridges the two
   * transports without knowing the difference — a post that arrives over
   * Bluetooth is republished to Nostr and vice versa, letting a phone in the
   * room carry the board to people who are not.
   */
  async joinOverInternet(hubId: string, hubName: string): Promise<void> {
    if (!this.node || this.internetLinks.has(hubId)) return;

    const link = new NostrLink({
      hubId,
      hubName,
      onError: (e) => console.warn('[mesh] nostr:', e.message)
    });

    try {
      await link.start();
      const peerId = `nostr:${hubId}`;
      const channel = new PacketChannel(link, peerId, (e) =>
        this.setStatus({ blocker: this.toBlocker(e) })
      );
      channel.start();
      this.node.addPeer(peerId, channel);
      this.internetLinks.set(hubId, link);
      this.notePeerChange();
    } catch (e) {
      console.warn('[mesh] could not join over the internet:', (e as Error).message);
    }
  }

  /** Stop carrying a hub over the internet. Bluetooth is unaffected. */
  async leaveInternet(hubId: string): Promise<void> {
    const link = this.internetLinks.get(hubId);
    if (!link) return;
    this.node?.removePeer(`nostr:${hubId}`);
    this.internetLinks.delete(hubId);
    await link.stop();
    this.notePeerChange();
  }

  /** Is this hub currently reachable over the internet? */
  isOnInternet(hubId: string): boolean {
    return this.internetLinks.has(hubId);
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

  /** Tell peers which boards this device carries. */
  private async announceHubs(): Promise<void> {
    if (!this.node) return;
    const hubs = await getAllHubs();
    if (hubs.length === 0) return;

    await this.node.originate(
      encodeAnnounce(
        this.senderId,
        hubs.map((h) => ({ hubId: h.hubId, name: h.name }))
      )
    );
  }

  private async handlePacket(packet: Packet, fromPeerId?: string): Promise<void> {
    if (packet.type === PacketType.Announce) {
      const hubs = decodeAnnounce(packet);
      if (hubs.length > 0 && this.nearbyHubs.record(hubs, fromPeerId ?? packet.senderId)) {
        for (const listener of this.nearbyListeners) listener(this.nearbyHubs.list());
      }
      return;
    }

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

    // Authorship is checked before anything else touches storage.
    //
    // Without this, authorId is a claim rather than a fact: any peer could
    // publish a post as anyone, and every device on the flood would relay and
    // store the forgery. Verification needs only the post, since authorId is
    // the public key its signature verifies against.
    //
    // Unsigned posts are rejected outright rather than accepted as
    // "unverified". A tier that skips the check is a tier an attacker simply
    // opts into by omitting the signature.
    if (!verifyPost(incoming)) {
      console.warn(`[mesh] rejected post ${incoming.postId.slice(0, 8)}: bad or missing signature`);
      return;
    }

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
    const previous = this.status.peerCount;
    const peerCount = this.node?.peerCount ?? 0;

    // A peer that just arrived has no idea what boards we hold, and we have no
    // idea what they hold. Announcing on change is what populates "boards near
    // you" without anyone typing anything.
    if (peerCount > previous) {
      void this.announceHubs().catch(() => {
        // Nothing to announce, or the link went away again.
      });
    }

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
