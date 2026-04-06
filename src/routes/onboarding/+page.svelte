<!--
  @file onboarding/+page.svelte
  @description Premium onboarding flow using the app's own design system.
               Mockups mirror real card/component styles. Swipe + auth.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { fly, fade } from 'svelte/transition';
	import { page } from '$app/stores';
	import { Timestamp } from 'firebase/firestore';
	import Icon from '@iconify/svelte';
	import { PAGE_TRANSITION, TRANSITION_FAST } from '$lib/config/animations';
	import { onMount } from 'svelte';
	import { isSignInWithEmailLink } from 'firebase/auth';
	import { auth } from '$lib/firebase/app';
	import { signInWithGoogle, signInWithApple, sendEmailLink, completeEmailLinkSignIn, setBirthDate } from '$lib/firebase';
	import { userStore } from '$lib/stores';
	import AgeGate from '$lib/components/ui/AgeGate.svelte';

	const TOTAL_SLIDES = 4;

	let currentSlide = $state(0);
	let email = $state('');
	let showEmailInput = $state(false);
	let emailSent = $state(false);
	let error = $state<string | null>(null);
	let busy = $state(false);
	const showAgeGate = $derived($page.url.searchParams.get('step') === 'age');
	// Email link confirmation: when user arrives via email link but localStorage doesn't have the email
	let pendingEmailLink = $state(false);
	let confirmEmail = $state('');

	onMount(() => {
		if (isSignInWithEmailLink(auth(), window.location.href)) {
			const stored = window.localStorage.getItem('nearboard_emailForSignIn');
			if (stored) {
				// Auto-complete sign-in
				busy = true;
				completeEmailLinkSignIn()
					.then((user) => {
						if (user) goto('/onboarding?step=age');
					})
					.catch((err) => {
						console.error('Email link sign-in failed:', err);
						error = 'Sign-in link expired or invalid. Please request a new one.';
					})
					.finally(() => { busy = false; });
			} else {
				// Need email confirmation — show the form
				pendingEmailLink = true;
				currentSlide = TOTAL_SLIDES - 1;
				showEmailInput = true;
			}
		}
	});

	async function handleConfirmEmailLink() {
		if (!confirmEmail.trim()) return;
		busy = true;
		error = null;
		try {
			// Store the email so completeEmailLinkSignIn can use it
			window.localStorage.setItem('nearboard_emailForSignIn', confirmEmail.trim());
			const user = await completeEmailLinkSignIn();
			if (user) goto('/onboarding?step=age');
			else error = 'Could not complete sign-in. Please try again.';
		} catch (err) {
			console.error('Email link confirm failed:', err);
			error = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
		} finally {
			busy = false;
		}
	}

	let touchStartX = $state(0);
	let touchStartY = $state(0);

	function handleTouchStart(e: TouchEvent) {
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
	}

	function handleTouchEnd(e: TouchEvent) {
		const dx = e.changedTouches[0].clientX - touchStartX;
		const dy = e.changedTouches[0].clientY - touchStartY;
		if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
		if (dx < 0 && currentSlide < TOTAL_SLIDES - 1) currentSlide++;
		if (dx > 0 && currentSlide > 0) currentSlide--;
	}

	async function handleAgeVerified(birthDate: Date) {
		const user = $userStore.user;
		if (!user) return;
		busy = true;
		error = null;
		try {
			const ageGroup = await setBirthDate(user.uid, birthDate);
			userStore.update((s) => s.user ? {
				...s,
				user: { ...s.user, birthDate: Timestamp.fromDate(birthDate), ageGroup }
			} : s);
			// New users go to onboarding intent; returning users go home
			goto(user.onboardingCompletedAt ? '/' : '/onboarding/intent');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Age verification failed.';
		} finally {
			busy = false;
		}
	}

	const isLastSlide = $derived(currentSlide === TOTAL_SLIDES - 1);

	function nextSlide() {
		if (!isLastSlide) currentSlide++;
	}

	async function handleGoogle() {
		busy = true;
		error = null;
		try {
			await signInWithGoogle();
			// Redirection to age gate happens via +layout.svelte, 
			// but we can be explicit here for speed.
			goto('/onboarding?step=age');
		} catch (e) {
			console.error('Google sign-in error:', e);
			error = e instanceof Error ? e.message : 'Google sign-in failed. Please try again.';
		} finally {
			busy = false;
		}
	}

	async function handleApple() {
		busy = true;
		error = null;
		try {
			await signInWithApple();
			goto('/onboarding?step=age');
		} catch {
			error = 'Apple sign-in failed. Please try again.';
		} finally {
			busy = false;
		}
	}

	async function handleEmail(e: SubmitEvent) {
		e.preventDefault();
		if (!email) return;
		busy = true;
		error = null;
		try {
			await sendEmailLink(email);
			emailSent = true;
		} catch (err) {
			console.error('Email link send failed:', err);
			error = err instanceof Error ? err.message : 'Failed to send magic link. Please try again.';
		} finally {
			busy = false;
		}
	}
</script>

<main class="fixed inset-0 flex flex-col bg-surface overflow-hidden">
	{#if showAgeGate}
		<div class="flex-1 flex items-center justify-center px-8" in:fade={{ duration: 200 }}>
			<div class="w-full max-w-sm">
				<AgeGate onVerified={handleAgeVerified} />
				{#if error}
					<p class="text-error text-sm text-center mt-4">{error}</p>
				{/if}
			</div>
		</div>
	{:else}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex-1 flex flex-col overflow-hidden select-none"
			ontouchstart={handleTouchStart}
			ontouchend={handleTouchEnd}
		>
			{#key currentSlide}
				<div
					class="flex-1 flex flex-col"
					in:fly={{ x: 80, duration: PAGE_TRANSITION.duration }}
					out:fly={{ x: -80, duration: PAGE_TRANSITION.duration }}
				>
					<!-- Mockup area -->
					<div class="flex-1 flex items-end justify-center px-5 pt-8 pb-4 overflow-hidden">
						{#if currentSlide === 0}
							{@render slide0()}
						{:else if currentSlide === 1}
							{@render slide1()}
						{:else if currentSlide === 2}
							{@render slide2()}
						{:else}
							{@render slide3()}
						{/if}
					</div>

					<!-- Copy -->
					<div class="px-8 pt-5 pb-2 shrink-0">
						{#if currentSlide === 0}
							<h1 class="font-display text-[26px] font-semibold text-primary text-center leading-tight">Your shared space</h1>
							<p class="text-muted text-[15px] leading-relaxed text-center mt-2.5 max-w-[300px] mx-auto">A living board for your people — families, roommates, close friends. Everything in one place.</p>
						{:else if currentSlide === 1}
							<h1 class="font-display text-[26px] font-semibold text-primary text-center leading-tight">Clip anything</h1>
							<p class="text-muted text-[15px] leading-relaxed text-center mt-2.5 max-w-[300px] mx-auto">Notes, links, photos, voice memos, polls — paste a URL and it becomes a card.</p>
						{:else if currentSlide === 2}
							<h1 class="font-display text-[26px] font-semibold text-primary text-center leading-tight">Never miss a deal</h1>
							<p class="text-muted text-[15px] leading-relaxed text-center mt-2.5 max-w-[300px] mx-auto">Save products you love. We track prices daily and ping you when they drop.</p>
						{:else}
							<h1 class="font-display text-[26px] font-semibold text-primary text-center leading-tight">AI keeps you close</h1>
							<p class="text-muted text-[15px] leading-relaxed text-center mt-2.5 max-w-[300px] mx-auto">Wake up to a voice briefing about what your people have been up to.</p>
						{/if}
					</div>
				</div>
			{/key}

			<!-- Dots -->
			<div class="flex items-center justify-center gap-2 py-3 shrink-0">
				{#each Array(TOTAL_SLIDES) as _, i}
					<button
						class="h-2 rounded-full transition-all duration-300
							{i === currentSlide ? 'w-7 bg-accent' : 'w-2 bg-border'}"
						onclick={() => (currentSlide = i)}
						aria-label="Go to slide {i + 1}"
					></button>
				{/each}
			</div>
		</div>

		<!-- Bottom actions -->
		<div class="px-6 pb-8 pt-1 shrink-0">
			{#if !isLastSlide}
				<button
					onclick={nextSlide}
					class="w-full py-3.5 bg-accent text-white rounded-lg font-medium text-[16px]
						shadow-fab active:scale-[0.98] transition-transform"
				>
					Continue
				</button>
				<button
					onclick={() => (currentSlide = TOTAL_SLIDES - 1)}
					class="w-full py-2.5 text-muted text-sm text-center mt-1"
				>
					Skip
				</button>
			{:else}
				<div class="flex flex-col gap-3" in:fly={{ y: 16, duration: TRANSITION_FAST }}>
					<button
						onclick={handleGoogle}
						disabled={busy}
						class="w-full py-3.5 bg-card border border-border rounded-lg font-medium
							shadow-card flex items-center justify-center gap-3
							disabled:opacity-50 active:scale-[0.98] transition-transform"
					>
						<svg class="w-5 h-5" viewBox="0 0 24 24">
							<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
							<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
							<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
							<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
						</svg>
						Continue with Google
					</button>

					<button
						onclick={handleApple}
						disabled={busy}
						class="w-full py-3.5 bg-primary text-white rounded-lg font-medium
							flex items-center justify-center gap-3
							disabled:opacity-50 active:scale-[0.98] transition-transform"
					>
						<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
							<path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
						</svg>
						Continue with Apple
					</button>

					{#if pendingEmailLink}
						<!-- User arrived via email link, needs to confirm their email -->
						<form onsubmit={(e) => { e.preventDefault(); handleConfirmEmailLink(); }} class="flex flex-col gap-2">
							<p class="text-sm text-primary text-center mb-1">Confirm your email to complete sign-in</p>
							<input
								type="email"
								bind:value={confirmEmail}
								placeholder="your@email.com"
								required
								class="w-full py-3.5 px-4 border border-border rounded-lg text-sm
									bg-card placeholder:text-muted focus:outline-none focus:border-accent
									transition-colors"
							/>
							<button
								type="submit"
								disabled={busy}
								class="w-full py-3.5 bg-accent text-white rounded-lg font-medium text-sm
									disabled:opacity-50 active:scale-[0.98] transition-transform shadow-fab"
							>
								{busy ? 'Signing in...' : 'Complete sign-in'}
							</button>
						</form>
					{:else if !showEmailInput}
						<button
							onclick={() => (showEmailInput = true)}
							class="w-full py-2.5 text-muted text-sm text-center"
						>
							Use email instead
						</button>
					{:else if !emailSent}
						<form onsubmit={handleEmail} class="flex flex-col gap-2">
							<input
								type="email"
								bind:value={email}
								placeholder="your@email.com"
								required
								class="w-full py-3.5 px-4 border border-border rounded-lg text-sm
									bg-card placeholder:text-muted focus:outline-none focus:border-accent
									transition-colors"
							/>
							<button
								type="submit"
								disabled={busy}
								class="w-full py-3.5 bg-accent text-white rounded-lg font-medium text-sm
									disabled:opacity-50 active:scale-[0.98] transition-transform shadow-fab"
							>
								Send magic link
							</button>
						</form>
					{:else}
						<p class="text-success text-sm text-center py-2">
							Check your inbox for the magic link!
						</p>
					{/if}

					{#if error}
						<p class="text-error text-sm text-center">{error}</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</main>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 0: "Your shared space" — Board with cards in app style
     ═══════════════════════════════════════════════════════════════════════════ -->
{#snippet slide0()}
<div class="w-full max-w-[280px] mx-auto">
	<!-- Board header -->
	<div class="bg-card rounded-t-card border border-border border-b-0 px-4 py-3">
		<div class="flex items-center gap-2.5">
			<div class="flex-1 min-w-0">
				<h2 class="font-display text-sm font-semibold text-primary">Apartment 4B</h2>
				<div class="flex items-center gap-1.5 mt-1">
					<!-- Avatar stack -->
					<div class="flex -space-x-1.5">
						<div class="w-4 h-4 rounded-full bg-accent/20 border-[1.5px] border-card flex items-center justify-center">
							<span class="text-[6px] text-accent font-semibold">S</span>
						</div>
						<div class="w-4 h-4 rounded-full bg-success/20 border-[1.5px] border-card flex items-center justify-center">
							<span class="text-[6px] text-success font-semibold">M</span>
						</div>
						<div class="w-4 h-4 rounded-full bg-warning/20 border-[1.5px] border-card flex items-center justify-center">
							<span class="text-[6px] text-warning font-semibold">J</span>
						</div>
					</div>
					<span class="text-[9px] text-muted">3 members</span>
				</div>
			</div>
			<!-- Streak badge — matches StreakBadge.svelte -->
			<span class="inline-flex items-center gap-0.5 text-[9px] font-medium bg-streak-low-bg text-streak-low-text rounded-full px-2 py-0.5">
				<Icon icon="ph:flame-fill" class="text-[8px]" />
				12d
			</span>
		</div>
	</div>

	<!-- Card area — matches actual card styles -->
	<div class="bg-surface border-x border-border px-3 py-3 space-y-2.5">
		<!-- Living Summary — matches LivingSummaryCard -->
		<div class="bg-accent/5 border border-accent/20 rounded-card p-3">
			<div class="flex items-start gap-2">
				<Icon icon="ph:sparkle-fill" class="text-accent text-xs shrink-0 mt-0.5" />
				<p class="text-[8px] text-primary leading-[1.6]">Sarah added groceries for the week and Miguel found a deal on the coffee maker!</p>
			</div>
		</div>

		<!-- Note card — matches NoteCard -->
		<div class="bg-card rounded-card shadow-card p-3">
			<p class="text-[8px] text-primary leading-[1.5]">Remember to water the plants this weekend!</p>
			<div class="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">
				<div class="w-3.5 h-3.5 rounded-full bg-success/20 flex items-center justify-center">
					<span class="text-[5px] text-success font-semibold">S</span>
				</div>
				<span class="text-[7px] text-muted">Sarah</span>
				<span class="text-[7px] text-muted ml-auto">2h ago</span>
			</div>
		</div>

		<!-- Two column — photo + list -->
		<div class="flex gap-2">
			<!-- Photo card — matches PhotoCard -->
			<div class="bg-card rounded-card shadow-card overflow-hidden flex-1">
				<div class="h-16 bg-accent/10 flex items-center justify-center">
					<Icon icon="ph:image" class="text-accent/30 text-2xl" />
				</div>
				<div class="px-2.5 py-1.5">
					<div class="flex items-center gap-1">
						<div class="w-3 h-3 rounded-full bg-accent/20 flex items-center justify-center">
							<span class="text-[4px] text-accent font-semibold">M</span>
						</div>
						<span class="text-[6px] text-muted">Miguel</span>
					</div>
				</div>
			</div>

			<!-- List card — matches ListCard -->
			<div class="bg-card rounded-card shadow-card p-2.5 flex-1">
				<p class="text-[8px] font-medium text-primary mb-1.5">Groceries</p>
				<div class="space-y-1">
					<div class="flex items-center gap-1.5">
						<Icon icon="ph:check-square-fill" class="text-[8px] text-success" />
						<span class="text-[7px] text-muted line-through">Milk</span>
					</div>
					<div class="flex items-center gap-1.5">
						<Icon icon="ph:square" class="text-[8px] text-muted" />
						<span class="text-[7px] text-primary">Avocados</span>
					</div>
					<div class="flex items-center gap-1.5">
						<Icon icon="ph:square" class="text-[8px] text-muted" />
						<span class="text-[7px] text-primary">Bread</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Product card — matches ProductCard -->
		<div class="bg-card rounded-card shadow-card overflow-hidden">
			<div class="px-3 py-2">
				<p class="text-[8px] font-medium text-primary">Coffee Maker Pro</p>
				<div class="flex items-center justify-between mt-1.5">
					<div class="flex items-baseline gap-1">
						<span class="text-[10px] font-bold text-accent">$79.99</span>
						<span class="text-[7px] text-muted line-through">$129.99</span>
					</div>
					<span class="inline-flex items-center gap-0.5 text-[6px] text-success font-medium bg-success/10 rounded-full px-1.5 py-0.5">
						<Icon icon="ph:arrow-down-bold" class="text-[5px]" />
						Price drop
					</span>
				</div>
				<span class="text-[7px] text-muted bg-surface px-1.5 py-0.5 rounded-full mt-1.5 inline-block">amazon.com</span>
			</div>
		</div>
	</div>

	<!-- FAB — matches FAB.svelte -->
	<div class="relative bg-surface border-x border-b border-border rounded-b-card h-6">
		<div class="absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-10 bg-accent text-white rounded-full shadow-fab flex items-center justify-center">
			<Icon icon="ph:plus-bold" class="text-base" />
		</div>
	</div>
</div>
{/snippet}

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 1: "Clip anything" — Radial FAB + card examples
     ═══════════════════════════════════════════════════════════════════════════ -->
{#snippet slide1()}
<div class="w-full max-w-[300px] mx-auto flex flex-col items-center gap-5">
	<!-- Radial FAB menu -->
	<div class="relative w-56 h-56">
		<!-- Center FAB -->
		<div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 bg-accent text-white rounded-full shadow-fab flex items-center justify-center z-10">
			<Icon icon="ph:plus-bold" class="text-xl rotate-45" />
		</div>
		<!-- Orbiting items -->
		{@render fabOrb(-55, -60, 'ph:note-pencil-fill', 'Note', 'bg-accent/10 text-accent')}
		{@render fabOrb(55, -60, 'ph:link-bold', 'Link', 'bg-success/10 text-success')}
		{@render fabOrb(75, 12, 'ph:camera-fill', 'Photo', 'bg-type-photo/10 text-type-photo')}
		{@render fabOrb(40, 68, 'ph:microphone-fill', 'Voice', 'bg-type-voice/10 text-type-voice')}
		{@render fabOrb(-40, 68, 'ph:chart-bar-fill', 'Poll', 'bg-type-poll/10 text-type-poll')}
		{@render fabOrb(-75, 12, 'ph:map-pin-fill', 'Place', 'bg-type-location/10 text-type-location')}
	</div>

	<!-- Example cards -->
	<div class="w-full flex gap-3">
		<!-- Link auto-detected as product -->
		<div class="bg-card rounded-card shadow-card p-3 flex-1 border border-border">
			<div class="flex items-center gap-1.5 mb-2">
				<Icon icon="ph:link" class="text-[10px] text-muted" />
				<span class="text-[8px] text-muted">amazon.com</span>
			</div>
			<p class="text-[8px] font-medium text-primary leading-snug">Sony WH-1000XM5</p>
			<div class="flex items-center gap-1.5 mt-2">
				<span class="text-[10px] font-bold text-accent">$298</span>
				<span class="text-[6px] text-success bg-success/10 px-1.5 py-0.5 rounded-full font-medium">Auto-detected</span>
			</div>
		</div>

		<!-- Voice note — matches VoiceCard -->
		<div class="bg-card rounded-card shadow-card p-3 flex-1 border border-border">
			<div class="flex items-center gap-1.5 mb-2">
				<div class="w-5 h-5 rounded-full bg-accent/10 text-accent flex items-center justify-center">
					<Icon icon="ph:microphone-fill" class="text-[9px]" />
				</div>
				<span class="text-[8px] font-medium text-primary">Voice note</span>
			</div>
			<!-- Waveform bars -->
			<div class="flex items-end gap-[2px] h-4">
				{#each [3, 6, 4, 9, 5, 11, 7, 4, 10, 6, 3, 8, 5, 9, 4, 7, 10, 5, 3, 7] as h, i}
					<div
						class="flex-1 rounded-full bg-accent"
						style="height: {h * 1.3}px; opacity: {i < 12 ? 0.5 : 0.15}"
					></div>
				{/each}
			</div>
			<span class="text-[7px] text-muted mt-1 block">0:12 / 0:28</span>
		</div>
	</div>
</div>
{/snippet}

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 2: "Never miss a deal" — Product card + price chart + notification
     ═══════════════════════════════════════════════════════════════════════════ -->
{#snippet slide2()}
<div class="w-full max-w-[270px] mx-auto flex flex-col items-center gap-4">
	<!-- Product card — extended version -->
	<div class="w-full bg-card rounded-card shadow-card overflow-hidden border border-border">
		<!-- Product image placeholder -->
		<div class="h-28 bg-accent/5 flex items-center justify-center relative">
			<Icon icon="ph:headphones" class="text-accent/20 text-5xl" />
			<!-- Discount badge -->
			<div class="absolute top-2.5 right-2.5 bg-card rounded-full px-2.5 py-1 shadow-card border border-border">
				<span class="text-[10px] font-bold text-error">-38%</span>
			</div>
		</div>
		<div class="p-4">
			<h3 class="font-medium text-primary text-sm leading-snug">Sony WH-1000XM5</h3>
			<p class="text-[10px] text-muted mt-0.5">Noise Cancelling Headphones</p>
			<div class="flex items-center justify-between mt-3">
				<div class="flex items-baseline gap-2">
					<span class="text-xl font-bold text-accent">$248</span>
					<span class="text-xs text-muted line-through">$399.99</span>
				</div>
				<Icon icon="ph:arrows-clockwise" class="text-muted text-lg" />
			</div>
			<span class="text-[10px] text-muted bg-surface px-2 py-0.5 rounded-full mt-2 inline-block uppercase tracking-wider">amazon.com</span>

			<!-- Price history -->
			<div class="mt-3 pt-3 border-t border-border">
				<p class="text-[8px] text-muted uppercase tracking-wider font-medium mb-2">Price history</p>
				<div class="flex items-end gap-[3px] h-8">
					{#each [70, 72, 68, 75, 72, 78, 80, 85, 95, 88, 82, 40] as pct, i}
						<div
							class="flex-1 rounded-sm transition-all {i === 11 ? 'bg-success' : 'bg-accent/15'}"
							style="height: {pct}%;"
						></div>
					{/each}
				</div>
				<div class="flex justify-between mt-1">
					<span class="text-[7px] text-muted">30d ago</span>
					<span class="text-[7px] text-success font-medium">Now</span>
				</div>
			</div>
		</div>
	</div>

	<!-- Push notification -->
	<div class="w-full bg-card rounded-card shadow-card border border-border p-3.5 flex items-center gap-3 ob-slide-up">
		<div class="w-9 h-9 rounded-card bg-accent/10 flex items-center justify-center shrink-0">
			<Icon icon="ph:sparkle-fill" class="text-accent text-sm" />
		</div>
		<div class="flex-1 min-w-0">
			<p class="text-[10px] font-medium text-primary">Price Drop!</p>
			<p class="text-[8px] text-muted leading-snug mt-0.5">Sony headphones dropped to $248</p>
		</div>
		<span class="text-[8px] text-muted shrink-0">now</span>
	</div>
</div>
{/snippet}

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 3: "AI keeps you close" — Briefing + Living Summary + Reminder
     ═══════════════════════════════════════════════════════════════════════════ -->
{#snippet slide3()}
<div class="w-full max-w-[280px] mx-auto flex flex-col items-center gap-3">
	<!-- Morning briefing — matches BriefingCard -->
	<div class="w-full border border-accent/20 bg-accent/5 rounded-card overflow-hidden">
		<div class="bg-accent/10 px-4 py-2.5 border-b border-accent/10">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<Icon icon="ph:sparkle-fill" class="text-accent text-sm" />
					<span class="text-[11px] font-semibold text-primary">Good morning</span>
				</div>
				<span class="text-[9px] text-muted">8:00 AM</span>
			</div>
		</div>
		<div class="p-4">
			<p class="text-[10px] text-primary leading-relaxed">
				Sarah added the grocery list — don't forget the avocados! Miguel found a deal on the coffee maker. It dropped to <span class="font-semibold text-accent">$79.99</span> overnight.
			</p>
			<!-- Audio player — matches BriefingCard -->
			<div class="flex items-center gap-2 mt-3 bg-accent/5 border border-accent/10 rounded-lg p-2.5">
				<button class="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center shrink-0">
					<Icon icon="ph:play-fill" class="text-[10px]" />
				</button>
				<div class="flex-1 flex items-end gap-[2px] h-3.5">
					{#each [2, 5, 3, 7, 4, 9, 6, 3, 8, 5, 2, 7, 4, 8, 3, 5, 9, 4, 2, 6, 5, 8, 3, 4] as h}
						<div class="flex-1 rounded-full bg-accent/30" style="height: {h * 1.2}px;"></div>
					{/each}
				</div>
				<span class="text-[8px] text-muted shrink-0">0:32</span>
			</div>
		</div>
	</div>

	<!-- Living Summary — matches LivingSummaryCard -->
	<div class="w-full bg-accent/5 border border-accent/20 rounded-card p-3.5">
		<div class="flex items-center gap-2 mb-2">
			<Icon icon="ph:sparkle-fill" class="text-accent text-xs" />
			<span class="font-display text-[10px] font-semibold text-primary">Current State</span>
			<span class="text-[8px] text-muted ml-auto uppercase tracking-wider">Auto-updated</span>
		</div>
		<p class="text-[8px] text-primary/80 leading-relaxed">
			The board is focused on getting organized for the week. Sarah handles groceries, Miguel tracks deals on kitchen gear.
		</p>
	</div>

	<!-- Smart reminder — notification style -->
	<div class="w-full bg-card rounded-card shadow-card border border-border p-3 flex items-center gap-2.5">
		<div class="w-8 h-8 rounded-full bg-warning/10 text-warning flex items-center justify-center shrink-0">
			<Icon icon="ph:bell-ringing-fill" class="text-sm" />
		</div>
		<div class="flex-1 min-w-0">
			<p class="text-[10px] font-medium text-primary">Smart Reminder</p>
			<p class="text-[8px] text-muted">Coffee maker deal expires tomorrow!</p>
		</div>
	</div>
</div>
{/snippet}

<!-- Helper: FAB orbiting item -->
{#snippet fabOrb(x: number, y: number, icon: string, label: string, classes: string)}
	<div
		class="absolute left-1/2 top-1/2 flex flex-col items-center gap-1"
		style="transform: translate(calc(-50% + {x}px), calc(-50% + {y}px));"
	>
		<div class="w-11 h-11 rounded-full {classes} shadow-card border border-border flex items-center justify-center">
			<Icon {icon} class="text-base" />
		</div>
		<span class="text-[8px] font-medium text-primary">{label}</span>
	</div>
{/snippet}

<style>
	.ob-slide-up {
		animation: slideUp 0.5s ease-out;
	}
	@keyframes slideUp {
		from { transform: translateY(16px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}
</style>
