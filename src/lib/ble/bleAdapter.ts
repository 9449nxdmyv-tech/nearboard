/**
 * BLE Adapter — runtime platform detection.
 *
 * Native (Capacitor): uses @capacitor-community/bluetooth-le
 * Web: uses navigator.bluetooth (Web Bluetooth API)
 */

import { Capacitor } from '@capacitor/core';
import {
  isBluetoothSupported as webIsSupported,
  requestDevice as webRequestDevice,
  SERVICE_UUID,
  CHAR_HUB_META,
  CHAR_POST_REQUEST,
  CHAR_POST_RESPONSE,
  CHAR_POST_UPLOAD,
  CHAR_ENGAGEMENT
} from './bluetooth';
import { HubConnection } from './hubConnection';
import {
  isBluetoothSupported as capIsSupported,
  requestDevice as capRequestDevice,
  CapacitorHubConnection
} from './capacitor-ble';

export {
  SERVICE_UUID,
  CHAR_HUB_META,
  CHAR_POST_REQUEST,
  CHAR_POST_RESPONSE,
  CHAR_POST_UPLOAD,
  CHAR_ENGAGEMENT
};

const isNative = Capacitor.isNativePlatform();

export function isBluetoothSupported(): boolean {
  return isNative ? capIsSupported() : webIsSupported();
}

/**
 * Request a BLE device. Returns an opaque handle:
 * - Native: string (deviceId)
 * - Web: BluetoothDevice object
 */
export async function requestDevice(): Promise<any> {
  if (isNative) {
    return capRequestDevice();
  }
  return webRequestDevice();
}

/**
 * Create a hub connection appropriate for the current platform.
 */
export function createHubConnection(): HubConnection | CapacitorHubConnection {
  return isNative ? new CapacitorHubConnection() : new HubConnection();
}

export { HubConnection, CapacitorHubConnection };
