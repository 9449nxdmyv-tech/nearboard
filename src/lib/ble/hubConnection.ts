import type { Post } from '$lib/domain/types';
import type { EngagementKind } from '$lib/domain/engagement';
import { serializePost, deserializePosts } from '$lib/domain/wire';
import {
  SERVICE_UUID,
  CHAR_HUB_META,
  CHAR_POST_REQUEST,
  CHAR_POST_RESPONSE,
  CHAR_POST_UPLOAD,
  CHAR_ENGAGEMENT
} from './bluetooth';
import { frameString, readFramed } from './framing';

const MAX_CHUNK = 512; // BLE ATT MTU safe limit

/** Encode string → ArrayBuffer (UTF-8), ready for writeValue */
function encode(s: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(s);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Decode DataView → string (UTF-8), honouring the view's window into its buffer */
function decode(dv: DataView): string {
  return new TextDecoder().decode(
    new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)
  );
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

    // Read the length-prefixed response: 4-byte big-endian header, then payload.
    const resChar = await this.service!.getCharacteristic(CHAR_POST_RESPONSE);
    const framed = await readFramed(() => resChar.readValue());
    return framed ? deserializePosts(framed) : [];
  }

  /** Upload a post to the hub (chunked write) */
  async uploadPost(post: Post): Promise<void> {
    const char = await this.service!.getCharacteristic(CHAR_POST_UPLOAD);
    const data = frameString(serializePost(post));

    for (let offset = 0; offset < data.byteLength; offset += MAX_CHUNK) {
      const chunk = data.slice(offset, offset + MAX_CHUNK);
      await char.writeValue(chunk);
    }
  }

  /** Send engagement: "postId|authorId|kind|on" */
  async sendEngagement(
    postId: string,
    authorId: string,
    kind: EngagementKind,
    on: boolean = true
  ): Promise<void> {
    const char = await this.service!.getCharacteristic(CHAR_ENGAGEMENT);
    const payload = `${postId}|${authorId}|${kind}|${on ? 1 : 0}`;
    await char.writeValue(encode(payload));
  }
}
