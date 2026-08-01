import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshHarness } from './testing/harness.ts';
import { DEFAULT_TTL } from './packet.ts';
import { clampTtlForTopology, DENSE_TTL_CAP } from './router.ts';

test('a packet reaches a directly connected peer', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b');
  h.link('a', 'b');

  const packet = h.send('a', 'hello');
  await h.settle();

  assert.deepEqual(h.reachedBy(packet.messageId), ['b']);
  assert.deepEqual(h.textsAt('b'), ['hello']);
});

test('a packet crosses multiple hops', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c', 'd', 'e');
  h.chain('a', 'b', 'c', 'd', 'e');

  const packet = h.send('a', 'far away');
  await h.settle();

  // This is the whole point of a mesh: e is four hops from a, well beyond the
  // ~30m a single BLE link reaches.
  assert.deepEqual(h.reachedBy(packet.messageId), ['b', 'c', 'd', 'e']);
  assert.deepEqual(h.textsAt('e'), ['far away']);
});

test('the originator never receives its own packet back', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c');
  h.ring('a', 'b', 'c');

  const packet = h.send('a', 'mine');
  await h.settle();

  assert.equal(h.deliveryCount('a', packet.messageId), 0);
});

test('a ring does not loop forever', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c', 'd');
  h.ring('a', 'b', 'c', 'd');

  const packet = h.send('a', 'round we go');
  // drain() throws if the network never settles, so reaching this line at all
  // proves the seen-set terminated the flood.
  await h.settle();

  assert.deepEqual(h.reachedBy(packet.messageId), ['b', 'c', 'd']);
});

test('each node is handed a packet exactly once, however many paths reach it', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c', 'd', 'e');
  h.mesh('a', 'b', 'c', 'd', 'e'); // every node sees every other

  const packet = h.send('a', 'once only');
  await h.settle();

  for (const id of ['b', 'c', 'd', 'e']) {
    assert.equal(
      h.deliveryCount(id, packet.messageId),
      1,
      `${id} should be handed the packet exactly once`
    );
  }
});

test('deduplication suppresses redundant relays in a dense mesh', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c', 'd', 'e');
  h.mesh('a', 'b', 'c', 'd', 'e');

  h.send('a', 'x');
  await h.settle();

  const totalDeduped = [...h.nodes.values()].reduce((n, node) => n + node.stats.deduped, 0);
  assert.ok(totalDeduped > 0, 'a full mesh must produce duplicate arrivals to drop');

  // Without dedup, 5 nodes each relaying to 4 peers for 7 TTL hops is
  // thousands of frames. Bounded relaying keeps it small.
  assert.ok(h.framesOnWire < 60, `expected a bounded flood, saw ${h.framesOnWire} frames`);
});

test('TTL bounds how far a packet travels', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c', 'd', 'e', 'f');
  h.chain('a', 'b', 'c', 'd', 'e', 'f');

  const packet = h.send('a', 'short reach', { ttl: 3 });
  await h.settle();

  // ttl 3: a->b (arrives ttl 3), b->c (2), c->d (1), and d cannot relay further.
  assert.deepEqual(h.reachedBy(packet.messageId), ['b', 'c', 'd']);
});

test('the default TTL spans a long chain', async () => {
  const h = new MeshHarness();
  const ids = Array.from({ length: DEFAULT_TTL + 4 }, (_, i) => `n${i}`);
  h.addAll(...ids);
  h.chain(...ids);

  const packet = h.send(ids[0], 'far');
  await h.settle();

  // A packet sent with ttl N reaches N nodes: it arrives at the first hop still
  // carrying N, and each relay spends one, so the node holding ttl 1 is the last
  // that can pass it on.
  assert.equal(h.reachedBy(packet.messageId).length, DEFAULT_TTL);
});

test('a partition blocks delivery and healing does not resurrect it', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c');
  h.chain('a', 'b', 'c');
  h.net.partition('b', 'c');

  const packet = h.send('a', 'blocked');
  await h.settle();

  assert.deepEqual(h.reachedBy(packet.messageId), ['b']);

  // Healing alone does not replay history — that is what store-and-forward is for.
  h.net.heal('b', 'c');
  await h.settle();
  assert.deepEqual(h.reachedBy(packet.messageId), ['b']);
});

test('a node joining later receives the backlog', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b');
  h.link('a', 'b');

  h.send('a', 'said before you arrived');
  await h.settle();

  // c walks into the room
  h.add('c');
  h.link('b', 'c');
  await h.settle();

  assert.deepEqual(h.textsAt('c'), ['said before you arrived']);
});

test('the backlog replays in order and without duplicates', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b');
  h.link('a', 'b');

  h.send('a', 'first');
  await h.settle();
  h.send('a', 'second');
  await h.settle();
  h.send('a', 'third');
  await h.settle();

  h.add('c');
  h.link('b', 'c');
  await h.settle();

  assert.deepEqual(h.textsAt('c'), ['first', 'second', 'third']);
});

test('the backlog forgets packets older than the cache window', async () => {
  const h = new MeshHarness({ cacheTtlMs: 60_000 });
  h.addAll('a', 'b');
  h.link('a', 'b');

  h.send('a', 'ancient history');
  await h.settle();

  h.net.clock.advance(120_000); // past the cache window

  h.add('c');
  h.link('b', 'c');
  await h.settle();

  assert.deepEqual(h.textsAt('c'), [], 'a stale packet must not be replayed forever');
});

test('the backlog is bounded', async () => {
  const h = new MeshHarness({ cacheMax: 5 });
  h.addAll('a', 'b');
  h.link('a', 'b');

  for (let i = 0; i < 20; i++) {
    h.send('a', `msg-${i}`);
    await h.settle();
  }

  assert.equal(h.nodes.get('b')!.cacheSize, 5);

  h.add('c');
  h.link('b', 'c');
  await h.settle();

  // Only the most recent survive.
  assert.deepEqual(h.textsAt('c'), ['msg-15', 'msg-16', 'msg-17', 'msg-18', 'msg-19']);
});

test('a partitioned network re-converges when a new link bridges it', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c', 'd');
  h.link('a', 'b'); // island one
  h.link('c', 'd'); // island two

  h.send('a', 'from island one');
  h.send('c', 'from island two');
  await h.settle();

  assert.deepEqual(h.textsAt('d'), ['from island two']);

  // Someone walks between the two groups, joining them.
  h.link('b', 'c');
  await h.settle();

  assert.ok(h.textsAt('d').includes('from island one'), 'the islands should merge');
  assert.ok(h.textsAt('a').includes('from island two'));
});

test('delivery survives a lossy link', async () => {
  const h = new MeshHarness({ seed: 42 });
  h.addAll('a', 'b', 'c');
  // Two disjoint paths, each unreliable; together they should get through.
  h.link('a', 'b', { loss: 0.5 });
  h.link('a', 'c', { loss: 0.5 });
  h.link('b', 'c', { loss: 0.5 });

  let reached = 0;
  const trials = 200;
  for (let i = 0; i < trials; i++) {
    const packet = h.send('a', `msg-${i}`);
    await h.settle();
    if (h.reachedBy(packet.messageId).includes('c')) reached++;
  }

  // c is reachable directly (50%) or via b (50% x 50% = 25%), so the mesh
  // should land near 1 - 0.5 x 0.75 = 62.5%. The property worth asserting is
  // that the second path genuinely helps — a single link would give 50%.
  const rate = reached / trials;
  assert.ok(rate > 0.55, `redundancy should beat a single link, got ${rate.toFixed(2)}`);
  assert.ok(rate < 0.75, `should not exceed what two lossy paths can give, got ${rate.toFixed(2)}`);
});

test('total loss delivers nothing but does not hang', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b');
  h.link('a', 'b', { loss: 1 });

  const packet = h.send('a', 'into the void');
  await h.settle();

  assert.deepEqual(h.reachedBy(packet.messageId), []);
});

test('relays are jittered rather than fired in the same instant', async () => {
  const h = new MeshHarness({ minJitterMs: 50, maxJitterMs: 500, defaultLatencyMs: 1 });
  h.addAll('a', 'b', 'c', 'd', 'e');
  // b, c, d and e all hear a at the same moment...
  h.link('a', 'b');
  h.link('a', 'c');
  h.link('a', 'd');
  h.link('a', 'e');
  // ...and each has somewhere to relay onward to.
  h.link('b', 'c');
  h.link('c', 'd');
  h.link('d', 'e');

  h.send('a', 'burst');
  await h.settle();

  // Deliveries are simultaneous by construction here — every node hears the
  // packet from a directly, and the relays that follow are deduped. The jitter
  // is visible on the wire, which is the thing it exists to protect.
  const relayFrames = h.net.delivered.filter((d) => d.from !== 'a');
  assert.ok(relayFrames.length >= 4, 'expected several relayed frames');

  const times = new Set(relayFrames.map((d) => d.at));
  assert.ok(
    times.size > 1,
    `relays should be spread across time, all landed at ${[...times]}`
  );

  const span = Math.max(...times) - Math.min(...times);
  assert.ok(span >= 50, `expected jitter to spread relays, span was only ${span}ms`);
});

test('a large fragmented post traverses several hops intact', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c');
  h.chain('a', 'b', 'c');

  const big = 'x'.repeat(20_000);
  const packet = h.send('a', big);
  await h.settle();

  assert.deepEqual(h.reachedBy(packet.messageId), ['b', 'c']);
  assert.equal(h.textsAt('c')[0], big);
});

test('no errors are raised across a full scenario', async () => {
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c', 'd');
  h.mesh('a', 'b', 'c', 'd');
  h.send('a', 'one');
  h.send('b', 'two');
  h.send('c', 'three');
  await h.settle();
  assert.deepEqual(h.errors, []);
});

test('every node converges on the same set of messages', async () => {
  const h = new MeshHarness({ seed: 7 });
  h.addAll('a', 'b', 'c', 'd', 'e');
  h.ring('a', 'b', 'c', 'd', 'e');

  const sent = ['a', 'b', 'c', 'd', 'e'].map((id) => h.send(id, `from-${id}`));
  await h.settle();

  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    const seen = new Set(h.textsAt(id));
    const expected = sent
      .filter((p) => new TextDecoder().decode(p.payload) !== `from-${id}`)
      .map((p) => new TextDecoder().decode(p.payload));
    assert.deepEqual([...seen].sort(), expected.sort(), `${id} did not converge`);
  }
});

test('TTL is clamped where the network is dense', () => {
  // Under the dense threshold nothing changes.
  assert.equal(clampTtlForTopology(7, 0), 7);
  assert.equal(clampTtlForTopology(7, 2), 7);
  assert.equal(clampTtlForTopology(7, 5), 7);
  // At and above it, hops are capped — a crowded room already reaches
  // everyone in a hop or two, so spending seven multiplies traffic for nothing.
  assert.equal(clampTtlForTopology(7, 6), DENSE_TTL_CAP);
  assert.equal(clampTtlForTopology(7, 20), DENSE_TTL_CAP);
});

test('clamping never raises a TTL', () => {
  // A packet near the end of its life must not be given more hops by arriving
  // somewhere busy.
  assert.equal(clampTtlForTopology(2, 10), 2);
  assert.equal(clampTtlForTopology(1, 10), 1);
});

test('a dense mesh still reaches everyone despite the lower TTL', async () => {
  const h = new MeshHarness();
  const ids = Array.from({ length: 9 }, (_, i) => `n${i}`);
  h.addAll(...ids);
  h.mesh(...ids); // every node has 8 peers, well past the dense threshold

  const packet = h.send('n0', 'dense');
  await h.settle();

  assert.equal(
    h.reachedBy(packet.messageId).length,
    8,
    'clamping must not cost reachability in a network dense enough to clamp'
  );
});

test('a sparse chain keeps its full reach', async () => {
  const h = new MeshHarness();
  const ids = Array.from({ length: 8 }, (_, i) => `n${i}`);
  h.addAll(...ids);
  h.chain(...ids); // every node has at most 2 peers

  const packet = h.send('n0', 'sparse');
  await h.settle();

  // Unclamped: ttl 7 reaches 7 nodes.
  assert.equal(h.reachedBy(packet.messageId).length, DEFAULT_TTL);
});
