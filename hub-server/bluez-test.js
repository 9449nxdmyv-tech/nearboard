/**
 * Stand up the D-Bus peripheral on its own and report what happens.
 *
 * Isolates "can this machine be a BLE peripheral at all through BlueZ" from the
 * rest of the anchor node, so a failure points at one thing.
 */

import { startPeripheral } from './bluez-peripheral.js';

const SERVICE = 'edbd67ef-dc53-41c2-a6ac-cd4d438831d3';
const INBOUND = 'edbd0001-dc53-41c2-a6ac-cd4d438831d3';
const OUTBOUND = 'edbd0002-dc53-41c2-a6ac-cd4d438831d3';

function log(cat, label, msg) {
  console.log(`${new Date().toISOString().slice(11, 19)} [${cat}] ${label}: ${msg}`);
}

const peripheral = await startPeripheral({
  serviceUuid: SERVICE,
  inboundUuid: INBOUND,
  outboundUuid: OUTBOUND,
  localName: 'Coffee Shop Wall',
  log,
  onWrite: (buffer) => {
    log('mesh', 'inbound', `${buffer.length} bytes received!`);
    console.log('   hex:', buffer.subarray(0, 48).toString('hex'));
  }
});

log('ble', 'ready', 'advertising via bluetoothd — waiting for a connection');

setInterval(() => {
  log('ble', 'subscribers', peripheral.isSubscribed() ? 'a peer is listening' : 'none yet');
}, 10000);

process.on('SIGINT', async () => {
  await peripheral.stop();
  process.exit(0);
});
