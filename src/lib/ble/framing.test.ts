import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameString, readFramed, MAX_FRAME_BYTES } from './framing.ts';

/** Turn a framed ArrayBuffer into a reader that hands out `size`-byte chunks. */
function chunkedReader(buf: ArrayBuffer, size: number): () => Promise<DataView> {
  const bytes = new Uint8Array(buf);
  let offset = 0;
  return async () => {
    const chunk = bytes.subarray(offset, offset + size);
    offset += chunk.byteLength;
    return new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  };
}

test('round-trips a payload delivered in one read', async () => {
  const payload = JSON.stringify([{ postId: 'a', text: 'hello' }]);
  const got = await readFramed(chunkedReader(frameString(payload), 4096));
  assert.equal(got, payload);
});

test('round-trips a payload split across many reads', async () => {
  const payload = JSON.stringify(
    Array.from({ length: 200 }, (_, i) => ({ postId: `p${i}`, text: 'x'.repeat(40) }))
  );
  const framed = frameString(payload);
  assert.ok(framed.byteLength > 512, 'fixture should span multiple chunks');
  const got = await readFramed(chunkedReader(framed, 20));
  assert.equal(got, payload);
});

test('splits the 4-byte header itself across reads', async () => {
  const payload = 'header split across reads';
  const got = await readFramed(chunkedReader(frameString(payload), 1));
  assert.equal(got, payload);
});

test('round-trips multi-byte UTF-8 split mid-character', async () => {
  // 3-byte characters, chunked at 2 bytes so reads land mid-codepoint
  const payload = '日本語のテキスト';
  const got = await readFramed(chunkedReader(frameString(payload), 2));
  assert.equal(got, payload);
});

test('returns empty string when there is nothing to read', async () => {
  const got = await readFramed(async () => new DataView(new ArrayBuffer(0)));
  assert.equal(got, '');
});

test('rejects a truncated frame instead of returning a partial parse', async () => {
  // A payload whose prefix is itself valid JSON — the old "parse until it
  // works" loop would have accepted `[{"a":1}` ... and returned early.
  const payload = '[{"a":1},{"b":2}]';
  const framed = frameString(payload);
  const truncated = framed.slice(0, framed.byteLength - 5);
  await assert.rejects(
    () => readFramed(chunkedReader(truncated, 4)),
    /Truncated frame/
  );
});

test('rejects a frame declaring more than the size limit', async () => {
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, MAX_FRAME_BYTES + 1, false);
  await assert.rejects(
    () => readFramed(chunkedReader(header.buffer, 4)),
    /over the .* limit/
  );
});

test('ignores trailing bytes beyond the declared length', async () => {
  const payload = 'exact';
  const framed = new Uint8Array(frameString(payload));
  const withTrailer = new Uint8Array(framed.byteLength + 8);
  withTrailer.set(framed, 0);
  withTrailer.set(new TextEncoder().encode('GARBAGE!'), framed.byteLength);
  const got = await readFramed(chunkedReader(withTrailer.buffer, 3));
  assert.equal(got, payload);
});
