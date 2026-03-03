/**
 * BLE Adapter — abstraction layer for swapping BLE implementations.
 *
 * v1: proxies directly to Web Bluetooth (browser).
 *
 * FUTURE (Capacitor native):
 *   import { BleClient } from '@capacitor-community/bluetooth-le';
 *   Replace the exports below with Capacitor BLE equivalents.
 *   This file is the ONLY place that needs to change when switching
 *   from Web Bluetooth to native BLE — all other code imports from here.
 */

export {
  isBluetoothSupported,
  requestDevice,
  SERVICE_UUID,
  CHAR_HUB_META,
  CHAR_POST_REQUEST,
  CHAR_POST_RESPONSE,
  CHAR_POST_UPLOAD,
  CHAR_ENGAGEMENT
} from './bluetooth';

export { HubConnection } from './hubConnection';
