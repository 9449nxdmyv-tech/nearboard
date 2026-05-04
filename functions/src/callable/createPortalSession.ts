/**
 * @file createPortalSession.ts
 * @description HTTPS callable that returns a Stripe Customer Portal URL so
 *              existing Plus subscribers can update payment, cancel, or view invoices.
 */

import '../utils/admin.js';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import Stripe from 'stripe';

interface Payload {
	returnUrl: string;
}

export const createPortalSession = onCall(
	{ secrets: ['STRIPE_SECRET_KEY'] },
	async (request) => {
		if (!request.auth?.uid) {
			throw new HttpsError('unauthenticated', 'You must be signed in.');
		}

		const { returnUrl } = (request.data ?? {}) as Partial<Payload>;
		if (!returnUrl) {
			throw new HttpsError('invalid-argument', 'returnUrl is required.');
		}

		const uid = request.auth.uid;
		const db = getFirestore();
		const userSnap = await db.doc(`users/${uid}`).get();
		const customerId = userSnap.data()?.stripeCustomerId as string | undefined;
		if (!customerId) {
			throw new HttpsError('failed-precondition', 'No Stripe customer on this account.');
		}

		const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-04-22.dahlia' });
		const portal = await stripe.billingPortal.sessions.create({
			customer: customerId,
			return_url: returnUrl
		});

		return { url: portal.url };
	}
);
