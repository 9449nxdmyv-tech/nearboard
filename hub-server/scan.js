/**
 * BLE scanner, for telling "nobody is advertising" apart from "we cannot see".
 *
 * A scan that finds nothing is ambiguous on its own. Running a known-good
 * scanner from a second radio is what makes the result mean something: if this
 * sees advertisements and a phone does not, the phone is the problem, and vice
 * versa.
 *
 * Usage: node scan.js [seconds]
 * Requires the anchor node to be stopped — one process owns the adapter.
 */

import noble from '@abandonware/noble';

const SECONDS = Number(process.argv[2] ?? 12);
const MESH_SERVICE = 'edbd67efdc5341c2a6accd4d438831d3';

const seen = new Map();

function log(msg) {
  console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
}

noble.on('stateChange', async (state) => {
  log(`adapter state: ${state}`);
  if (state !== 'poweredOn') return;

  // Unfiltered so we learn whether the radio hears anything at all.
  await noble.startScanningAsync([], true);
  log(`scanning for ${SECONDS}s (all advertisements, duplicates allowed)...`);

  setTimeout(async () => {
    await noble.stopScanningAsync();

    console.log('');
    console.log(`  ${seen.size} distinct advertisers seen`);
    console.log('');

    const ours = [];
    for (const [id, d] of seen) {
      const services = (d.services ?? []).join(',');
      const isOurs =
        services.includes(MESH_SERVICE) || (d.name ?? '').includes('Coffee Shop Wall');
      if (isOurs) ours.push(d);
      console.log(
        `  ${isOurs ? '>>' : '  '} ${id}  rssi=${String(d.rssi).padStart(4)}  ` +
          `name=${d.name || '(none)'}  services=[${services}]`
      );
    }

    console.log('');
    if (ours.length > 0) {
      console.log('  RESULT: our mesh service IS being advertised and is visible.');
    } else if (seen.size > 0) {
      console.log('  RESULT: the radio works, but our mesh service was NOT seen.');
    } else {
      console.log('  RESULT: no advertisements at all — nothing is broadcasting in range.');
    }
    console.log('');

    process.exit(0);
  }, SECONDS * 1000);
});

noble.on('discover', (peripheral) => {
  const adv = peripheral.advertisement ?? {};
  seen.set(peripheral.id, {
    rssi: peripheral.rssi,
    name: adv.localName,
    services: adv.serviceUuids ?? []
  });
});
