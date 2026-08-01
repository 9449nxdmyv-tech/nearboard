import { test } from 'node:test';
import assert from 'node:assert/strict';
import { count, has, toggle, add, merge, type EngagementSet } from './engagement.ts';

test('counts only authors currently engaged', () => {
  const set: EngagementSet = { a: [1, 1], b: [2, 0], c: [3, 1] };
  assert.equal(count(set), 2);
  assert.equal(count(undefined), 0);
  assert.equal(count({}), 0);
});

test('toggling twice returns to not-engaged', () => {
  const on = toggle(undefined, 'alice', 100);
  assert.equal(has(on, 'alice'), true);
  const off = toggle(on, 'alice', 200);
  assert.equal(has(off, 'alice'), false);
  assert.equal(count(off), 0);
});

test('add is idempotent — the same like twice counts once', () => {
  const once = add(undefined, 'alice', 100);
  const twice = add(once, 'alice', 200);
  assert.equal(count(twice), 1);
});

test('merge is commutative', () => {
  const a: EngagementSet = { alice: [100, 1], bob: [150, 1] };
  const b: EngagementSet = { bob: [120, 0], carol: [200, 1] };
  assert.deepEqual(merge(a, b), merge(b, a));
});

test('merge is idempotent', () => {
  const a: EngagementSet = { alice: [100, 1], bob: [150, 0] };
  assert.deepEqual(merge(a, a), a);
});

test('merge is associative', () => {
  const a: EngagementSet = { alice: [100, 1] };
  const b: EngagementSet = { alice: [200, 0], bob: [50, 1] };
  const c: EngagementSet = { alice: [150, 1], carol: [300, 1] };
  assert.deepEqual(merge(merge(a, b), c), merge(a, merge(b, c)));
});

test('later timestamp wins regardless of merge direction', () => {
  const older: EngagementSet = { alice: [100, 1] };
  const newer: EngagementSet = { alice: [200, 0] };
  assert.equal(has(merge(older, newer), 'alice'), false);
  assert.equal(has(merge(newer, older), 'alice'), false);
});

test('timestamp ties resolve to engaged, both directions', () => {
  const on: EngagementSet = { alice: [100, 1] };
  const off: EngagementSet = { alice: [100, 0] };
  assert.equal(has(merge(on, off), 'alice'), true);
  assert.equal(has(merge(off, on), 'alice'), true);
});

test('the same like arriving via two relay paths counts once', () => {
  // The failure the old `likeCount + 1` model could not avoid.
  const origin = add(undefined, 'alice', 100);
  const viaBob = merge(undefined, origin);
  const viaCarol = merge(undefined, origin);
  assert.equal(count(merge(viaBob, viaCarol)), 1);
});

test('concurrent engagement from many peers converges in any order', () => {
  const updates: EngagementSet[] = [
    { alice: [100, 1] },
    { bob: [110, 1] },
    { alice: [120, 0] },
    { carol: [130, 1] },
    { bob: [140, 0] },
    { alice: [150, 1] }
  ];

  const fold = (order: EngagementSet[]) =>
    order.reduce<EngagementSet>((acc, u) => merge(acc, u), {});

  const forward = fold(updates);
  const backward = fold([...updates].reverse());
  const shuffled = fold([updates[3], updates[0], updates[5], updates[2], updates[4], updates[1]]);

  assert.deepEqual(forward, backward);
  assert.deepEqual(forward, shuffled);
  // alice re-liked at 150, bob unliked at 140, carol liked at 130
  assert.equal(count(forward), 2);
  assert.equal(has(forward, 'alice'), true);
  assert.equal(has(forward, 'bob'), false);
  assert.equal(has(forward, 'carol'), true);
});

test('does not mutate its inputs', () => {
  const original: EngagementSet = { alice: [100, 1] };
  const snapshot = structuredClone(original);
  toggle(original, 'bob', 200);
  add(original, 'carol', 200);
  merge(original, { dave: [300, 1] });
  assert.deepEqual(original, snapshot);
});
