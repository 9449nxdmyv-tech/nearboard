/**
 * Connect to a nearboard peer through BlueZ's D-Bus API.
 *
 * bleno and noble both drive the HCI socket directly, which fights bluetoothd
 * for ownership of the adapter — the symptom is a connection the controller
 * rejects outright ("Command Disallowed", 0x0c) even though scanning and
 * advertising both appear to work.
 *
 * BlueZ's D-Bus interface is the supported path on a system where bluetoothd is
 * running, which on any modern desktop is always. It cooperates rather than
 * competes, and needs no elevated privileges.
 *
 * Usage: node connect-dbus.js [seconds]
 */

import { createBluetooth } from 'node-ble';
import {
  encodePacket,
  decodePacket,
  makePacket,
  PacketType,
  randomId,
  SENDER_ID_SIZE
} from '../src/lib/mesh/packet.ts';

const SERVICE = 'edbd67ef-dc53-41c2-a6ac-cd4d438831d3';
const INBOUND = 'edbd0001-dc53-41c2-a6ac-cd4d438831d3';
const OUTBOUND = 'edbd0002-dc53-41c2-a6ac-cd4d438831d3';

const DISCOVER_TIMEOUT = Number(process.argv[2] ?? 40) * 1000;
const senderId = randomId(SENDER_ID_SIZE);

function log(msg) {
  console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
}

async function main() {
  const { bluetooth, destroy } = createBluetooth();
  const adapter = await bluetooth.defaultAdapter();
  log(`adapter: ${await adapter.getAddress()}`);

  if (!(await adapter.isDiscovering())) {
    await adapter.startDiscovery();
    log('discovery started');
  }

  log('waiting for a nearboard peer...');
  const deadline = Date.now() + DISCOVER_TIMEOUT;
  let device = null;

  // BlueZ only reports advertised service UUIDs once a discovery filter is set,
  // so an unfiltered scan sees the device but not what it offers. Match on the
  // name and confirm the service after connecting, which is what actually
  // matters — the GATT table is authoritative, the advertisement is a hint.
  const NAME_HINT = (process.env.PEER_NAME ?? 'Fire Tablet').toLowerCase();

  while (Date.now() < deadline && !device) {
    const addresses = await adapter.devices();
    for (const address of addresses) {
      try {
        const candidate = await adapter.getDevice(address);
        const uuids = (await candidate.getUUIDs().catch(() => [])).map((u) => u.toLowerCase());
        const name = (await candidate.getName().catch(() => '')) || '';

        const matches =
          uuids.includes(SERVICE) || name.toLowerCase().includes(NAME_HINT);
        if (matches) {
          log(`found ${address} "${name || '(unnamed)'}" uuids=[${uuids.join(',')}]`);
          device = candidate;
          break;
        }
      } catch {
        // Device vanished mid-enumeration; keep looking.
      }
    }
    if (!device) await new Promise((r) => setTimeout(r, 1000));
  }

  if (!device) {
    log('no nearboard peer found');
    await adapter.stopDiscovery().catch(() => {});
    destroy();
    process.exit(1);
  }

  await adapter.stopDiscovery().catch(() => {});

  log('connecting...');
  await device.connect();
  log('CONNECTED');

  const gatt = await device.gatt();
  const service = await gatt.getPrimaryService(SERVICE);
  const inbound = await service.getCharacteristic(INBOUND);
  const outbound = await service.getCharacteristic(OUTBOUND);
  log('discovered both characteristics');

  await outbound.startNotifications();
  outbound.on('valuechanged', (buf) => {
    try {
      const packet = decodePacket(new Uint8Array(buf));
      log(`RECEIVED packet type=${packet.type} ${buf.length}B from ${packet.senderId}`);
    } catch (e) {
      log(`received ${buf.length}B (partial/fragment: ${e.message})`);
    }
  });
  log('subscribed to notifications');

  const payload = Buffer.from(JSON.stringify({ since: 0 }), 'utf-8');
  const frame = Buffer.from(encodePacket(makePacket(PacketType.Sync, senderId, payload)));
  log(`writing ${frame.length}B Sync packet...`);
  await inbound.writeValue(frame, { type: 'command' });
  log('WRITE OK — full protocol exchange over a real radio');

  log('listening 15s for replies...');
  setTimeout(async () => {
    await device.disconnect().catch(() => {});
    destroy();
    log('done');
    process.exit(0);
  }, 15000);
}

main().catch((e) => {
  log(`FAILED: ${e.message}`);
  process.exit(1);
});
