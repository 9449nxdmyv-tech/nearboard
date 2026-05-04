<!--
  @file pricing/+page.svelte
  @description Two-tier pricing: Free (generous) and Plus ($5/mo or $40/yr).
               Plus gates only real cost drivers (voice briefings, manual AI regen).
               No nickel-and-diming on UX features.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import Icon from '@iconify/svelte';
	import { userStore, showToast } from '$lib/stores';
	import { Page, Button } from 'konsta/svelte';
	import Header from '$lib/components/ui/Header.svelte';
	import type { UserDoc } from '$lib/types';
	import { isPlus, PLUS_PRICING } from '$lib/utils/tier';
	import { startCheckout, openCustomerPortal } from '$lib/firebase';

	let user = $derived($userStore.user);
	let loading = $state(true);
	let userData = $state<UserDoc | null>(null);
	let billingCycle = $state<'monthly' | 'yearly'>('yearly');
	let busy = $state(false);

	$effect(() => {
		const params = $page.url.searchParams;
		if (params.get('success') === '1') showToast('Welcome to Plus — thank you!', 'success');
		if (params.get('canceled') === '1') showToast('Checkout canceled', 'info');
	});

	async function handleUpgrade() {
		if (busy) return;
		busy = true;
		try {
			await startCheckout(billingCycle);
		} catch (err) {
			console.error('Checkout failed:', err);
			showToast('Could not start checkout. Please try again.', 'error');
			busy = false;
		}
	}

	async function handleManage() {
		if (busy) return;
		busy = true;
		try {
			await openCustomerPortal();
		} catch (err) {
			console.error('Portal failed:', err);
			showToast('Could not open billing portal.', 'error');
			busy = false;
		}
	}

	onMount(async () => {
		if (!user) {
			goto('/onboarding');
			return;
		}

		const { doc, getDoc } = await import('firebase/firestore');
		const { db } = await import('$lib/firebase/app');

		try {
			const userRef = doc(db(), 'users', user.uid);
			const userSnap = await getDoc(userRef);
			if (userSnap.exists()) {
				userData = userSnap.data() as UserDoc;
			}
		} catch (err) {
			console.error('Failed to fetch user data:', err);
		} finally {
			loading = false;
		}
	});

	const userIsPlus = $derived(isPlus(userData));
	const yearlySavings = $derived(PLUS_PRICING.monthly * 12 - PLUS_PRICING.yearly);
</script>

<svelte:head>
	<title>Pricing — Nearboard</title>
</svelte:head>

<Page>
	<Header title="Pricing" backHref="/" />

	<main class="flex-1 px-6 py-8 max-w-2xl mx-auto w-full">
		<!-- Header -->
		<div class="text-center mb-8">
			<h1 class="text-[24px] font-semibold text-on-surface tracking-tight mb-2">
				Simple, honest pricing
			</h1>
			<p class="text-[14px] text-muted leading-relaxed max-w-md mx-auto">
				Nearboard is generously free. Plus is for people who want to
				support the project and unlock on-demand AI.
			</p>
		</div>

		{#if !loading && userIsPlus}
			<div class="bg-accent/10 border border-accent/20 rounded-[var(--radius-card)] p-4 mb-6 flex items-center gap-3">
				<Icon icon="ph:star-fill" class="text-2xl text-accent" />
				<div class="flex-1">
					<p class="text-sm font-semibold text-on-surface">You're on Plus</p>
					<p class="text-xs text-muted">Thank you for supporting Nearboard.</p>
				</div>
				<button
					onclick={handleManage}
					disabled={busy}
					class="text-xs text-accent font-medium underline disabled:opacity-50"
				>
					Manage billing
				</button>
			</div>
		{/if}

		<!-- Free tier -->
		<div class="bg-card rounded-[var(--radius-card)] shadow-card p-6 mb-4">
			<div class="flex items-baseline justify-between mb-4">
				<h2 class="text-lg font-semibold text-on-surface">Free</h2>
				<p class="text-sm text-muted">$0 forever</p>
			</div>
			<ul class="space-y-2.5">
				<li class="flex items-start gap-2.5">
					<Icon icon="ph:check" class="text-success text-lg shrink-0 mt-0.5" />
					<span class="text-[14px] text-on-surface">Unlimited boards and members</span>
				</li>
				<li class="flex items-start gap-2.5">
					<Icon icon="ph:check" class="text-success text-lg shrink-0 mt-0.5" />
					<span class="text-[14px] text-on-surface">All capture types — notes, photos, video, voice, links, lists, polls, location</span>
				</li>
				<li class="flex items-start gap-2.5">
					<Icon icon="ph:check" class="text-success text-lg shrink-0 mt-0.5" />
					<span class="text-[14px] text-on-surface">Daily AI living summary on every board</span>
				</li>
				<li class="flex items-start gap-2.5">
					<Icon icon="ph:check" class="text-success text-lg shrink-0 mt-0.5" />
					<span class="text-[14px] text-on-surface">Comments, reactions, sharing, daily email digest</span>
				</li>
				<li class="flex items-start gap-2.5">
					<Icon icon="ph:check" class="text-success text-lg shrink-0 mt-0.5" />
					<span class="text-[14px] text-on-surface">Browser extension and mobile share sheet</span>
				</li>
			</ul>
		</div>

		<!-- Plus tier -->
		<div class="bg-card rounded-[var(--radius-card)] shadow-md border-2 border-accent p-6 mb-6">
			<div class="flex items-baseline justify-between mb-1">
				<h2 class="text-lg font-semibold text-on-surface flex items-center gap-2">
					<Icon icon="ph:star-fill" class="text-accent" />
					Plus
				</h2>
				<div class="text-right">
					<p class="text-2xl font-bold text-on-surface">
						${billingCycle === 'monthly' ? PLUS_PRICING.monthly : (PLUS_PRICING.yearly / 12).toFixed(2)}
						<span class="text-sm font-normal text-muted">/mo</span>
					</p>
					{#if billingCycle === 'yearly'}
						<p class="text-[11px] text-muted">${PLUS_PRICING.yearly} billed yearly</p>
					{/if}
				</div>
			</div>

			<!-- Billing toggle -->
			<div class="flex gap-1 p-1 bg-surface rounded-full mb-4 mt-3 w-fit">
				<button
					class="px-3 py-1 text-[12px] rounded-full transition-colors {billingCycle === 'monthly' ? 'bg-card shadow-sm text-on-surface font-medium' : 'text-muted'}"
					onclick={() => (billingCycle = 'monthly')}
				>
					Monthly
				</button>
				<button
					class="px-3 py-1 text-[12px] rounded-full transition-colors {billingCycle === 'yearly' ? 'bg-card shadow-sm text-on-surface font-medium' : 'text-muted'}"
					onclick={() => (billingCycle = 'yearly')}
				>
					Yearly
					<span class="ml-1 text-success font-semibold">save ${yearlySavings}</span>
				</button>
			</div>

			<ul class="space-y-2.5 mb-5">
				<li class="flex items-start gap-2.5">
					<Icon icon="ph:check" class="text-accent text-lg shrink-0 mt-0.5" />
					<span class="text-[14px] text-on-surface">Everything in Free</span>
				</li>
				<li class="flex items-start gap-2.5">
					<Icon icon="ph:check" class="text-accent text-lg shrink-0 mt-0.5" />
					<span class="text-[14px] text-on-surface">On-demand AI summary regeneration on any board you own</span>
				</li>
				<li class="flex items-start gap-2.5">
					<Icon icon="ph:check" class="text-accent text-lg shrink-0 mt-0.5" />
					<span class="text-[14px] text-on-surface">Higher rate limits for AI agents and the MCP server</span>
				</li>
				<li class="flex items-start gap-2.5">
					<Icon icon="ph:check" class="text-accent text-lg shrink-0 mt-0.5" />
					<span class="text-[14px] text-on-surface">Supporter badge on your profile</span>
				</li>
				<li class="flex items-start gap-2.5">
					<Icon icon="ph:check" class="text-accent text-lg shrink-0 mt-0.5" />
					<span class="text-[14px] text-on-surface">You're keeping the lights on — thank you</span>
				</li>
			</ul>

			<Button large rounded disabled={userIsPlus || busy} onclick={handleUpgrade} class="w-full">
				{#if userIsPlus}
					You're on Plus
				{:else if busy}
					Starting checkout…
				{:else}
					Upgrade to Plus
				{/if}
			</Button>
		</div>

		<!-- Honesty footer -->
		<div class="text-center px-4">
			<p class="text-[12px] text-muted leading-relaxed">
				Plus only gates features whose cost scales with usage (on-demand AI calls).
				Everything else stays free — no artificial limits, no upsell prompts, no dark patterns.
			</p>
		</div>
	</main>
</Page>
