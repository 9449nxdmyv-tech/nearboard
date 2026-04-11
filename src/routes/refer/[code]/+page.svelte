<!--
  @file refer/[code]/+page.svelte
  @description Referral landing page. Stores the referrer's code in localStorage
               and redirects to onboarding. A generic board mosaic is shown as a
               blurred background to give newcomers a visual feel for Nearboard.
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { Button } from 'konsta/svelte';
	import { CARD_ENTRANCE } from '$lib/config/animations';
	import { userStore } from '$lib/stores';

	const referralCode = $derived($page.params.code ?? '');

	// Store referral code immediately on mount
	onMount(() => {
		if (referralCode) {
			window.localStorage.setItem('nearboard_referredBy', referralCode);
		}
	});

	// Redirect signed-in users reactively (after auth loading completes)
	$effect(() => {
		if (!$userStore.loading && $userStore.user) {
			goto('/');
		}
	});

	function goToSignUp() {
		goto('/onboarding');
	}
</script>

<div class="relative min-h-screen bg-surface overflow-hidden">
	<!-- Background: generic board mosaic -->
	<div class="absolute inset-0">
		<div class="flex w-full h-full bg-surface">
			<div class="flex-1 flex flex-col">
				<div class="flex-1 bg-primary/10 flex items-center justify-center">
					<Icon icon="ph:note" class="text-on-surface text-5xl opacity-60" />
				</div>
				<div class="flex-1 bg-primary/10 flex items-center justify-center">
					<Icon icon="ph:link" class="text-on-surface text-5xl opacity-60" />
				</div>
				<div class="flex-1 bg-primary/10 flex items-center justify-center">
					<Icon icon="ph:list-checks" class="text-on-surface text-5xl opacity-60" />
				</div>
				</div>
				<div class="flex-1 flex flex-col">
				<div class="flex-1 bg-primary/10 flex items-center justify-center">
					<Icon icon="ph:image" class="text-on-surface text-5xl opacity-60" />
				</div>
				<div class="flex-1 bg-primary/10 flex items-center justify-center">
					<Icon icon="ph:map-pin" class="text-on-surface text-5xl opacity-60" />
				</div>
				<div class="flex-1 bg-primary/10 flex items-center justify-center">
					<Icon icon="ph:waveform" class="text-on-surface text-5xl opacity-60" />
				</div>
			</div>
		</div>
		<!-- Blur + dim overlay -->
		<div class="absolute inset-0 backdrop-blur-md bg-surface/60"></div>
	</div>

	<!-- Foreground: referral card -->
	<div class="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 py-12">
		<div
			class="w-full max-w-sm"
			in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration }}
		>
			<div class="bg-card/95 backdrop-blur-sm rounded-card border border-border shadow-card p-8">
				<div class="flex flex-col items-center">
					<div class="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center ring-2 ring-accent/20">
						<Icon icon="ph:users" class="text-2xl text-on-surface" />
					</div>
					<p class="text-sm text-muted mt-3">A friend invited you to join</p>
				</div>

				<div class="text-center mt-4">
					<h1 class="font-display text-xl font-semibold text-primary">
						Nearboard
					</h1>
					<p class="text-xs text-muted mt-1">A shared space for what matters</p>
				</div>

				<p class="text-sm text-muted text-center mt-4 leading-relaxed">
					Share links, notes, photos, and more with the people you care about.
				</p>

				<div class="mt-6">
					<Button large rounded onClick={goToSignUp} class="w-full">
						Get Started Free
					</Button>
					<p class="text-xs text-muted text-center mt-2.5">Free to use, no credit card needed</p>
				</div>
			</div>

			<p class="text-center text-[11px] text-muted/50 mt-4">
				Nearboard — a shared space for the people and things you care about
			</p>
		</div>
	</div>
</div>
