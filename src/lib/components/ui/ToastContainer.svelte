<!--
  @file ToastContainer.svelte
  @description Enhanced global toast notification display with better animations,
               positioning support, and type-based styling. Sonner-style design.
-->
<script lang="ts">
	import { fly, slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Icon from '@iconify/svelte';
	import { toastStore, dismissToast, type Toast } from '$lib/stores/toastStore';

	const iconMap: Record<Toast['type'], string> = {
		success: 'ph:check-circle',
		error: 'ph:warning-circle',
		info: 'ph:info',
		warning: 'ph:warning',
		loading: 'ph:circle-notch'
	};

	const colorClasses: Record<Toast['type'], string> = {
		success: 'bg-success text-white',
		error: 'bg-error text-white',
		info: 'bg-accent text-white',
		warning: 'bg-[color:var(--color-toast-warning-bg)] text-[color:var(--color-toast-warning-text)]',
		loading: 'bg-primary text-white'
	};

	const positionClasses: Record<string, string> = {
		'top-center': 'top-4 inset-x-0 flex-col items-center',
		'top-right': 'top-4 right-4 items-end',
		'bottom-center': 'bottom-4 inset-x-0 flex-col items-center',
		'bottom-right': 'bottom-4 right-4 items-end'
	};

	// Group toasts by position
	const toastsByPosition = $derived.by(() => {
		const grouped: Record<string, Toast[]> = {};
		for (const toast of $toastStore) {
			const pos = toast.position || 'top-center';
			if (!grouped[pos]) grouped[pos] = [];
			grouped[pos].push(toast);
		}
		return grouped;
	});
</script>

{#if $toastStore.length > 0}
	{#each Object.entries(toastsByPosition) as [position, toasts]}
		<div
			class="fixed z-[100] flex flex-col gap-2 px-4 pointer-events-none md:max-w-sm"
			class:items-center={position === 'top-center' || position === 'bottom-center'}
			class:items-end={position === 'top-right' || position === 'bottom-right'}
			style={position === 'top-center' || position === 'top-right' ? 'top: 1rem;' : 'bottom: 1rem;'}
			style:right={position === 'top-right' || position === 'bottom-right' ? '1rem' : undefined}
		>
			{#each toasts as toast (toast.id)}
				<div
					class="pointer-events-auto w-full md:w-auto max-w-sm rounded-xl shadow-lg overflow-hidden
						{colorClasses[toast.type]}
						transition-all duration-300 hover:shadow-xl"
					in:fly={{ y: position.includes('top') ? -20 : 20, duration: 250, easing: quintOut }}
					out:slide={{ axis: 'y', duration: 200 }}
					role="alert"
				>
					<div class="flex items-start gap-3 p-4">
						<!-- Icon -->
						<div class="shrink-0 mt-0.5">
							<Icon
								icon={iconMap[toast.type]}
								class="text-lg {toast.type === 'loading' ? 'animate-spin' : ''}"
							/>
						</div>

						<!-- Content -->
						<div class="flex-1 min-w-0">
							<p class="font-semibold text-[15px] leading-tight">{toast.message}</p>
							{#if toast.description}
								<p class="text-sm opacity-90 mt-1 leading-relaxed">{toast.description}</p>
							{/if}

							<!-- Action button -->
							{#if toast.action}
								<button
									onclick={() => {
										toast.action?.onClick();
										dismissToast(toast.id);
									}}
									class="mt-2 px-3 py-1.5 rounded-lg bg-white/20 text-sm font-medium
										hover:bg-white/30 transition-colors"
								>
									{toast.action.label}
								</button>
							{/if}
						</div>

						<!-- Close button -->
						{#if toast.dismissible}
							<button
								onclick={() => dismissToast(toast.id)}
								class="shrink-0 -mr-1 p-1 rounded-lg hover:bg-white/20 transition-colors"
								aria-label="Dismiss"
							>
								<Icon icon="ph:x-bold" class="text-base" />
							</button>
						{/if}
					</div>

					<!-- Progress bar for auto-dismiss -->
					{#if toast.duration && toast.duration > 0 && toast.dismissible}
						<div class="h-0.5 bg-white/20 overflow-hidden">
							<div
								class="h-full bg-white/50 rounded-full"
								style="width: 100%; animation: toast-progress {toast.duration}ms linear forwards;"
							></div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/each}
{/if}

<style>
	@keyframes toast-progress {
		from {
			width: 100%;
		}
		to {
			width: 0%;
		}
	}
</style>
