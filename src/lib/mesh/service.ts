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

export interface MeshStatus {
  running: boolean;
  advertising: boolean;
  peerCount: number;
  error: string | null;
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
    running: false,
    advertising: false,
    peerCount: 0,
    error: null
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

  async start(): Promise<void> {
    if (this.status.running) return;

    const { deviceId } = await getOrCreateIdentity();
    this.senderId = senderIdFrom(deviceId);
    this.node = new MeshNode(this.senderId, {
      onError: (e) => this.setStatus({ error: e.message })
    });

    this.node.onDelivery((packet) => {
      void this.handlePacket(packet);
    });

    this.setStatus({ running: true, error: null });

    if (isNative) {
      await this.startAdvertising();
      await this.startScanning();
    }
    // On the web there is no peripheral role and no background scan — the user
    // must pick a device from the browser's chooser. `connectToChosenDevice`
    // below covers that path.
  }

  async stop(): Promise<void> {
    if (!this.status.running) return;

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
    this.setStatus({ running: false, advertising: false, peerCount: 0 });
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
          this.setStatus({ error: e.message })
        );
        channel.start();
        this.node?.addPeer(peerId, channel);
        this.connected.add(peerId);
        this.setStatus({ peerCount: this.node?.peerCount ?? 0 });
      },
      onPeerDisconnected: (peerId) => {
        this.node?.removePeer(peerId);
        this.connected.delete(peerId);
        this.setStatus({ peerCount: this.node?.peerCount ?? 0 });
      },
      onError: (e) => this.setStatus({ error: e.message })
    });

    try {
      await this.advertiser.start({
        serviceUuid: MESH_SERVICE_UUID,
        inboundUuid: CHAR_INBOUND,
        outboundUuid: CHAR_OUTBOUND,
        localName: 'nearboard'
      });
      this.setStatus({ advertising: true });
    } catch (e) {
      // Not every chipset supports the peripheral role. The device is still a
      // useful mesh member as a pure central — it just cannot be discovered.
      this.advertiser = null;
      this.setStatus({
        advertising: false,
        error: `Cannot advertise: ${(e as Error).message}`
      });
    }
  }

  // ---- Central role ----

  private async startScanning(): Promise<void> {
    await BleClient.initialize({ androidNeverForLocation: true });
    await this.sweep();
    this.scanTimer = setInterval(() => void this.sweep(), SCAN_INTERVAL_MS);
  }

  /** One scan window: look for peers, connect to any we do not already have. */
  private async sweep(): Promise<void> {
    if (!this.node) return;

    const found = new Set<string>();
    try {
      await BleClient.requestLEScan({ services: [MESH_SERVICE_UUID] }, (result) => {
        found.add(result.device.deviceId);
      });
    } catch (e) {
      this.setStatus({ error: `Scan failed: ${(e as Error).message}` });
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
        this.setStatus({ error: e.message })
      );
      channel.start();
      this.node.addPeer(deviceId, channel);
      this.setStatus({ peerCount: this.node.peerCount, error: null });
    } catch (e) {
      this.connected.delete(deviceId);
      this.setStatus({ error: `Connect failed: ${(e as Error).message}` });
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
        this.setStatus({ error: e.message })
      );
      channel.start();
      this.node.addPeer(device.id, channel);
      this.setStatus({ peerCount: this.node.peerCount, error: null });
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

  private setStatus(patch: Partial<MeshStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.statusListeners) listener(this.status);
  }
}

/** The app runs a single mesh. */
export const mesh = new MeshService();
