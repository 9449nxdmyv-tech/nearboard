<!--
  @file OfflineBanner.svelte
  @description Native-style offline detection banner. Shows when connection is lost,
               auto-dismisses when reconnected. Non-intrusive but clearly visible.
-->
<script lang="ts">
	import { fly, slide } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	import { hapticWarning } from '$lib/utils/haptics';

	let isOnline = $state(true);
	let showBanner = $state(false);
	let isReconnecting = $state(false);

	onMount(() => {
		// Initial check
		isOnline = navigator.onLine;

		let dismissTimeout: ReturnType<typeof setTimeout> | undefined;
		let checking = false;

		const handleOffline = () => {
			isOnline = false;
			showBanner = true;
			isReconnecting = false;
			if (dismissTimeout) { clearTimeout(dismissTimeout); dismissTimeout = undefined; }
			hapticWarning();
		};

		const handleOnline = async () => {
			if (checking) return;
			checking = true;
			isReconnecting = true;

			try {
				await fetch('/api/health', { method: 'HEAD', cache: 'no-cache' });
				// If we went offline again while the fetch was in flight, bail out.
				if (!navigator.onLine) {
					isReconnecting = false;
					return;
				}
				isOnline = true;
				if (dismissTimeout) clearTimeout(dismissTimeout);
				dismissTimeout = setTimeout(() => {
					showBanner = false;
					isReconnecting = false;
					dismissTimeout = undefined;
				}, 1500);
			} catch {
				isReconnecting = false;
			} finally {
				checking = false;
			}
		};

		window.addEventListener('offline', handleOffline);
		window.addEventListener('online', handleOnline);

		// Periodic reconnection check when offline
		const checkInterval = setInterval(() => {
			if (!isOnline && navigator.onLine) {
				handleOnline();
			}
		}, 5000);

		return () => {
			window.removeEventListener('offline', handleOffline);
			window.removeEventListener('online', handleOnline);
			clearInterval(checkInterval);
			if (dismissTimeout) clearTimeout(dismissTimeout);
		};
	});
</script>

{#if showBanner}
	<div
		class="fixed top-0 left-0 right-0 z-[100] px-4 pt-safe"
		in:fly={{ y: -20, duration: 250 }}
		out:slide={{ duration: 200 }}
	>
		<div
			class="mx-auto max-w-2xl rounded-xl overflow-hidden shadow-lg border
				{isReconnecting
					? 'bg-[color:var(--color-status-reconnecting-bg)] border-[color:var(--color-status-reconnecting-border)]'
					: 'bg-[color:var(--color-status-offline-bg)] border-[color:var(--color-status-offline-border)]'}"
		>
			<div class="flex items-center gap-3 px-4 py-3">
				<!-- Icon -->
				<div
					class="w-8 h-8 rounded-full flex items-center justify-center shrink-0
						{isReconnecting
							? 'bg-[color:var(--color-status-reconnecting-icon-bg)] text-[color:var(--color-status-reconnecting-text)]'
							: 'bg-[color:var(--color-status-offline-icon-bg)] text-[color:var(--color-status-offline-text)]'}"
				>
					{#if isReconnecting}
						<Icon icon="ph:arrows-clockwise" class="text-sm animate-spin" />
					{:else}
						<Icon icon="ph:wifi-slash" class="text-sm" />
					{/if}
				</div>

				<!-- Message -->
				<div class="flex-1 min-w-0">
					<p
						class="text-sm font-semibold
							{isReconnecting ? 'text-[color:var(--color-status-reconnecting-text-strong)]' : 'text-[color:var(--color-status-offline-text)]'}"
					>
						{isReconnecting ? 'Reconnecting…' : 'No internet connection'}
					</p>
					{#if !isReconnecting}
						<p class="text-xs text-[color:var(--color-status-offline-text-dim)] mt-0.5">
							Your changes will sync when you're back online
						</p>
					{/if}
				</div>

				<!-- Status indicator -->
				{#if isReconnecting}
					<div class="flex items-center gap-1 text-[color:var(--color-status-reconnecting-text)]">
						<div class="w-2 h-2 rounded-full bg-[color:var(--color-status-online-pulse)] animate-pulse"></div>
					</div>
				{/if}
			</div>

			<!-- Progress bar for reconnection -->
			{#if isReconnecting}
				<div class="h-0.5 bg-[color:var(--color-status-reconnecting-progress-track)] overflow-hidden">
					<div class="h-full bg-[color:var(--color-status-reconnecting-progress-bar)] rounded-full animate-progress"></div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	@keyframes progress {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(100%); }
	}
	.animate-progress {
		animation: progress 1.5s ease-in-out infinite;
	}
</style>
