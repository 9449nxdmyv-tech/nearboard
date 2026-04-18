<!--
  @file SubmitButton.svelte
  @description Konsta Button wrapped with a loading-spinner busy state.
               Replaces the repeated `{#if busy} spinner + label {:else} label {/if}`
               pattern across QuickCapture sheets and other save forms.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { Button } from 'konsta/svelte';
	import type { Snippet } from 'svelte';

	type Props = {
		busy?: boolean;
		disabled?: boolean;
		busyLabel?: string;
		onClick?: () => void;
		large?: boolean;
		rounded?: boolean;
		outline?: boolean;
		children: Snippet;
	};

	let {
		busy = false,
		disabled = false,
		busyLabel = 'Saving...',
		onClick,
		large = true,
		rounded = true,
		outline = false,
		children
	}: Props = $props();
</script>

<Button {large} {rounded} {outline} {onClick} disabled={disabled || busy}>
	{#if busy}
		<Icon icon="ph:circle-notch-bold" class="mr-2 animate-spin" />
		{busyLabel}
	{:else}
		{@render children()}
	{/if}
</Button>
