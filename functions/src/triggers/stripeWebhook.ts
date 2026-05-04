/**
 * @file stripeWebhook.ts
 * @description HTTPS endpoint that receives Stripe subscription events and
 *              syncs the user's `subscriptionTier` field. Verifies the webhook
 *              signature using STRIPE_WEBHOOK_SECRET.
 *
 *              Events handled:
 *              - customer.subscription.created/updated → set tier to 'plus' if active
 *              - customer.subscription.deleted          → revert tier to 'free'
 *              - checkout.session.completed             → ensure stripeCustomerId stored
 */

import '../utils/admin.js';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import Stripe from 'stripe';

const ACTIVE_STATUSES: Stripe.Subscription.Status[] = ['active', 'trialing'];

export const stripeWebhook = onRequest(
	{ secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] },
	async (req, res) => {
		const sig = req.headers['stripe-signature'];
		if (!sig || typeof sig !== 'string') {
			res.status(400).send('Missing stripe-signature header.');
			return;
		}

		const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-04-22.dahlia' });
		const secret = process.env.STRIPE_WEBHOOK_SECRET!;

		let event: Stripe.Event;
		try {
			// onRequest provides the raw body buffer on req.rawBody for signed webhooks.
			event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
		} catch (err) {
			console.error('Stripe webhook signature verification failed:', err);
			res.status(400).send('Invalid signature.');
			return;
		}

		try {
			switch (event.type) {
				case 'customer.subscription.created':
				case 'customer.subscription.updated':
				case 'customer.subscription.deleted':
					await syncSubscription(event.data.object as Stripe.Subscription);
					break;

				case 'checkout.session.completed': {
					const session = event.data.object as Stripe.Checkout.Session;
					const uid = session.client_reference_id;
					const customerId = typeof session.customer === 'string' ? session.customer : null;
					if (uid && customerId) {
						await getFirestore().doc(`users/${uid}`).set(
							{ stripeCustomerId: customerId },
							{ merge: true }
						);
					}
					break;
				}
			}
			res.status(200).send('ok');
		} catch (err) {
			console.error('Stripe webhook handler error:', err);
			res.status(500).send('Handler error.');
		}
	}
);

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
	const uid = sub.metadata?.firebaseUid;
	if (!uid) {
		console.warn('Subscription event missing firebaseUid metadata:', sub.id);
		return;
	}

	const tier = ACTIVE_STATUSES.includes(sub.status) ? 'plus' : 'free';
	const update: Record<string, unknown> = { subscriptionTier: tier };

	if (tier === 'plus') {
		update.subscriptionStartedAt = Timestamp.fromMillis(sub.start_date * 1000);
	}

	await getFirestore().doc(`users/${uid}`).set(update, { merge: true });
}
