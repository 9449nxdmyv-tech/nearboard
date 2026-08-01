import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePost } from './mergePost.ts';
import { count, has } from './engagement.ts';
import type { Post } from './types.ts';

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    postId: 'p1',
    hubId: 'h1',
    authorId: 'alice',
    text: 'original text',
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

test('a post seen for the first time is taken as-is', () => {
  const incoming = makePost();
  assert.deepEqual(mergePost(undefined, incoming), incoming);
});

test('likes from two relay paths combine rather than overwrite', () => {
  // The failure this exists to prevent: a copy arriving by one path carries
  // bob's like, another carries carol's, and last-writer-wins loses one.
  const existing = makePost({ likes: { bob: [100, 1] } });
  const incoming = makePost({ likes: { carol: [110, 1] } });

  const merged = mergePost(existing, incoming);
  assert.equal(count(merged.likes), 2);
  assert.equal(has(merged.likes, 'bob'), true);
  assert.equal(has(merged.likes, 'carol'), true);
});

test('merging is order-independent', () => {
  const a = makePost({ likes: { bob: [100, 1] }, reshares: { dave: [90, 1] } });
  const b = makePost({ likes: { carol: [110, 1], bob: [130, 0] } });
  assert.deepEqual(mergePost(a, b).likes, mergePost(b, a).likes);
});

test('the newest engagement per author wins', () => {
  const existing = makePost({ likes: { bob: [100, 1] } });
  const incoming = makePost({ likes: { bob: [200, 0] } });
  assert.equal(has(mergePost(existing, incoming).likes, 'bob'), false);
});

test('lastInteractionAt takes the later of the two', () => {
  const existing = makePost({ lastInteractionAt: 5000 });
  const incoming = makePost({ lastInteractionAt: 3000 });
  assert.equal(mergePost(existing, incoming).lastInteractionAt, 5000);
});

test('a peer cannot rewrite the text of an existing post', () => {
  // postId is meant to identify the content, so a different body under the
  // same id is corruption or an attempt to put words in someone's mouth.
  const existing = makePost({ text: 'what was actually said' });
  const tampered = makePost({ text: 'something else entirely' });
  assert.equal(mergePost(existing, tampered).text, 'what was actually said');
});

test('a peer cannot reassign authorship or backdate a post', () => {
  const existing = makePost({ authorId: 'alice', createdAt: 1000 });
  const tampered = makePost({ authorId: 'mallory', createdAt: 1 });
  const merged = mergePost(existing, tampered);
  assert.equal(merged.authorId, 'alice');
  assert.equal(merged.createdAt, 1000);
});

test('a peer cannot unhide something this device hid', () => {
  const existing = makePost({ isHidden: true });
  const incoming = makePost({ isHidden: false });
  assert.equal(mergePost(existing, incoming).isHidden, true);
});

test('local carry state is not cleared by an incoming copy', () => {
  const existing = makePost({ isCarried: true });
  const incoming = makePost({ isCarried: false });
  assert.equal(mergePost(existing, incoming).isCarried, true);
});

test('an image arrives if we did not have one', () => {
  const existing = makePost();
  const incoming = makePost({ imageBlob: new Uint8Array([1, 2, 3]) });
  assert.deepEqual(Array.from(mergePost(existing, incoming).imageBlob!), [1, 2, 3]);
});

test('an existing image is not replaced', () => {
  const existing = makePost({ imageBlob: new Uint8Array([1, 2, 3]) });
  const incoming = makePost({ imageBlob: new Uint8Array([9, 9, 9]) });
  assert.deepEqual(Array.from(mergePost(existing, incoming).imageBlob!), [1, 2, 3]);
});

test('repeatedly merging the same copy changes nothing', () => {
  const existing = makePost({ likes: { bob: [100, 1] } });
  const incoming = makePost({ likes: { carol: [110, 1] } });
  const once = mergePost(existing, incoming);
  const twice = mergePost(once, incoming);
  assert.deepEqual(twice, once);
});
