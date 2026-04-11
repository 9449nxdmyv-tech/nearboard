<!--
  @file InstallBanner.svelte
  @description PWA install prompt for mobile browsers. Captures beforeinstallprompt
               on Android/Chrome, shows manual instructions on iOS Safari.
               Dismisses permanently via localStorage. Only shown on mobile, never
               in standalone mode or Capacitor.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import Icon from '@iconify/svelte';
	import { Capacitor } from '@capacitor/core';

	const DISMISS_KEY = 'nearboard_install_dismissed';
	const DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

	let visible = $state(false);
	let deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
	let isIOS = $state(false);
	let showIOSGuide = $state(false);

	interface BeforeInstallPromptEvent extends Event {
		prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}

	function isDismissed(): boolean {
		if (!browser) return true;
		const raw = localStorage.getItem(DISMISS_KEY);
		if (!raw) return false;
		const ts = parseInt(raw, 10);
		if (Date.now() - ts < DISMISS_DURATION_MS) return true;
		localStorage.removeItem(DISMISS_KEY);
		return false;
	}

	function dismiss() {
		localStorage.setItem(DISMISS_KEY, String(Date.now()));
		visible = false;
	}

	async function install() {
		if (!deferredPrompt) return;
		const result = await deferredPrompt.prompt();
		if (result.outcome === 'accepted') {
			dismiss();
		}
		deferredPrompt = null;
	}

	onMount(() => {
		// Never show in standalone, Capacitor, or desktop
		if (Capacitor.isNativePlatform()) return;
		const isStandalone = window.matchMedia('(display-mode: standalone)').matches
			|| ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone);
		if (isStandalone) return;
		if (isDismissed()) return;

		const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
		if (!isMobile) return;

		isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

		if (isIOS) {
			// iOS doesn't fire beforeinstallprompt — show after short delay
			const timeout = setTimeout(() => { visible = true; }, 2000);
			return () => clearTimeout(timeout);
		}

		// Android/Chrome: listen for the browser's install prompt
		const handler = (e: Event) => {
			e.preventDefault();
			deferredPrompt = e as BeforeInstallPromptEvent;
			visible = true;
		};
		window.addEventListener('beforeinstallprompt', handler);
		return () => window.removeEventListener('beforeinstallprompt', handler);
	});
</script>

{#if visible}
	<div
		class="fixed bottom-24 inset-x-0 z-30 flex justify-center px-4"
		in:fly={{ y: 60, duration: 350 }}
		out:fly={{ y: 60, duration: 200 }}
	>
		<div class="w-full max-w-sm bg-card rounded-card shadow-lg border border-border/50 overflow-hidden">
			{#if !showIOSGuide}
				<!-- Main prompt -->
				<div class="flex items-center gap-3 p-4" in:fade={{ duration: 150 }}>
					<div class="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
						<Icon icon="ph:device-mobile" class="text-xl text-on-surface" />
					</div>
					<div class="flex-1 min-w-0">
						<p class="text-sm font-medium text-primary">Get the Nearboard app</p>
						<p class="text-xs text-muted mt-0.5">Add to your home screen for the full experience</p>
					</div>
					<button
						onclick={dismiss}
						class="p-1 text-muted hover:text-primary transition-colors shrink-0"
						aria-label="Dismiss"
					>
						<Icon icon="ph:x" class="text-base" />
					</button>
				</div>

				<div class="flex border-t border-border">
					{#if isIOS}
						<button
							onclick={() => { showIOSGuide = true; }}
							class="flex-1 py-2.5 text-xs font-medium text-accent hover:bg-accent/5 transition-colors text-center"
						>
							Show me how
						</button>
					{:else}
						<button
							onclick={install}
							class="flex-1 py-2.5 text-xs font-medium text-white bg-accent hover:bg-accent/90 transition-colors text-center"
						>
							Install
						</button>
					{/if}
				</div>
			{:else}
				<!-- iOS instructions -->
				<div class="p-4" in:fade={{ duration: 150 }}>
					<div class="flex items-center justify-between mb-3">
						<p class="text-sm font-medium text-primary">Add to Home Screen</p>
						<button
							onclick={dismiss}
							class="p-1 text-muted hover:text-primary transition-colors"
							aria-label="Dismiss"
						>
							<Icon icon="ph:x" class="text-base" />
						</button>
					</div>

					<ol class="space-y-2.5 text-xs text-muted">
						<li class="flex items-center gap-2.5">
							<span class="w-5 h-5 rounded-full bg-accent/10 text-accent text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
							<span>Tap <Icon icon="ph:share-network" class="inline text-sm text-on-surface align-text-bottom" /> in the toolbar</span>
						</li>
						<li class="flex items-center gap-2.5">
							<span class="w-5 h-5 rounded-full bg-accent/10 text-accent text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
							<span>Scroll down and tap <strong class="text-primary">Add to Home Screen</strong></span>
						</li>
						<li class="flex items-center gap-2.5">
							<span class="w-5 h-5 rounded-full bg-accent/10 text-accent text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
							<span>Tap <strong class="text-primary">Add</strong> to confirm</span>
						</li>
					</ol>
				</div>

				<div class="flex border-t border-border">
					<button
						onclick={() => { showIOSGuide = false; }}
						class="flex-1 py-2.5 text-xs text-muted hover:bg-surface transition-colors text-center"
					>
						Back
					</button>
					<div class="w-px bg-border"></div>
					<button
						onclick={dismiss}
						class="flex-1 py-2.5 text-xs font-medium text-accent hover:bg-accent/5 transition-colors text-center"
					>
						Got it
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
