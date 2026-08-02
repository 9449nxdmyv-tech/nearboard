import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_MODERATION,
  blockAuthor,
  unblockAuthor,
  isBlocked,
  muteWord,
  unmuteWord,
  hiddenReason,
  hiddenLabel,
  withoutBlocked,
  reportCount,
  REPORT_COLLAPSE_THRESHOLD
} from './moderation.ts';
import type { Post } from './types.ts';

const ALICE = 'a'.repeat(64);
const MALLORY = 'b'.repeat(64);

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    postId: 'p1',
    hubId: 'h1',
    authorId: ALICE,
    text: 'hello nearby',
    createdAt: 1000,
    lastInteractionAt: 1000,
    likes: {},
    reshares: {},
    deranks: {},
    pinned: false,
    isFeatured: false,
    isEphemeral: false,
    isHidden: false,
    isCarried: false,
    ...overrides
  };
}

// --- blocking ---

test('blocking is keyed on the public key, so it survives reconnection', () => {
  // authorId is an Ed25519 public key. An author cannot shed a block by
  // reconnecting or renaming, because the key is what signs their posts.
  const state = blockAuthor(EMPTY_MODERATION, MALLORY);
  assert.equal(isBlocked(state, MALLORY), true);
  assert.equal(isBlocked(state, ALICE), false);
});

test('blocking twice does not duplicate', () => {
  const once = blockAuthor(EMPTY_MODERATION, MALLORY);
  assert.deepEqual(blockAuthor(once, MALLORY).blocked, [MALLORY]);
});

test('unblocking restores an author', () => {
  const state = unblockAuthor(blockAuthor(EMPTY_MODERATION, MALLORY), MALLORY);
  assert.equal(isBlocked(state, MALLORY), false);
});

test('a blocked author is removed from the feed entirely', () => {
  // Collapsing would still put them on screen. Someone who blocked a harasser
  // should not have to see a card saying the harasser posted.
  const state = blockAuthor(EMPTY_MODERATION, MALLORY);
  const feed = [makePost({ postId: 'a' }), makePost({ postId: 'b', authorId: MALLORY })];
  assert.deepEqual(withoutBlocked(feed, state).map((p) => p.postId), ['a']);
});

test('an empty block list does not disturb the feed', () => {
  const feed = [makePost({ postId: 'a' }), makePost({ postId: 'b' })];
  assert.equal(withoutBlocked(feed, EMPTY_MODERATION), feed);
});

// --- reporting ---

test('reports are counted from the shared CRDT', () => {
  // Reporting adds to deranks, which converges across the mesh — so every
  // device computes the same count without an authority.
  const post = makePost({ deranks: { x: [1, 1], y: [2, 1] } });
  assert.equal(reportCount(post), 2);
});

test('a post collapses once enough people report it', () => {
  const deranks: Record<string, [number, 1]> = {};
  for (let i = 0; i < REPORT_COLLAPSE_THRESHOLD; i++) deranks[`u${i}`] = [i, 1];
  assert.equal(hiddenReason(makePost({ deranks }), EMPTY_MODERATION), 'reported');
});

test('a post below the threshold is shown normally', () => {
  const deranks: Record<string, [number, 1]> = {};
  for (let i = 0; i < REPORT_COLLAPSE_THRESHOLD - 1; i++) deranks[`u${i}`] = [i, 1];
  assert.equal(hiddenReason(makePost({ deranks }), EMPTY_MODERATION), null);
});

test('a withdrawn report stops counting', () => {
  // deranks is an LWW set, so a report can be taken back and the arithmetic
  // follows everywhere.
  const deranks: Record<string, [number, 0 | 1]> = {};
  for (let i = 0; i < REPORT_COLLAPSE_THRESHOLD; i++) deranks[`u${i}`] = [i, 1];
  deranks['u0'] = [999, 0];
  assert.equal(hiddenReason(makePost({ deranks }), EMPTY_MODERATION), null);
});

// --- muting ---

test('a muted word collapses a post on this device', () => {
  const state = muteWord(EMPTY_MODERATION, 'Spoilers');
  assert.equal(hiddenReason(makePost({ text: 'huge spoilers ahead' }), state), 'muted');
});

test('muting is case-insensitive and normalised', () => {
  const state = muteWord(EMPTY_MODERATION, '  SPOILERS  ');
  assert.deepEqual(state.mutedWords, ['spoilers']);
  assert.equal(hiddenReason(makePost({ text: 'Spoilers!' }), state), 'muted');
});

test('unmuting restores a word', () => {
  const state = unmuteWord(muteWord(EMPTY_MODERATION, 'spoilers'), 'Spoilers');
  assert.deepEqual(state.mutedWords, []);
});

test('an empty word is not muted', () => {
  assert.deepEqual(muteWord(EMPTY_MODERATION, '   ').mutedWords, []);
});

// --- precedence and wording ---

test('blocking takes precedence over other reasons', () => {
  const state = muteWord(blockAuthor(EMPTY_MODERATION, MALLORY), 'hello');
  assert.equal(hiddenReason(makePost({ authorId: MALLORY }), state), 'blocked');
});

test('every reason has wording a user can act on', () => {
  for (const reason of ['blocked', 'reported', 'muted'] as const) {
    const label = hiddenLabel(reason);
    assert.ok(label.length > 0);
    // The user should be told what happened, not shown a bare "hidden".
    assert.notEqual(label.toLowerCase(), 'hidden');
  }
});

test('an ordinary post is not hidden', () => {
  assert.equal(hiddenReason(makePost(), EMPTY_MODERATION), null);
});

test('moderation state is never mutated in place', () => {
  const state = blockAuthor(EMPTY_MODERATION, MALLORY);
  const snapshot = structuredClone(state);
  blockAuthor(state, 'c'.repeat(64));
  muteWord(state, 'x');
  unblockAuthor(state, MALLORY);
  assert.deepEqual(state, snapshot);
});
