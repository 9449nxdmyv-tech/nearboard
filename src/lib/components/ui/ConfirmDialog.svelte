<!--
  @file ConfirmDialog.svelte
  @description Reusable confirmation modal using Konsta UI Dialog + DialogButton.
-->
<script lang="ts">
	import { hapticWarning } from '$lib/utils/haptics';
	import { Dialog, DialogButton } from 'konsta/svelte';

	let {
		title,
		message,
		confirmLabel = 'Delete',
		onConfirm,
		onCancel
	}: {
		title: string;
		message: string;
		confirmLabel?: string;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

{#snippet titleSnippet()}
	{title}
{/snippet}

{#snippet contentSnippet()}
	<p class="text-sm text-muted">{message}</p>
{/snippet}

{#snippet buttonsSnippet()}
	<DialogButton onClick={onCancel}>Cancel</DialogButton>
	<DialogButton
		strong
		onClick={() => {
			hapticWarning();
			onConfirm();
		}}
		class="!text-error"
	>
		{confirmLabel}
	</DialogButton>
{/snippet}

<Dialog
	opened={true}
	backdrop={true}
	onBackdropClick={onCancel}
	title={titleSnippet}
	content={contentSnippet}
	buttons={buttonsSnippet}
/>
