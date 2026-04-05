<!--
  @file NativeSelect.svelte
  @description Select component with iOS-native styling.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';

	let {
		label,
		value = $bindable(''),
		options = [],
		placeholder = 'Select an option',
		error,
		hint,
		disabled = false,
		required = false,
		class: className = ''
	}: {
		label?: string;
		value?: string;
		options?: Array<{ value: string; label: string; icon?: string }>;
		placeholder?: string;
		error?: string;
		hint?: string;
		disabled?: boolean;
		required?: boolean;
		class?: string;
	} = $props();
</script>

<div class="w-full {className}">
	{#if label}
		<label class="block mb-1.5">
			<span class="text-sm font-medium text-on-surface">
				{label}
				{#if required}
					<span class="text-error">*</span>
				{/if}
			</span>
		</label>
	{/if}

	<div class="relative">
		<select
			bind:value
			disabled={disabled}
			class="w-full h-11 px-3 rounded-lg border bg-surface text-on-surface
				{error ? 'border-error' : 'border-border'}
				focus:border-accent focus:outline-none
				transition-all duration-200
				appearance-none cursor-pointer
				disabled:opacity-50"
		>
			<option value="" disabled>{placeholder}</option>
			{#each options as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>

		<div class="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
			<Icon icon="ph:caret-down" class="text-lg" />
		</div>
	</div>

	{#if error}
		<p class="mt-1 text-xs text-error">{error}</p>
	{:else if hint}
		<p class="mt-1 text-xs text-muted">{hint}</p>
	{/if}
</div>
