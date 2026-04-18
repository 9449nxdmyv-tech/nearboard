<!--
  @file KeyboardShortcutsHelp.svelte
  @description Modal showing all available keyboard shortcuts.
               Triggered by pressing '?' key.
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { getShortcutsByCategory, formatShortcut } from '$lib/utils/keyboardShortcuts';
	import { onMount } from 'svelte';

	let open = $state(false);

	onMount(() => {
		const handleShow = () => (open = true);
		const handleEscape = () => (open = false);

		document.addEventListener('show-shortcuts-help', handleShow);
		document.addEventListener('keyboard-escape', handleEscape);

		return () => {
			document.removeEventListener('show-shortcuts-help', handleShow);
			document.removeEventListener('keyboard-escape', handleEscape);
		};
	});

	const shortcuts = $derived(getShortcutsByCategory());
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
		onclick={() => (open = false)}
		transition:fade={{ duration: 150 }}
	>
		<!-- Modal -->
		<div
			class="bg-card rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
			transition:fly={{ y: 20, duration: 250 }}
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Header -->
			<div class="flex items-center justify-between px-5 py-4 border-b border-border/50">
				<h2 class="font-display text-lg font-semibold text-primary">Keyboard Shortcuts</h2>
				<button
					onclick={() => (open = false)}
					aria-label="Close shortcuts help"
					class="w-8 h-8 rounded-full flex items-center justify-center text-muted/60 hover:text-primary hover:bg-surface transition-colors"
				>
					<Icon icon="ph:x-bold" class="text-base" />
				</button>
			</div>

			<!-- Content -->
			<div class="p-5 max-h-[70vh] overflow-y-auto">
				{#each Object.entries(shortcuts) as [category, items]}
					<div class="mb-5 last:mb-0">
						<h3 class="text-[10px] font-bold text-muted uppercase tracking-widest mb-2.5">
							{category}
						</h3>
						<div class="flex flex-col gap-2">
							{#each items as shortcut}
								<div class="flex items-center justify-between gap-3">
									<span class="text-sm text-primary/80">{shortcut.description}</span>
									<div class="flex items-center gap-1">
										{#each shortcut.keys as key, i}
											{#if i > 0}
												<span class="text-muted/40 text-xs">+</span>
											{/if}
											<kbd
												class="px-2 py-1.5 bg-surface border border-border/60 rounded-md
													text-xs font-mono text-primary font-medium min-w-[28px] text-center
													shadow-sm shadow-black/5"
											>
												{key === ' ' ? 'Space' : key.toUpperCase()}
											</kbd>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>

			<!-- Footer -->
			<div class="px-5 py-3 bg-surface/50 border-t border-border/50">
				<p class="text-xs text-muted/60 text-center">
					Press <kbd class="px-1.5 py-0.5 bg-card border border-border/60 rounded text-[10px] font-mono">?</kbd> to reopen this help
				</p>
			</div>
		</div>
	</div>
{/if}
