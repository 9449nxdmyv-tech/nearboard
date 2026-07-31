/**
 * Wire encoding for posts.
 *
 * `JSON.stringify` turns a Uint8Array into an object of numeric keys —
 * `{"0":12,"1":255,...}` — which costs roughly six bytes of JSON per byte of
 * image. A 150 KB photo becomes ~900 KB on the wire, and at BLE throughput
 * that is minutes per post. Base64 costs 1.33x instead.
 *
 * FUTURE (Phase 1): the binary packet format carries the image as raw bytes in
 * its own fragment, dropping the 1.33x too. This encoding is the seam that
 * change slots into.
 */

import type { Post } from './types';

/** A post as it appears on the wire: imageBlob base64 rather than an array. */
export type WirePost = Omit<Post, 'imageBlob'> & { imageBlob?: string };

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // avoid blowing the argument limit on large images
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode a post for transmission. */
export function toWire(post: Post): WirePost {
  const { imageBlob, ...rest } = post;
  return imageBlob ? { ...rest, imageBlob: toBase64(imageBlob) } : rest;
}

/**
 * Decode a received post.
 *
 * `linkPreview.image` is dropped. It is a remote URL chosen by whoever wrote
 * the post, and rendering it would make the viewer's device fetch from that
 * host — handing an arbitrary peer the viewer's IP address and user-agent
 * simply for scrolling past. Text fields are kept; only the field that causes
 * an outbound request is removed.
 */
export function fromWire(wire: WirePost): Post {
  const { imageBlob, linkPreview, ...rest } = wire;

  const post: Post = imageBlob
    ? { ...rest, imageBlob: fromBase64(imageBlob) }
    : rest;

  if (linkPreview) {
    const { image: _dropped, ...safe } = linkPreview;
    post.linkPreview = safe;
  }

  return post;
}

export function serializePost(post: Post): string {
  return JSON.stringify(toWire(post));
}

export function deserializePosts(json: string): Post[] {
  const parsed = JSON.parse(json) as WirePost[];
  return Array.isArray(parsed) ? parsed.map(fromWire) : [];
}
