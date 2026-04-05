/**
 * @file digestUnsubscribe.ts
 * @description HTTPS endpoint for one-tap email digest unsubscribe.
 *              Validates an HMAC token so users can unsubscribe without logging in.
 *              Supports both GET (browser click) and POST (List-Unsubscribe header).
 */

import '../utils/admin.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';

export const digestUnsubscribe = onRequest(
	{ secrets: ['DIGEST_HMAC_SECRET'], cors: true },
	async (req, res) => {
		const uid = req.query.uid as string | undefined;
		const token = req.query.token as string | undefined;

		if (!uid || !token) {
			res.status(400).send(errorPage('Missing parameters.'));
			return;
		}

		const secret = process.env.DIGEST_HMAC_SECRET;
		if (!secret) {
			console.error('DIGEST_HMAC_SECRET not configured');
			res.status(500).send(errorPage('Server configuration error.'));
			return;
		}

		// Verify HMAC token
		const expected = createHmac('sha256', secret).update(uid).digest('hex');
		const tokenBuf = Buffer.from(token, 'hex');
		const expectedBuf = Buffer.from(expected, 'hex');

		if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
			res.status(403).send(errorPage('Invalid or expired unsubscribe link.'));
			return;
		}

		// Set digestEnabled = false
		const db = getFirestore();
		const userRef = db.doc(`users/${uid}`);
		const userSnap = await userRef.get();

		if (!userSnap.exists) {
			res.status(404).send(errorPage('User not found.'));
			return;
		}

		await userRef.update({ digestEnabled: false });

		res.status(200).send(successPage());
	}
);

function successPage(): string {
	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed — Nearboard</title></head>
<body style="margin:0;padding:0;background:#f0f0f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;padding:40px;background:#fff;border-radius:16px;max-width:400px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
	<div style="font-size:48px;margin-bottom:16px;">\u2705</div>
	<h1 style="font-size:20px;color:#1a1a1a;margin:0 0 8px;">You're unsubscribed</h1>
	<p style="font-size:14px;color:#666;margin:0 0 20px;">You won't receive any more digest emails from Nearboard.</p>
	<p style="font-size:13px;color:#888;">You can re-enable the digest anytime in your profile settings.</p>
</div>
</body></html>`;
}

function errorPage(message: string): string {
	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Error — Nearboard</title></head>
<body style="margin:0;padding:0;background:#f0f0f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;padding:40px;background:#fff;border-radius:16px;max-width:400px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
	<div style="font-size:48px;margin-bottom:16px;">\u26A0\uFE0F</div>
	<h1 style="font-size:20px;color:#1a1a1a;margin:0 0 8px;">Something went wrong</h1>
	<p style="font-size:14px;color:#666;margin:0;">${message}</p>
</div>
</body></html>`;
}
