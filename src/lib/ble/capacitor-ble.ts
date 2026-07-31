/**
 * Capacitor BLE implementation using @capacitor-community/bluetooth-le.
 * Used on native iOS/Android. Web falls back to Web Bluetooth (bluetooth.ts).
 */

import { BleClient, numberToUUID } from '@capacitor-community/bluetooth-le';
import { SERVICE_UUID, CHAR_HUB_META, CHAR_POST_REQUEST, CHAR_POST_RESPONSE, CHAR_POST_UPLOAD, CHAR_ENGAGEMENT } from './bluetooth';
import { frameString, readFramed } from './framing';
import type { EngagementKind } from '$lib/domain/engagement';
import type { Post } from '$lib/domain/types';
import { serializePost, deserializePosts } from '$lib/domain/wire';

const MAX_CHUNK = 512;

let initialized = false;

export async function initBle(): Promise<void> {
  if (initialized) return;
  await BleClient.initialize({ androidNeverForLocation: true });
  initialized = true;
}

export function isBluetoothSupported(): boolean {
  return true; // Always available on native
}

export async function requestDevice(): Promise<string> {
  await initBle();
  const device = await BleClient.requestDevice({
    services: [SERVICE_UUID]
  });
  return device.deviceId;
}

/** Encode string to DataView */
function encodeToDataView(s: string): DataView {
  const encoded = new TextEncoder().encode(s);
  return new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
}

/** Decode DataView to string, honouring the view's window into its buffer */
function decodeFromDataView(dv: DataView): string {
  return new TextDecoder().decode(
    new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)
  );
}

export class CapacitorHubConnection {
  private deviceId: string | null = null;

  get connected(): boolean {
    return this.deviceId !== null;
  }

  async connect(deviceId: string): Promise<void> {
    await initBle();
    await BleClient.connect(deviceId, () => {
      this.deviceId = null;
    });
    this.deviceId = deviceId;
    // Small delay for GATT table stabilization
    await new Promise(r => setTimeout(r, 300));
  }

  async disconnect(): Promise<void> {
    if (this.deviceId) {
      try {
        await BleClient.disconnect(this.deviceId);
      } catch {
        // Already disconnected
      }
      this.deviceId = null;
    }
  }

  async getHubMeta(): Promise<{ hubId: string; name: string; description: string }> {
    const result = await BleClient.read(this.deviceId!, SERVICE_UUID, CHAR_HUB_META);
    const parts = decodeFromDataView(result).split('|');
    return {
      hubId: parts[0] ?? '',
      name: parts[1] ?? '',
      description: parts[2] ?? ''
    };
  }

  async getPosts(lastSeenTimestamp: number): Promise<Post[]> {
    // Write 8-byte big-endian timestamp
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setBigUint64(0, BigInt(lastSeenTimestamp), false);

    await BleClient.write(this.deviceId!, SERVICE_UUID, CHAR_POST_REQUEST, dv);

    // Read the length-prefixed response: 4-byte big-endian header, then payload.
    const framed = await readFramed(() =>
      BleClient.read(this.deviceId!, SERVICE_UUID, CHAR_POST_RESPONSE)
    );
    return framed ? deserializePosts(framed) : [];
  }

  async uploadPost(post: Post): Promise<void> {
    const data = new Uint8Array(frameString(serializePost(post)));

    for (let offset = 0; offset < data.byteLength; offset += MAX_CHUNK) {
      const chunk = data.slice(offset, offset + MAX_CHUNK);
      const dv = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      await BleClient.write(this.deviceId!, SERVICE_UUID, CHAR_POST_UPLOAD, dv);
    }
  }

  async sendEngagement(
    postId: string,
    authorId: string,
    kind: EngagementKind,
    on: boolean = true
  ): Promise<void> {
    const payload = `${postId}|${authorId}|${kind}|${on ? 1 : 0}`;
    await BleClient.write(this.deviceId!, SERVICE_UUID, CHAR_ENGAGEMENT, encodeToDataView(payload));
  }
}
