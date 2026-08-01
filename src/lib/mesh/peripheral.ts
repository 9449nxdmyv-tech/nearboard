/**
 * The peripheral role, bridged to the mesh.
 *
 * `links.ts` covers the central half: connecting out to something that
 * advertises. This is the other half — being the thing that advertises, so
 * another phone can find and write to us. A mesh needs both on every device.
 *
 * Each subscribed central becomes a `PacketLink`, so from `MeshNode`'s point of
 * view a peer reached because they connected to us is indistinguishable from
 * one we connected to. That symmetry is the whole point: routing does not care
 * which side opened the connection.
 */

import { registerPlugin } from '@capacitor/core';
import type { PacketLink } from './transport.ts';
import { DEFAULT_MTU, MIN_MTU } from './fragment.ts';

export interface PeerEvent {
  centralId: string;
  mtu?: number;
}

export interface FrameEvent {
  centralId: string;
  /** base64 — the Capacitor bridge is JSON, so bytes cannot cross raw. */
  data: string;
}

export interface MeshPeripheralPlugin {
  startAdvertising(options: {
    serviceUuid: string;
    inboundUuid: string;
    outboundUuid: string;
    localName?: string;
  }): Promise<void>;
  stopAdvertising(): Promise<void>;
  notify(options: { data: string; centralId?: string }): Promise<{ sent?: number; queued?: boolean }>;
  getSubscribers(): Promise<{ centralIds: string[] }>;
  addListener(
    event: 'peerConnected' | 'peerDisconnected',
    handler: (info: PeerEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: 'frameReceived',
    handler: (info: FrameEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: 'stateChange',
    handler: (info: { state: string; message?: string }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

export const MeshPeripheral = registerPlugin<MeshPeripheralPlugin>('MeshPeripheral');

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

/** One subscribed central, presented as an ordinary link. */
class InboundPeerLink implements PacketLink {
  readonly mtu: number;
  private centralId: string;
  private handlers = new Set<(frame: Uint8Array) => void>();

  constructor(centralId: string, mtu: number) {
    this.centralId = centralId;
    // A central that has not negotiated reports the 23-byte default, which
    // cannot carry a fragment. Clamp so fragmentation produces something
    // sendable rather than throwing on every write.
    this.mtu = Math.max(MIN_MTU, mtu || DEFAULT_MTU);
  }

  async sendFrame(frame: Uint8Array): Promise<void> {
    await MeshPeripheral.notify({
      data: toBase64(frame),
      centralId: this.centralId
    });
  }

  onFrame(handler: (frame: Uint8Array) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Called by the advertiser when a frame arrives from this central. */
  deliver(frame: Uint8Array): void {
    for (const handler of this.handlers) handler(frame);
  }
}

export interface AdvertiserEvents {
  onPeerConnected?: (peerId: string, link: PacketLink) => void;
  onPeerDisconnected?: (peerId: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Runs the peripheral role: advertises, accepts subscribers, and surfaces each
 * as a link the router can use.
 */
export class MeshAdvertiser {
  private links = new Map<string, InboundPeerLink>();
  private removers: (() => Promise<void>)[] = [];
  private events: AdvertiserEvents;
  private running = false;

  constructor(events: AdvertiserEvents = {}) {
    this.events = events;
  }

  get peerCount(): number {
    return this.links.size;
  }

  async start(options: {
    serviceUuid: string;
    inboundUuid: string;
    outboundUuid: string;
    localName?: string;
  }): Promise<void> {
    if (this.running) return;

    const connected = await MeshPeripheral.addListener('peerConnected', (info) => {
      const link = new InboundPeerLink(info.centralId, info.mtu ?? DEFAULT_MTU);
      this.links.set(info.centralId, link);
      this.events.onPeerConnected?.(info.centralId, link);
    });

    const disconnected = await MeshPeripheral.addListener('peerDisconnected', (info) => {
      this.links.delete(info.centralId);
      this.events.onPeerDisconnected?.(info.centralId);
    });

    const frames = await MeshPeripheral.addListener('frameReceived', (info) => {
      // A write can arrive before the central subscribes to notifications, so
      // the link may not exist yet. Dropping is correct: without a subscription
      // there is no way to answer, and the peer will resend once established.
      const link = this.links.get(info.centralId);
      if (!link) return;
      try {
        link.deliver(fromBase64(info.data));
      } catch (e) {
        this.events.onError?.(e as Error);
      }
    });

    const state = await MeshPeripheral.addListener('stateChange', (info) => {
      if (info.state === 'error') {
        this.events.onError?.(new Error(info.message ?? 'peripheral error'));
      }
    });

    this.removers = [connected, disconnected, frames, state].map((h) => h.remove);

    await MeshPeripheral.startAdvertising(options);
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    await MeshPeripheral.stopAdvertising();
    for (const remove of this.removers) await remove();
    this.removers = [];
    this.links.clear();
    this.running = false;
  }
}
