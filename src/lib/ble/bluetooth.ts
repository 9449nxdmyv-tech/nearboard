/**
 * Web Bluetooth wrappers.
 *
 * FUTURE: When wrapping with Capacitor, swap the implementation in bleAdapter.ts
 * to use @capacitor-community/bluetooth-le instead of navigator.bluetooth.
 */

export const SERVICE_UUID = '0000dead-0000-1000-8000-00805f9b34fb';

// Characteristic UUIDs (under the custom service)
export const CHAR_HUB_META       = '0000dea1-0000-1000-8000-00805f9b34fb';
export const CHAR_POST_REQUEST   = '0000dea2-0000-1000-8000-00805f9b34fb';
export const CHAR_POST_RESPONSE  = '0000dea3-0000-1000-8000-00805f9b34fb';
export const CHAR_POST_UPLOAD    = '0000dea4-0000-1000-8000-00805f9b34fb';
export const CHAR_ENGAGEMENT     = '0000dea5-0000-1000-8000-00805f9b34fb';

/** Is Web Bluetooth available in this browser? */
export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/**
 * Opens the browser's BLE device picker filtered to our custom service.
 * Must be called from a user gesture (click/tap).
 */
export async function requestDevice(): Promise<BluetoothDevice> {
  if (!isBluetoothSupported()) {
    throw new Error('Web Bluetooth is not supported in this browser.');
  }
  return navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }]
  });
}
