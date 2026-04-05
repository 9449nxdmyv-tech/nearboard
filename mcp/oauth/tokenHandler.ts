/**
 * @file tokenHandler.ts
 * @description OAuth 2.0 token validation for MCP server.
 *              Validates Firebase Auth ID tokens by verifying structure,
 *              claims, AND cryptographic signature using Google's public keys.
 * @todos
 *   - MED FEATURE: Token refresh endpoint for long-lived sessions
 */

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const PROJECT_ID = 'nearboard-app';

/** Cached JWKS keys with expiry */
let jwksCache: { keys: JsonWebKey[]; kidMap: Map<string, JsonWebKey>; expiry: number } | null = null;

/**
 * Fetches and caches Google's JWKS public keys for Firebase token verification.
 */
async function getSigningKey(kid: string): Promise<CryptoKey | null> {
	const now = Date.now();

	if (!jwksCache || jwksCache.expiry < now) {
		const res = await fetch(GOOGLE_JWKS_URL);
		if (!res.ok) return null;

		const data = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
		const kidMap = new Map<string, JsonWebKey>();
		for (const key of data.keys) {
			if (key.kid) kidMap.set(key.kid, key);
		}

		// Cache for 1 hour (Google rotates keys ~daily)
		jwksCache = { keys: data.keys, kidMap, expiry: now + 3600_000 };
	}

	const jwk = jwksCache.kidMap.get(kid);
	if (!jwk) return null;

	return crypto.subtle.importKey(
		'jwk',
		jwk,
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['verify']
	);
}

/**
 * Base64url decode (handles padding and URL-safe chars).
 */
function base64urlDecode(input: string): Uint8Array {
	const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * Validates a Firebase Auth ID token by verifying its structure, claims,
 * AND cryptographic signature against Google's public JWKS keys.
 *
 * Returns the user ID if valid, null otherwise.
 */
export async function validateToken(authHeader: string | null): Promise<string | null> {
	if (!authHeader?.startsWith('Bearer ')) return null;
	const token = authHeader.slice(7);
	if (!token) return null;

	try {
		const parts = token.split('.');
		if (parts.length !== 3) return null;

		// Decode header and payload
		const header = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0])));
		const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));

		// Validate algorithm
		if (header.alg !== 'RS256') return null;

		// Validate basic JWT claims
		const now = Math.floor(Date.now() / 1000);

		// Check expiration
		if (!payload.exp || payload.exp < now) return null;

		// Check issued-at is in the past (with 5-min clock skew tolerance)
		if (!payload.iat || payload.iat > now + 300) return null;

		// Check audience matches our project
		if (payload.aud !== PROJECT_ID) return null;

		// Check issuer
		if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) return null;

		// Check subject (uid) exists
		const uid = payload.sub as string;
		if (!uid || typeof uid !== 'string') return null;

		// Verify the cryptographic signature using Google's public keys
		if (!header.kid) return null;

		const signingKey = await getSigningKey(header.kid);
		if (!signingKey) return null;

		const signatureInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
		const signature = base64urlDecode(parts[2]);

		const isValid = await crypto.subtle.verify(
			'RSASSA-PKCS1-v1_5',
			signingKey,
			signature,
			signatureInput
		);

		if (!isValid) return null;

		return uid;
	} catch {
		return null;
	}
}
