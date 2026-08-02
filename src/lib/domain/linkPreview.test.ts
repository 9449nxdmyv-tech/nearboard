import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewFor, kindLabel } from './linkPreview.ts';

test('recognises every YouTube URL shape', () => {
  // All four are in the wild, and the id is in the URL every time — which is
  // the whole reason this needs no network.
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ'
  ]) {
    const preview = previewFor(url);
    assert.equal(preview.kind, 'youtube', url);
    assert.equal(preview.embedId, 'dQw4w9WgXcQ', url);
  }
});

test('a YouTube timestamp is surfaced', () => {
  assert.equal(previewFor('https://youtu.be/abc123?t=90').subtitle, 'starts partway in');
});

test('recognises Vimeo, Spotify and GitHub', () => {
  assert.equal(previewFor('https://vimeo.com/123456789').embedId, '123456789');

  const spotify = previewFor('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(spotify.kind, 'spotify');
  assert.equal(spotify.embedId, '4cOdK2wGLETKBW3PvgPWqT');

  const repo = previewFor('https://github.com/sveltejs/svelte');
  assert.equal(repo.title, 'sveltejs/svelte');
  assert.equal(repo.subtitle, 'repository');
});

test('distinguishes a GitHub issue from a repository', () => {
  const issue = previewFor('https://github.com/sveltejs/svelte/issues/42');
  assert.equal(issue.title, 'sveltejs/svelte');
  assert.equal(issue.subtitle, 'issues #42');
});

test('makes a Wikipedia title readable', () => {
  const preview = previewFor('https://en.wikipedia.org/wiki/Bluetooth_Low_Energy');
  assert.equal(preview.kind, 'wikipedia');
  assert.equal(preview.title, 'Bluetooth Low Energy');
});

test('recognises maps', () => {
  assert.equal(previewFor('https://www.openstreetmap.org/#map=15/51.5/-0.1').kind, 'map');
  assert.equal(previewFor('https://maps.google.com/?q=Coffee+Shop').title, 'Coffee Shop');
});

test('classifies media by extension', () => {
  assert.equal(previewFor('https://example.com/a/photo.JPG').kind, 'image');
  assert.equal(previewFor('https://example.com/song.mp3').kind, 'audio');
  assert.equal(previewFor('https://example.com/clip.webm').kind, 'video');
  assert.equal(previewFor('https://example.com/paper.pdf').kind, 'pdf');
});

test('falls back to a readable title for an ordinary link', () => {
  const preview = previewFor('https://example.com/some-long_article-name.html');
  assert.equal(preview.kind, 'link');
  assert.equal(preview.domain, 'example.com');
  assert.equal(preview.title, 'some long article name');
});

test('strips www from the domain', () => {
  assert.equal(previewFor('https://www.example.com/x').domain, 'example.com');
});

test('a malformed URL degrades instead of throwing', () => {
  // A bad URL inside a post must render as text, not break the feed.
  const preview = previewFor('not a url at all');
  assert.equal(preview.kind, 'link');
  assert.equal(preview.url, 'not a url at all');
});

test('a bare domain has no invented title', () => {
  assert.equal(previewFor('https://example.com/').title, undefined);
});

test('every kind has a label', () => {
  for (const kind of [
    'youtube', 'vimeo', 'spotify', 'github', 'wikipedia',
    'map', 'image', 'audio', 'video', 'pdf', 'link'
  ] as const) {
    assert.ok(kindLabel(kind).length > 0, kind);
  }
});

test('previews are derived without any network access', () => {
  // The property that makes this compatible with the privacy promise, and the
  // reason it works with no internet at all. If a fetch ever appears here, this
  // test is the thing that should have stopped it.
  const source = previewFor.toString();
  assert.ok(!/fetch|XMLHttpRequest|import\(/.test(source));
});
