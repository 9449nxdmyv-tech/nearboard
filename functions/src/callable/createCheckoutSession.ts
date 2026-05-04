/**
 * @file createCheckoutSession.ts
 * @description HTTPS callable that creates a Stripe Checkout Session for the
 *              authenticated user. Returns the hosted checkout URL.
 *              Subscription tier is updated by the stripeWebhook handler when
 *              `checkout.session.completed` fires (not from the client).
 */

import '../utils/admin.js';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import Stripe from 'stripe';

type Cycle = 'monthly' | 'yearly';

interface Payload {
	cycle: Cycle;
	successUrl: string;
	cancelUrl: string;
}

export const createCheckoutSession = onCall(
	{ secrets: ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID_MONTHLY', 'STRIPE_PRICE_ID_YEARLY'] },
	async (request) => {
		if (!request.auth?.uid) {
			throw new HttpsError('unauthenticated', 'You must be signed in to upgrade.');
		}

		const { cycle, successUrl, cancelUrl } = (request.data ?? {}) as Partial<Payload>;
		if (cycle !== 'monthly' && cycle !== 'yearly') {
			throw new HttpsError('invalid-argument', 'cycle must be "monthly" or "yearly".');
		}
		if (!successUrl || !cancelUrl) {
			throw new HttpsError('invalid-argument', 'successUrl and cancelUrl are required.');
		}

		const priceId = cycle === 'monthly'
			? process.env.STRIPE_PRICE_ID_MONTHLY
			: process.env.STRIPE_PRICE_ID_YEARLY;
		if (!priceId) {
			throw new HttpsError('failed-precondition', `Stripe price for ${cycle} not configured.`);
		}

		const uid = request.auth.uid;
		const db = getFirestore();
		const userSnap = await db.doc(`users/${uid}`).get();
		const userData = userSnap.data() ?? {};
		const email = userData.email as string | undefined;

		const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-04-22.dahlia' });

		// Reuse Stripe customer if we already have one for this user
		let customerId = userData.stripeCustomerId as string | undefined;
		if (!customerId) {
			const customer = await stripe.customers.create({
				email,
				metadata: { firebaseUid: uid }
			});
			customerId = customer.id;
			await db.doc(`users/${uid}`).update({ stripeCustomerId: customerId });
		}

		const session = await stripe.checkout.sessions.create({
			mode: 'subscription',
			customer: customerId,
			line_items: [{ price: priceId, quantity: 1 }],
			success_url: successUrl,
			cancel_url: cancelUrl,
			allow_promotion_codes: true,
			client_reference_id: uid,
			subscription_data: { metadata: { firebaseUid: uid } }
		});

		return { url: session.url };
	}
);
