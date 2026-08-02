/**
 * The central role, over our own native plugin.
 *
 * `links.ts` uses @capacitor-community/bluetooth-le, which is right for talking
 * to a fixed peripheral and wrong for talking to a peer. It resolves a device
 * with `getRemoteDevice(address)`, which always assumes a PUBLIC address type —
 * but Android advertises with a RANDOM address and rotates it. So the connect
 * targets a wrong-typed and possibly already-stale address, and simply times
 * out.
 *
 * That is what every GATT 133 between two Fire tablets turned out to be:
 * discovery worked every time, the peer's address changed between attempts,
 * and no connection ever completed.
 *
 * This binds to a native plugin that keeps the `BluetoothDevice` the scanner
 * handed it. That object carries the address type and refers to the peer as it
 * was actually seen, which is the only thing that reliably connects.
 */

import { registerPlugin } from '@capacitor/core';
import type { PacketLink } from './transport.ts';
import { DEFAULT_MTU, MIN_MTU } from './fragment.ts';

export interface PeerFoundEvent {
  deviceId: string;
  rssi?: number;
}

export interface FrameEvent {
  deviceId: string;
  /** base64 — the Capacitor bridge is JSON, so bytes cannot cross raw. */
  data: string;
}

export interface MeshCentralPlugin {
  startScan(options: {
    serviceUuid: string;
    inboundUuid: string;
    outboundUuid: string;
  }): Promise<void>;
  stopScan(): Promise<void>;
  connectPeer(options: { deviceId: string }): Promise<void>;
  disconnectPeer(options: { deviceId: string }): Promise<void>;
  writePeer(options: { deviceId: string; data: string }): Promise<void>;
  getConnectedPeers(): Promise<{ deviceIds: string[] }>;
  startBackgroundMode(): Promise<void>;
  stopBackgroundMode(): Promise<void>;
  addListener(
    event: 'peerFound' | 'peerReady' | 'peerLost',
    handler: (info: PeerFoundEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: 'frameReceived',
    handler: (info: FrameEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: 'scanFailed',
    handler: (info: { error: string }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

export const MeshCentral = registerPlugin<MeshCentralPlugin>('MeshCentral');

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** One outbound connection, presented as an ordinary link. */
export class NativeCentralLink implements PacketLink {
  readonly mtu: number;
  private deviceId: string;
  private handlers = new Set<(frame: Uint8Array) => void>();

  constructor(deviceId: string, mtu: number = DEFAULT_MTU) {
    this.deviceId = deviceId;
    this.mtu = Math.max(MIN_MTU, mtu);
  }

  async sendFrame(frame: Uint8Array): Promise<void> {
    await MeshCentral.writePeer({ deviceId: this.deviceId, data: toBase64(frame) });
  }

  onFrame(handler: (frame: Uint8Array) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Called by the scanner when a frame arrives from this peer. */
  deliver(frame: Uint8Array): void {
    for (const handler of this.handlers) handler(frame);
  }
}

export interface CentralEvents {
  onPeerFound?: (deviceId: string, rssi?: number) => void;
  onPeerReady?: (deviceId: string, link: NativeCentralLink) => void;
  onPeerLost?: (deviceId: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Runs the central role: scans for peers and connects to them.
 *
 * Connections are surfaced as links, so `MeshNode` cannot tell an outbound
 * connection from an inbound one — which is what makes both halves of the mesh
 * symmetric.
 */
export class MeshScanner {
  private links = new Map<string, NativeCentralLink>();
  private removers: (() => Promise<void>)[] = [];
  private events: CentralEvents;
  private started = false;

  constructor(events: CentralEvents = {}) {
    this.events = events;
  }

  get peerCount(): number {
    return this.links.size;
  }

  async start(options: {
    serviceUuid: string;
    inboundUuid: string;
    outboundUuid: string;
  }): Promise<void> {
    if (this.started) return;

    const found = await MeshCentral.addListener('peerFound', (info) => {
      this.events.onPeerFound?.(info.deviceId, info.rssi);
    });

    const ready = await MeshCentral.addListener('peerReady', (info) => {
      const link = this.links.get(info.deviceId) ?? new NativeCentralLink(info.deviceId);
      this.links.set(info.deviceId, link);
      this.events.onPeerReady?.(info.deviceId, link);
    });

    const lost = await MeshCentral.addListener('peerLost', (info) => {
      this.links.delete(info.deviceId);
      this.events.onPeerLost?.(info.deviceId);
    });

    const frames = await MeshCentral.addListener('frameReceived', (info) => {
      const link = this.links.get(info.deviceId);
      if (!link) return;
      try {
        link.deliver(fromBase64(info.data));
      } catch (e) {
        this.events.onError?.(e as Error);
      }
    });

    const failed = await MeshCentral.addListener('scanFailed', (info) => {
      this.events.onError?.(new Error(info.error));
    });

    this.removers = [found, ready, lost, frames, failed].map((h) => h.remove);
    await MeshCentral.startScan(options);
    this.started = true;
  }

  /** Begin a scan window. Safe to call repeatedly. */
  async scan(options: {
    serviceUuid: string;
    inboundUuid: string;
    outboundUuid: string;
  }): Promise<void> {
    await MeshCentral.startScan(options);
  }

  async stopScan(): Promise<void> {
    await MeshCentral.stopScan();
  }

  /**
   * Connect to a peer.
   *
   * Resolves once the service is discovered and notifications are subscribed,
   * not merely when the link is up — writing at STATE_CONNECTED writes into a
   * GATT table nobody has read yet.
   */
  async connect(deviceId: string): Promise<NativeCentralLink> {
    await MeshCentral.connectPeer({ deviceId });
    const link = this.links.get(deviceId) ?? new NativeCentralLink(deviceId);
    this.links.set(deviceId, link);
    return link;
  }

  async disconnect(deviceId: string): Promise<void> {
    await MeshCentral.disconnectPeer({ deviceId }).catch(() => {});
    this.links.delete(deviceId);
  }

  /**
   * Keep scanning and advertising alive when the app is backgrounded.
   *
   * Android stops both within minutes otherwise, so the mesh would die the
   * moment a phone went into a pocket. The cost is a permanent notification,
   * which the platform requires and which the service makes actionable.
   *
   * No effect on iOS, where background advertising is limited by the OS in a
   * way no app can opt out of.
   */
  async enableBackground(): Promise<void> {
    await MeshCentral.startBackgroundMode().catch(() => {
      // Older Android, or the user denied notifications; the mesh still works
      // while the app is open.
    });
  }

  async disableBackground(): Promise<void> {
    await MeshCentral.stopBackgroundMode().catch(() => {});
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.disableBackground();
    await MeshCentral.stopScan().catch(() => {});
    for (const remove of this.removers) await remove().catch(() => {});
    this.removers = [];
    this.links.clear();
    this.started = false;
  }
}
