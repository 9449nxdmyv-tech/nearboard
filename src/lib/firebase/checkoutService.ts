/**
 * @file checkoutService.ts
 * @description Client-side helpers that invoke the Stripe checkout/portal
 *              callable Cloud Functions. The functions return a URL — the
 *              caller is responsible for redirecting the browser to it.
 */

import { httpsCallable, getFunctions } from 'firebase/functions';
import { getApp } from 'firebase/app';

type Cycle = 'monthly' | 'yearly';

export async function startCheckout(cycle: Cycle): Promise<void> {
	const fn = httpsCallable<
		{ cycle: Cycle; successUrl: string; cancelUrl: string },
		{ url: string }
	>(getFunctions(getApp()), 'createCheckoutSession');

	const origin = window.location.origin;
	const result = await fn({
		cycle,
		successUrl: `${origin}/pricing?success=1`,
		cancelUrl: `${origin}/pricing?canceled=1`
	});

	if (!result.data?.url) throw new Error('No checkout URL returned.');
	window.location.assign(result.data.url);
}

export async function openCustomerPortal(): Promise<void> {
	const fn = httpsCallable<{ returnUrl: string }, { url: string }>(
		getFunctions(getApp()),
		'createPortalSession'
	);

	const result = await fn({ returnUrl: `${window.location.origin}/pricing` });
	if (!result.data?.url) throw new Error('No portal URL returned.');
	window.location.assign(result.data.url);
}
