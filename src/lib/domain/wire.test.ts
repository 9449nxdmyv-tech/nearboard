import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toWire, fromWire, serializePost, deserializePosts, type WirePost } from './wire.ts';
import type { Post } from './types.ts';

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    postId: 'p1',
    hubId: 'h1',
    authorId: 'a1',
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

test('round-trips a post without an image', () => {
  const post = makePost();
  assert.deepEqual(fromWire(toWire(post)), post);
});

test('round-trips image bytes exactly', () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
  const post = makePost({ imageBlob: bytes });
  const back = fromWire(toWire(post));
  assert.deepEqual(Array.from(back.imageBlob!), Array.from(bytes));
});

test('round-trips a large image without blowing the call stack', () => {
  const bytes = new Uint8Array(150 * 1024).map((_, i) => i % 256);
  const back = fromWire(toWire(makePost({ imageBlob: bytes })));
  assert.equal(back.imageBlob!.byteLength, bytes.byteLength);
  assert.deepEqual(Array.from(back.imageBlob!.subarray(0, 64)), Array.from(bytes.subarray(0, 64)));
});

test('base64 is far smaller than JSON-encoding the array', () => {
  const bytes = new Uint8Array(4096).fill(200);
  const post = makePost({ imageBlob: bytes });
  const naive = JSON.stringify(post).length; // Uint8Array -> {"0":200,...}
  const wire = serializePost(post).length;
  assert.ok(wire < naive / 3, `expected big saving, got ${wire} vs ${naive}`);
});

test('drops linkPreview.image on receipt but keeps the text fields', () => {
  const { imageBlob: _none, ...base } = makePost();
  const received: WirePost = {
    ...base,
    linkPreview: {
      url: 'https://example.com/a',
      title: 'A title',
      description: 'A description',
      image: 'https://tracker.example/pixel.png'
    }
  };
  const post = fromWire(received);
  assert.equal(post.linkPreview?.image, undefined);
  assert.equal(post.linkPreview?.url, 'https://example.com/a');
  assert.equal(post.linkPreview?.title, 'A title');
  assert.equal(post.linkPreview?.description, 'A description');
});

test('deserializePosts handles an empty array and non-array input', () => {
  assert.deepEqual(deserializePosts('[]'), []);
  assert.deepEqual(deserializePosts('{}'), []);
});

test('deserializePosts round-trips a batch', () => {
  const posts = [makePost({ postId: 'a' }), makePost({ postId: 'b', likes: { x: [5, 1] } })];
  const json = `[${posts.map(serializePost).join(',')}]`;
  const back = deserializePosts(json);
  assert.equal(back.length, 2);
  assert.equal(back[1].likes.x[1], 1);
});
