/**
 * Platform bindings for `PacketLink`.
 *
 * These are the only files that know whether we are on Web Bluetooth or
 * Capacitor. Everything above them speaks packets.
 *
 * Both are central-role only: they connect out to a peer's GATT server. That is
 * the whole of what the current stack can do — advertising and serving GATT
 * (the peripheral half every mesh node also needs) is not available in
 * @capacitor-community/bluetooth-le and is the subject of the Phase 0 spike.
 * Until that lands these links can reach a hub, but two phones cannot reach
 * each other.
 */

import { BleClient } from '@capacitor-community/bluetooth-le';
import {
  MESH_SERVICE_UUID,
  CHAR_INBOUND,
  CHAR_OUTBOUND,
  type PacketLink
} from './transport.ts';
import { DEFAULT_MTU } from './fragment.ts';

function viewBytes(dv: DataView): Uint8Array {
  return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
}

/** Web Bluetooth (desktop Chrome, Android Chrome, Bluefy on iOS). */
export class WebPacketLink implements PacketLink {
  readonly mtu = DEFAULT_MTU; // Web Bluetooth exposes no MTU getter

  private inbound: BluetoothRemoteGATTCharacteristic;
  private outbound: BluetoothRemoteGATTCharacteristic;

  private constructor(
    inbound: BluetoothRemoteGATTCharacteristic,
    outbound: BluetoothRemoteGATTCharacteristic
  ) {
    this.inbound = inbound;
    this.outbound = outbound;
  }

  static async connect(device: BluetoothDevice): Promise<WebPacketLink> {
    if (!device.gatt) throw new Error('GATT not available on device');
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(MESH_SERVICE_UUID);
    const inbound = await service.getCharacteristic(CHAR_INBOUND);
    const outbound = await service.getCharacteristic(CHAR_OUTBOUND);
    await outbound.startNotifications();
    return new WebPacketLink(inbound, outbound);
  }

  async sendFrame(frame: Uint8Array): Promise<void> {
    // writeValueWithoutResponse avoids a round-trip per fragment; a large post
    // is thousands of fragments, and the ack latency would dominate.
    const copy = new Uint8Array(frame.byteLength);
    copy.set(frame);
    await this.inbound.writeValueWithoutResponse(copy);
  }

  onFrame(handler: (frame: Uint8Array) => void): () => void {
    const listener = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) handler(viewBytes(value));
    };
    this.outbound.addEventListener('characteristicvaluechanged', listener);
    return () => {
      this.outbound.removeEventListener('characteristicvaluechanged', listener);
    };
  }
}

/** Capacitor native (iOS / Android). */
export class CapacitorPacketLink implements PacketLink {
  private deviceId: string;
  private negotiatedMtu: number;

  private constructor(deviceId: string, negotiatedMtu: number) {
    this.deviceId = deviceId;
    this.negotiatedMtu = negotiatedMtu;
  }

  get mtu(): number {
    return this.negotiatedMtu;
  }

  static async connect(deviceId: string): Promise<CapacitorPacketLink> {
    await BleClient.connect(deviceId);

    // The reported MTU includes the 3-byte ATT header, which is not usable
    // payload. Subtract it rather than overshooting and having writes truncated.
    let mtu = DEFAULT_MTU;
    try {
      const reported = await BleClient.getMtu(deviceId);
      if (reported > 3) mtu = reported - 3;
    } catch {
      // Not all platforms expose it; the conservative default still works.
    }

    const link = new CapacitorPacketLink(deviceId, mtu);
    return link;
  }

  async sendFrame(frame: Uint8Array): Promise<void> {
    await BleClient.writeWithoutResponse(
      this.deviceId,
      MESH_SERVICE_UUID,
      CHAR_INBOUND,
      new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    );
  }

  onFrame(handler: (frame: Uint8Array) => void): () => void {
    let active = true;
    void BleClient.startNotifications(
      this.deviceId,
      MESH_SERVICE_UUID,
      CHAR_OUTBOUND,
      (value) => {
        if (active) handler(viewBytes(value));
      }
    );

    return () => {
      active = false;
      void BleClient.stopNotifications(this.deviceId, MESH_SERVICE_UUID, CHAR_OUTBOUND).catch(
        () => {
          // Already disconnected.
        }
      );
    };
  }

  async disconnect(): Promise<void> {
    try {
      await BleClient.disconnect(this.deviceId);
    } catch {
      // Already disconnected.
    }
  }
}
