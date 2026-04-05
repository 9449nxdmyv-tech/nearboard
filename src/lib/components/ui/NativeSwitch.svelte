<!--
  @file NativeSwitch.svelte
  @description Toggle switch with iOS-native styling using Konsta UI Toggle.
-->
<script lang="ts">
	import { Toggle, Preloader } from 'konsta/svelte';
	import { hapticLight } from '$lib/utils/haptics';

	let {
		checked = $bindable(false),
		label,
		disabled = false,
		loading = false,
		class: className = '',
		onchange
	}: {
		checked?: boolean;
		label?: string;
		disabled?: boolean;
		loading?: boolean;
		class?: string;
		onchange?: () => void | Promise<void>;
	} = $props();

	async function handleChange() {
		if (disabled || loading) return;
		hapticLight();
		checked = !checked;
		if (onchange) await onchange();
	}
</script>

<div class="flex items-center justify-between w-full {className}" class:opacity-50={disabled || loading}>
	{#if label}
		<span class="text-sm font-medium text-on-surface">{label}</span>
	{/if}

	{#if loading}
		<Preloader />
	{:else}
		<Toggle
			checked={checked}
			disabled={disabled}
			onChange={handleChange}
		/>
	{/if}
</div>
