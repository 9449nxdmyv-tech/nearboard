/**
 * The internet transport.
 *
 * BLE cannot reach everywhere the app needs to run. Web Bluetooth is
 * central-only by specification and absent from iOS Safari entirely, so a
 * browser can never be a mesh peer — which means "works on web, Android, iOS
 * and a laptop" is unreachable over BLE alone, no matter how good the radio
 * code gets.
 *
 * Nostr fills that gap with a WebSocket, which every platform has. It keeps the
 * properties that matter here: identity is a keypair rather than an account,
 * and the relays are public infrastructure nobody has to run.
 *
 * PRIVACY
 * -------
 * The home screen promises "No accounts. No cloud." Publishing posts in the
 * clear to public relays would quietly break that — relays store events, and
 * anyone can read them.
 *
 * So payloads are encrypted with a key derived from the hub *name* before they
 * leave the device. A relay sees an opaque blob tagged with a hub id it cannot
 * reverse. Anyone who knows the hub name can read the board, which is exactly
 * the access rule the BLE side already uses — the name is the address and the
 * key. Nobody else can, including the relay.
 *
 * This transport is off unless the user turns it on for a hub. Local-first
 * stays the default; reaching the internet is a choice.
 */

import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { PacketLink } from './transport.ts';
import { normalizeHubName } from '../domain/hubId.ts';

/**
 * A regular event kind, so relays retain it. Ephemeral kinds (20000-29999)
 * would be discarded, and retention is what lets someone who arrives later
 * still receive the board — the same job store-and-forward does on the mesh.
 */
export const NEARBOARD_KIND = 7373;

/** Public relays. No account, no registration, no operator relationship. */
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net'
];

/** WebSockets have no meaningful MTU, so nothing needs fragmenting. */
const NOSTR_MTU = 60_000;

const STORAGE_KEY = 'nearboard_nostr_sk';

// --- identity ---

/**
 * A Nostr keypair for this device, persisted.
 *
 * Separate from the mesh identity on purpose: this key is visible to relays and
 * links everything it signs, so it should not be the same key that identifies
 * the device on the local mesh.
 */
export function getOrCreateNostrKey(): Uint8Array {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const bytes = new Uint8Array(stored.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(stored.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  const sk = generateSecretKey();
  const hex = [...sk].map((b) => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(STORAGE_KEY, hex);
  return sk;
}

// --- hub key derivation ---

/**
 * AES-GCM key for a hub, derived from its normalised name.
 *
 * Deliberately the same input as the hub id, so the rule stays "knowing the
 * name gets you in" everywhere. The prefix keeps this key distinct from the id
 * derived over the same string.
 */
async function hubKey(hubName: string): Promise<CryptoKey> {
  const material = new TextEncoder().encode(`nearboard-hub-key:${normalizeHubName(hubName)}`);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt'
  ]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encrypt a frame. A fresh random IV per message, prepended to the ciphertext. */
async function seal(key: CryptoKey, frame: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // Copy into a freshly-allocated buffer: WebCrypto's types require a plain
  // ArrayBuffer, and a view handed to us may sit in a pooled one.
  const plain = new Uint8Array(frame.byteLength);
  plain.set(frame);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
  );
  const out = new Uint8Array(iv.byteLength + cipher.byteLength);
  out.set(iv, 0);
  out.set(cipher, iv.byteLength);
  return toBase64(out);
}

/** Decrypt a frame, or null if it was not meant for this hub. */
async function open(key: CryptoKey, payload: string): Promise<Uint8Array | null> {
  try {
    const bytes = fromBase64(payload);
    if (bytes.byteLength <= 12) return null;
    const iv = bytes.slice(0, 12);
    const cipher = bytes.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return new Uint8Array(plain);
  } catch {
    // Wrong key, corrupt event, or someone else's traffic on the same tag.
    // Not an error worth surfacing — just not ours.
    return null;
  }
}

// --- the link ---

export interface NostrLinkOptions {
  hubId: string;
  hubName: string;
  relays?: string[];
  onError?: (error: Error) => void;
  /**
   * Signing key. Defaults to the browser's persisted one; a server passes its
   * own, since it has no localStorage.
   */
  secretKey?: Uint8Array;
}

/**
 * One hub's traffic over Nostr, presented as an ordinary `PacketLink`.
 *
 * Modelling it as a link rather than a special case means `MeshNode` relays
 * between the internet and the local mesh without knowing the difference: a
 * post that arrives over Bluetooth is republished to Nostr and vice versa, so a
 * phone in the room bridges people who are not.
 */
export class NostrLink implements PacketLink {
  readonly mtu = NOSTR_MTU;

  private pool = new SimplePool();
  private relays: string[];
  private hubId: string;
  private hubName: string;
  private key: CryptoKey | null = null;
  private sk: Uint8Array | null = null;
  private handlers = new Set<(frame: Uint8Array) => void>();
  private closer: { close: () => void } | null = null;
  private onError: (error: Error) => void;
  private providedKey: Uint8Array | null;

  constructor(options: NostrLinkOptions) {
    this.hubId = options.hubId;
    this.hubName = options.hubName;
    this.relays = options.relays ?? DEFAULT_RELAYS;
    this.onError = options.onError ?? (() => {});
    this.providedKey = options.secretKey ?? null;
  }

  async start(): Promise<void> {
    this.key = await hubKey(this.hubName);
    this.sk = this.providedKey ?? getOrCreateNostrKey();

    this.closer = this.pool.subscribeMany(
      this.relays,
      { kinds: [NEARBOARD_KIND], '#h': [this.hubId] },
      {
        onevent: (event) => {
          void this.receive(event.content);
        }
      }
    );
  }

  async stop(): Promise<void> {
    this.closer?.close();
    this.closer = null;
    this.pool.close(this.relays);
  }

  async sendFrame(frame: Uint8Array): Promise<void> {
    if (!this.key || !this.sk) return;

    const content = await seal(this.key, frame);
    const event = finalizeEvent(
      {
        kind: NEARBOARD_KIND,
        created_at: Math.floor(Date.now() / 1000),
        // Only the hub id is in the clear, and it is a hash — a relay can route
        // and filter without learning the hub's name or its contents.
        tags: [['h', this.hubId]],
        content
      },
      this.sk
    );

    await Promise.any(this.pool.publish(this.relays, event)).catch((e) => {
      this.onError(e as Error);
    });
  }

  onFrame(handler: (frame: Uint8Array) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Public key this device signs with, for display. */
  get publicKey(): string | null {
    return this.sk ? getPublicKey(this.sk) : null;
  }

  private async receive(content: string): Promise<void> {
    if (!this.key) return;
    const frame = await open(this.key, content);
    // Events we cannot decrypt are someone else's, not a failure.
    if (!frame) return;
    for (const handler of this.handlers) handler(frame);
  }
}
