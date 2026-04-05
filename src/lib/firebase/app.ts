/**
 * @file firebase/app.ts
 * @description Firebase app initialization. Imported by service modules — never
 *              import this directly from components. Use the barrel at firebase/index.ts.
 *
 *              Initialization is lazy — getter functions return real Firebase instances
 *              on first call. The app won't crash if env vars are missing during SSR.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

/** Required VITE_FIREBASE_* environment variables. */
const REQUIRED_ENV_VARS = [
	'VITE_FIREBASE_API_KEY',
	'VITE_FIREBASE_AUTH_DOMAIN',
	'VITE_FIREBASE_PROJECT_ID',
	'VITE_FIREBASE_STORAGE_BUCKET',
	'VITE_FIREBASE_MESSAGING_SENDER_ID',
	'VITE_FIREBASE_APP_ID'
] as const;

/**
 * Validates that all required Firebase environment variables are set.
 * Logs a clear error listing any missing vars. Runs once on first import.
 */
function validateEnvVars(): void {
	const missing = REQUIRED_ENV_VARS.filter(
		(key) => !import.meta.env[key]
	);
	if (missing.length > 0) {
		console.error(
			`[Firebase] Missing required environment variables:\n` +
			missing.map((v) => `  - ${v}`).join('\n') +
			`\nCopy .env.example to .env and fill in your Firebase project credentials.`
		);
	}
}

// Run validation once on module load (no-op during SSR if vars are absent)
validateEnvVars();

const firebaseConfig = {
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
	authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: import.meta.env.VITE_FIREBASE_APP_ID
};

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;
let _auth: Auth | null = null;
let _storage: FirebaseStorage | null = null;
let _appCheckInitialized = false;

function ensureApp(): FirebaseApp {
	if (!_app) {
		if (!firebaseConfig.apiKey) {
			throw new Error(
				'Firebase is not configured. Copy .env.example to .env and fill in your Firebase project credentials.'
			);
		}
		_app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

		// Initialize App Check (browser-only, requires reCAPTCHA site key)
		// In development, use debug token to bypass reCAPTCHA validation
		if (!_appCheckInitialized && typeof window !== 'undefined') {
			if (import.meta.env.DEV) {
				// Debug provider for localhost — prints a debug token to console
				// Register it in Firebase Console > App Check > Apps > Manage debug tokens
				(self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
			}
			const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
			if (siteKey) {
				initializeAppCheck(_app, {
					provider: new ReCaptchaEnterpriseProvider(siteKey),
					isTokenAutoRefreshEnabled: true
				});
				_appCheckInitialized = true;
			}
		}
	}
	return _app;
}

export function app(): FirebaseApp {
	return ensureApp();
}

export function db(): Firestore {
	if (!_db) _db = getFirestore(ensureApp());
	return _db;
}

export function auth(): Auth {
	if (!_auth) _auth = getAuth(ensureApp());
	return _auth;
}

export function storage(): FirebaseStorage {
	if (!_storage) _storage = getStorage(ensureApp());
	return _storage;
}
