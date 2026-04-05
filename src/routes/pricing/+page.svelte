<!--
  @file pricing/+page.svelte
  @description Pricing page for Nearboard (Lever 6 — Monetization).
               Shows transparent pricing with supporter and lifetime tiers.
               Free tier: 3 boards. Supporter/Lifetime: unlimited boards + AI enrichment.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { userStore } from '$lib/stores';
	import { Page } from 'konsta/svelte';
	import Header from '$lib/components/ui/Header.svelte';
	import type { UserDoc } from '$lib/types';

	let user = $derived($userStore.user);
	let loading = $state(true);
	let userData = $state<UserDoc | null>(null);

	onMount(async () => {
		if (!user) {
			goto('/onboarding');
			return;
		}

		// Fetch user data to check subscription tier
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

	const currentTier = $derived(userData?.subscriptionTier || 'free');
	const ownedBoardCount = $derived(userData?.ownedBoardCount || 0);
	const isSupporter = $derived(currentTier === 'supporter' || currentTier === 'lifetime');

	const FREE_TIER_LIMIT = 3;
</script>

<svelte:head>
	<title>Pricing — Nearboard</title>
</svelte:head>

<Page>
	<Header title="Support Nearboard" backHref="/" />

	<main class="flex-1 px-6 py-8">
		<!-- Current status -->
		{#if !loading}
			<div class="bg-card rounded-[var(--radius-card)] shadow-card p-4 mb-8">
				<div class="flex items-center gap-3 mb-2">
					<Icon 
						icon={isSupporter ? 'ph:star-fill' : 'ph:user-circle'} 
						class="text-2xl {isSupporter ? 'text-amber-400' : 'text-on-surface/60'}" 
					/>
					<div>
						<p class="text-sm font-medium text-primary">
							{isSupporter ? 'Supporter' : 'Free Tier'}
						</p>
						<p class="text-xs text-muted">
							{ownedBoardCount} / {isSupporter ? '∞' : FREE_TIER_LIMIT} boards owned
						</p>
					</div>
				</div>
				{#if !isSupporter && ownedBoardCount >= FREE_TIER_LIMIT}
					<div class="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
						<p class="text-xs text-amber-600 font-medium">
							<Icon icon="ph:warning" class="inline mr-1" />
							You've reached the free tier limit. Upgrade to create more boards.
						</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Value proposition -->
		<div class="text-center mb-8">
			<h1 class="text-[22px] font-semibold text-on-surface tracking-tight mb-2">
				Transparent Pricing
			</h1>
			<p class="text-[13px] text-muted max-w-md mx-auto leading-relaxed">
				Free to join and contribute. Pay only when you need more boards
				or want AI-powered features.
			</p>
		</div>

		<!-- Pricing tiers -->
		<div class="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
			<!-- Free Tier -->
			<div class="bg-card rounded-[var(--radius-card)] shadow-card p-6">
				<div class="flex items-center gap-3 mb-4">
					<div class="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
						<Icon icon="ph:user-circle" class="text-2xl text-on-surface/60" />
					</div>
					<div>
						<h2 class="text-lg font-semibold text-primary">Free</h2>
						<p class="text-xs text-muted">Forever free</p>
					</div>
				</div>
				
				<ul class="space-y-3 mb-6">
					<li class="flex items-start gap-2">
						<Icon icon="ph:check-circle-fill" class="text-success text-lg shrink-0" />
						<span class="text-sm text-primary">Join unlimited boards</span>
					</li>
					<li class="flex items-start gap-2">
						<Icon icon="ph:check-circle-fill" class="text-success text-lg shrink-0" />
						<span class="text-sm text-primary">Create up to 3 boards</span>
					</li>
					<li class="flex items-start gap-2">
						<Icon icon="ph:check-circle-fill" class="text-success text-lg shrink-0" />
						<span class="text-sm text-primary">AI living summaries</span>
					</li>
					<li class="flex items-start gap-2">
						<Icon icon="ph:check-circle-fill" class="text-success text-lg shrink-0" />
						<span class="text-sm text-primary">Daily email digest</span>
					</li>
					<li class="flex items-start gap-2 opacity-50">
						<Icon icon="ph:x-circle-fill" class="text-muted text-lg shrink-0" />
						<span class="text-sm text-muted">Unlimited board creation</span>
					</li>
					<li class="flex items-start gap-2 opacity-50">
						<Icon icon="ph:x-circle-fill" class="text-muted text-lg shrink-0" />
						<span class="text-sm text-muted">AI enrichment (auto-captions, categorization)</span>
					</li>
				</ul>

				<button 
					disabled 
					class="w-full py-3 bg-surface text-primary rounded-lg text-sm font-medium border border-border cursor-not-allowed"
				>
					{currentTier === 'free' ? 'Current Plan' : 'Downgrade'}
				</button>
			</div>

			<!-- Supporter Tier -->
			<div class="bg-card rounded-[var(--radius-card)] shadow-md border-2 border-accent p-6 relative">
				<div class="absolute -top-3 right-4 px-3 py-1 bg-accent text-white text-xs font-bold rounded-full">
					RECOMMENDED
				</div>
				
				<div class="flex items-center gap-3 mb-4">
					<div class="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
						<Icon icon="ph:star-fill" class="text-2xl text-accent" />
					</div>
					<div>
						<h2 class="text-lg font-semibold text-primary">Supporter</h2>
						<p class="text-xs text-muted">$5/month or $50/year</p>
					</div>
				</div>
				
				<ul class="space-y-3 mb-6">
					<li class="flex items-start gap-2">
						<Icon icon="ph:check-circle-fill" class="text-success text-lg shrink-0" />
						<span class="text-sm text-primary">Everything in Free, plus:</span>
					</li>
					<li class="flex items-start gap-2">
						<Icon icon="ph:check-circle-fill" class="text-success text-lg shrink-0" />
						<span class="text-sm text-primary">Unlimited board creation</span>
					</li>
					<li class="flex items-start gap-2">
						<Icon icon="ph:check-circle-fill" class="text-success text-lg shrink-0" />
						<span class="text-sm text-primary">AI enrichment on your boards</span>
					</li>
					<li class="flex items-start gap-2">
						<Icon icon="ph:check-circle-fill" class="text-success text-lg shrink-0" />
						<span class="text-sm text-primary">Supporter badge on profile</span>
					</li>
					<li class="flex items-start gap-2">
						<Icon icon="ph:check-circle-fill" class="text-success text-lg shrink-0" />
						<span class="text-sm text-primary">Priority feature requests</span>
					</li>
				</ul>

				<button 
					class="w-full py-3 bg-accent text-white rounded-lg text-sm font-medium
						hover:bg-accent/90 press-scale transition-all"
				>
					{currentTier === 'supporter' ? 'Current Plan' : 'Become a Supporter'}
				</button>
				
				<p class="text-xs text-muted text-center mt-3">
					Where your money goes: Server costs, AI API usage, and development
				</p>
			</div>
		</div>

		<!-- Lifetime tier -->
		<div class="max-w-4xl mx-auto mt-6">
			<div class="bg-card rounded-[var(--radius-card)] shadow-card p-6">
				<div class="flex items-center justify-between mb-4">
					<div class="flex items-center gap-3">
						<div class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
							<Icon icon="ph:crown-fill" class="text-2xl text-on-surface" />
						</div>
						<div>
							<h2 class="text-lg font-semibold text-primary">Lifetime</h2>
							<p class="text-xs text-muted">One-time payment</p>
						</div>
					</div>
					<div class="text-right">
						<p class="text-2xl font-bold text-primary">$150</p>
						<p class="text-xs text-muted">one-time</p>
					</div>
				</div>
				
				<div class="flex items-center justify-between">
					<ul class="space-y-2">
						<li class="flex items-start gap-2">
							<Icon icon="ph:check-circle-fill" class="text-success text-lg shrink-0" />
							<span class="text-sm text-primary">All Supporter benefits</span>
						</li>
						<li class="flex items-start gap-2">
							<Icon icon="ph:check-circle-fill" class="text-success text-lg shrink-0" />
							<span class="text-sm text-primary">Pay once, use forever</span>
						</li>
						<li class="flex items-start gap-2">
							<Icon icon="ph:check-circle-fill" class="text-success text-lg shrink-0" />
							<span class="text-sm text-primary">Early access to new features</span>
						</li>
					</ul>
					
					<button 
						class="px-6 py-3 bg-primary text-white rounded-lg text-sm font-medium
							hover:bg-primary/90 press-scale transition-all"
					>
						{currentTier === 'lifetime' ? 'Current Plan' : 'Go Lifetime'}
					</button>
				</div>
			</div>
		</div>

		<!-- Transparency section -->
		<div class="max-w-4xl mx-auto mt-8">
			<div class="bg-accent/5 rounded-[var(--radius-card)] border border-accent/20 p-6">
				<h3 class="text-sm font-semibold text-primary mb-3 flex items-center gap-2">
					<Icon icon="ph:info" class="text-on-surface" />
					Where Your Money Goes
				</h3>
				<div class="grid sm:grid-cols-3 gap-4">
					<div class="text-center">
						<p class="text-2xl font-bold text-accent">40%</p>
						<p class="text-xs text-muted">Server & hosting costs</p>
					</div>
					<div class="text-center">
						<p class="text-2xl font-bold text-accent">35%</p>
						<p class="text-xs text-muted">AI API usage (Gemini, Groq)</p>
					</div>
					<div class="text-center">
						<p class="text-2xl font-bold text-accent">25%</p>
						<p class="text-xs text-muted">Development & support</p>
					</div>
				</div>
			</div>
		</div>
	</main>
</Page>
