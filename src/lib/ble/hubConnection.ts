import type { Post } from '$lib/domain/types';
import {
  SERVICE_UUID,
  CHAR_HUB_META,
  CHAR_POST_REQUEST,
  CHAR_POST_RESPONSE,
  CHAR_POST_UPLOAD,
  CHAR_ENGAGEMENT
} from './bluetooth';

const MAX_CHUNK = 512; // BLE ATT MTU safe limit

/** Encode string → Uint8Array (UTF-8) */
function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Decode DataView → string (UTF-8) */
function decode(dv: DataView): string {
  return new TextDecoder().decode(dv.buffer);
}

/**
 * Manages a connection to a single BLE hub (peripheral).
 *
 * FUTURE: For Capacitor native, replace Web Bluetooth calls in this class
 * with @capacitor-community/bluetooth-le equivalents via bleAdapter.ts.
 */
export class HubConnection {
  private server: BluetoothRemoteGATTServer | null = null;
  private service: BluetoothRemoteGATTService | null = null;

  get connected(): boolean {
    return this.server?.connected ?? false;
  }

  async connect(device: BluetoothDevice): Promise<void> {
    if (!device.gatt) throw new Error('GATT not available on device');
    this.server = await device.gatt.connect();
    // Small delay to let the peripheral's GATT table stabilize
    await new Promise(r => setTimeout(r, 300));
    try {
      this.service = await this.server.getPrimaryService(SERVICE_UUID);
    } catch (e: any) {
      this.server.disconnect();
      throw new Error(`Service discovery failed: ${e.message}`);
    }
  }

  async disconnect(): Promise<void> {
    this.server?.disconnect();
    this.server = null;
    this.service = null;
  }

  /** Read hub metadata: "hubId|name|description" */
  async getHubMeta(): Promise<{ hubId: string; name: string; description: string }> {
    const char = await this.service!.getCharacteristic(CHAR_HUB_META);
    const value = await char.readValue();
    const parts = decode(value).split('|');
    return {
      hubId: parts[0] ?? '',
      name: parts[1] ?? '',
      description: parts[2] ?? ''
    };
  }

  /**
   * Request posts newer than lastSeenTimestamp.
   * Writes timestamp to POST_REQUEST, then reads chunked JSON from POST_RESPONSE.
   */
  async getPosts(lastSeenTimestamp: number): Promise<Post[]> {
    // Write 8-byte big-endian timestamp
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setBigUint64(0, BigInt(lastSeenTimestamp), false); // big-endian

    const reqChar = await this.service!.getCharacteristic(CHAR_POST_REQUEST);
    await reqChar.writeValue(buf);

    // Read response (may be chunked — keep reading until empty or complete JSON)
    const resChar = await this.service!.getCharacteristic(CHAR_POST_RESPONSE);
    let json = '';
    // Simple chunked read: keep reading until we get valid JSON
    for (let i = 0; i < 100; i++) {
      const chunk = await resChar.readValue();
      const text = decode(chunk);
      if (!text) break;
      json += text;
      try {
        return JSON.parse(json) as Post[];
      } catch {
        // Incomplete JSON, continue reading chunks
      }
    }

    return json ? (JSON.parse(json) as Post[]) : [];
  }

  /** Upload a post to the hub (chunked write) */
  async uploadPost(post: Post): Promise<void> {
    const char = await this.service!.getCharacteristic(CHAR_POST_UPLOAD);
    const data = encode(JSON.stringify(post));

    for (let offset = 0; offset < data.length; offset += MAX_CHUNK) {
      const chunk = data.slice(offset, offset + MAX_CHUNK);
      await char.writeValue(chunk);
    }
  }

  /** Send engagement: "postId|deltaLike|deltaReshare" */
  async sendEngagement(
    postId: string,
    deltaLike: number,
    deltaReshare: number = 0
  ): Promise<void> {
    const char = await this.service!.getCharacteristic(CHAR_ENGAGEMENT);
    const payload = `${postId}|${deltaLike}|${deltaReshare}`;
    await char.writeValue(encode(payload));
  }
}
