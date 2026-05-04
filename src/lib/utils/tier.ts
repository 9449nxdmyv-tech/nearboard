/**
 * @file tier.ts
 * @description Subscription tier helpers. Two-tier model: Free (generous) and Plus.
 *              Plus only gates real cost drivers (voice briefings, manual AI regen).
 *              UX features stay free for everyone.
 */

import type { UserDoc } from '$lib/types';

export type Tier = 'free' | 'plus';

export function getTier(user: Pick<UserDoc, 'subscriptionTier'> | null | undefined): Tier {
	return user?.subscriptionTier === 'plus' ? 'plus' : 'free';
}

export function isPlus(user: Pick<UserDoc, 'subscriptionTier'> | null | undefined): boolean {
	return getTier(user) === 'plus';
}

/** Pricing constants — single source of truth for display + checkout. */
export const PLUS_PRICING = {
	monthly: 5,
	yearly: 40,
	currency: 'USD'
} as const;
