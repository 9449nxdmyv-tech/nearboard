/**
 * Connect to a nearboard peer as a central and speak the mesh protocol.
 *
 * The anchor node is a peripheral, so it can only ever be connected *to*. When
 * a phone fails to connect to it, that could be the phone, the anchor, or the
 * BlueZ daemon sitting between them. This drives the other direction — laptop
 * as central, phone as peripheral — which isolates the peripheral half of the
 * phone's stack from bleno entirely.
 *
 * Usage: node connect-test.js [seconds]
 * Requires the anchor node to be stopped; one process owns the adapter.
 */

import noble from '@abandonware/noble';
import { encodePacket, makePacket, decodePacket, PacketType, randomId, SENDER_ID_SIZE } from '../src/lib/mesh/packet.ts';

const SERVICE = 'edbd67efdc5341c2a6accd4d438831d3';
const INBOUND = 'edbd0001dc5341c2a6accd4d438831d3';
const OUTBOUND = 'edbd0002dc5341c2a6accd4d438831d3';

const TIMEOUT = Number(process.argv[2] ?? 40) * 1000;
const senderId = randomId(SENDER_ID_SIZE);

function log(msg) {
  console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
}

setTimeout(() => {
  log('timed out');
  process.exit(1);
}, TIMEOUT);

noble.on('stateChange', async (state) => {
  log(`adapter: ${state}`);
  if (state === 'poweredOn') {
    log(`scanning for service ${SERVICE}...`);
    await noble.startScanningAsync([SERVICE], false);
  }
});

noble.on('discover', async (peripheral) => {
  const name = peripheral.advertisement?.localName ?? '(unnamed)';
  log(`found ${peripheral.id} "${name}" rssi=${peripheral.rssi}`);
  await noble.stopScanningAsync();

  try {
    log('connecting...');
    await peripheral.connectAsync();
    log('CONNECTED');

    log('discovering services...');
    const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [SERVICE],
      [INBOUND, OUTBOUND]
    );
    log(`found ${characteristics.length} characteristics`);

    const inbound = characteristics.find((c) => c.uuid === INBOUND);
    const outbound = characteristics.find((c) => c.uuid === OUTBOUND);
    if (!inbound || !outbound) {
      log(`MISSING characteristic (inbound=${!!inbound} outbound=${!!outbound})`);
      process.exit(1);
    }

    outbound.on('data', (data) => {
      try {
        const packet = decodePacket(new Uint8Array(data));
        log(`RECEIVED packet type=${packet.type} ${data.length}B from ${packet.senderId}`);
      } catch (e) {
        log(`received ${data.length}B (not a full packet: ${e.message})`);
      }
    });
    await outbound.subscribeAsync();
    log('subscribed to notifications');

    // Ask for anything newer than epoch — the simplest real protocol exchange.
    const payload = Buffer.from(JSON.stringify({ since: 0 }), 'utf-8');
    const packet = makePacket(PacketType.Sync, senderId, payload);
    const frame = Buffer.from(encodePacket(packet));
    log(`writing ${frame.length}B Sync packet...`);
    await inbound.writeAsync(frame, true);
    log('WRITE OK — protocol exchange succeeded');
    log('listening for replies for 15s...');

    setTimeout(async () => {
      await peripheral.disconnectAsync();
      log('done');
      process.exit(0);
    }, 15000);
  } catch (e) {
    log(`FAILED: ${e.message}`);
    process.exit(1);
  }
});
