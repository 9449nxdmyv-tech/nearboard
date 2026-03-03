const STORAGE_KEY = 'nearboard_identity';

export interface Identity {
  deviceId: string;
  publicKeyJwk?: JsonWebKey;
  privateKeyJwk?: JsonWebKey;
}

/**
 * Returns the persistent device identity, creating one on first load.
 * - deviceId: random UUID
 * - keyPair: ECDSA P-256 for future post signing
 */
export async function getOrCreateIdentity(): Promise<Identity> {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    return JSON.parse(stored) as Identity;
  }

  const deviceId = crypto.randomUUID();
  let publicKeyJwk: JsonWebKey | undefined;
  let privateKeyJwk: JsonWebKey | undefined;

  try {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true, // extractable
      ['sign', 'verify']
    );
    publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  } catch {
    // Web Crypto may not be available in all contexts; deviceId alone is fine for v1
    console.warn('Web Crypto unavailable, skipping keypair generation');
  }

  const identity: Identity = { deviceId, publicKeyJwk, privateKeyJwk };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

/** Quick accessor for just the deviceId (sync if already created) */
export function getDeviceIdSync(): string | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  return (JSON.parse(stored) as Identity).deviceId;
}
