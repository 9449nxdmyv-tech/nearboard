import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHubName, deriveHubId, hubJoinUrl } from './hubId.ts';

test('normalises case, surrounding and internal whitespace', () => {
  assert.equal(normalizeHubName('  Coffee   Shop  Wall '), 'coffee shop wall');
  assert.equal(normalizeHubName('COFFEE SHOP WALL'), 'coffee shop wall');
  assert.equal(normalizeHubName('coffee\tshop\nwall'), 'coffee shop wall');
});

test('two people typing the same name reach the same hub', async () => {
  const alice = await deriveHubId('Coffee Shop Wall');
  const bob = await deriveHubId('  coffee   shop wall  ');
  assert.equal(alice, bob);
});

test('different names give different hubs', async () => {
  const a = await deriveHubId('Coffee Shop Wall');
  const b = await deriveHubId('Coffee Shop Walls');
  assert.notEqual(a, b);
});

test('hub id is 128 bits of lowercase hex', async () => {
  const id = await deriveHubId('anything');
  assert.match(id, /^[0-9a-f]{32}$/);
});

test('unicode-equivalent names agree', async () => {
  // NFC "é" vs NFD "e" + combining acute
  const composed = await deriveHubId('café');
  const decomposed = await deriveHubId('café');
  assert.equal(composed, decomposed);
});

test('join url carries both id and name', () => {
  const url = hubJoinUrl('https://nearboard.app', 'abc123', 'Coffee Shop Wall');
  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/join');
  assert.equal(parsed.searchParams.get('id'), 'abc123');
  assert.equal(parsed.searchParams.get('name'), 'Coffee Shop Wall');
});
