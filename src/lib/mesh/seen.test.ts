import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SeenSet } from './seen.ts';

test('add reports whether an id was already present', () => {
  const s = new SeenSet();
  assert.equal(s.add('a'), false, 'first sighting is new');
  assert.equal(s.add('a'), true, 'second sighting is a duplicate');
});

test('distinct ids do not collide', () => {
  const s = new SeenSet();
  assert.equal(s.add('a'), false);
  assert.equal(s.add('b'), false);
  assert.equal(s.size, 2);
});

test('two copies arriving in the same instant do not both look new', () => {
  // The check and insert must be atomic, or a packet arriving over two links
  // in the same tick gets relayed twice.
  let clock = 1000;
  const s = new SeenSet(60_000, 100, () => clock);
  assert.equal(s.add('x'), false);
  assert.equal(s.add('x'), true);
});

test('entries expire on age', () => {
  let clock = 1000;
  const s = new SeenSet(5_000, 100, () => clock);

  s.add('a');
  assert.equal(s.has('a'), true);

  clock += 5_001;
  assert.equal(s.has('a'), false, 'an entry past its window is forgotten');
  assert.equal(s.add('a'), false, 'and is accepted as new again');
});

test('an entry inside its window is still remembered', () => {
  let clock = 1000;
  const s = new SeenSet(5_000, 100, () => clock);
  s.add('a');
  clock += 4_999;
  assert.equal(s.add('a'), true);
});

test('expire drops only what is stale', () => {
  let clock = 1000;
  const s = new SeenSet(5_000, 100, () => clock);

  s.add('old');
  clock += 3_000;
  s.add('new');
  clock += 2_500; // old is now 5500ms, new is 2500ms

  s.expire();
  assert.equal(s.size, 1);
  assert.equal(s.has('new'), true);
});

test('the size cap evicts oldest first', () => {
  let clock = 1000;
  const s = new SeenSet(600_000, 3, () => clock);

  for (const id of ['a', 'b', 'c', 'd']) {
    s.add(id);
    clock += 1;
  }

  assert.equal(s.size, 3);
  assert.equal(s.has('a'), false, 'the oldest should have been evicted');
  assert.equal(s.has('d'), true);
});

test('a long-running node stays bounded under sustained traffic', () => {
  let clock = 1000;
  const s = new SeenSet(600_000, 100, () => clock);

  for (let i = 0; i < 10_000; i++) {
    s.add(`msg-${i}`);
    clock += 1;
  }

  assert.equal(s.size, 100, 'an unbounded set would be a slow memory leak');
});

test('clear empties the set', () => {
  const s = new SeenSet();
  s.add('a');
  s.clear();
  assert.equal(s.size, 0);
  assert.equal(s.add('a'), false);
});
