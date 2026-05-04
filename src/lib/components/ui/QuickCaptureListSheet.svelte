<!--
  @file QuickCaptureListSheet.svelte
  @description Fullscreen sheet for creating a new checklist.
               Uses Konsta UI List/ListInput for native iOS form styling.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { Navbar, NavbarBackLink, Link, List, ListInput, ListItem, Button, BlockTitle } from 'konsta/svelte';
	import { addContent } from '$lib/firebase';
	import { userStore, showToast } from '$lib/stores';
	import { hapticSuccess, hapticLight } from '$lib/utils/haptics';
	import QuickCaptureShell from './QuickCaptureShell.svelte';
	import SubmitButton from './SubmitButton.svelte';
	import type { ListContentDoc } from '$lib/types';

	let {
		boardId,
		onClose
	}: {
		boardId: string;
		onClose: (posted?: boolean) => void;
	} = $props();

	let busy = $state(false);
	let listTitle = $state('');
	let listItemText = $state('');
	let listItems = $state<{ id: string; text: string; completed: boolean }[]>([]);

	function addListItem() {
		if (!listItemText.trim()) return;
		listItems = [...listItems, { id: crypto.randomUUID(), text: listItemText.trim(), completed: false }];
		listItemText = '';
		hapticLight();
	}

	function removeItem(index: number) {
		listItems = listItems.filter((_, i) => i !== index);
	}

	async function submitList() {
		const user = $userStore.user;
		if (!user || !listTitle.trim() || listItems.length === 0) return;
		busy = true;
		try {
			await addContent(boardId, {
				type: 'list', title: listTitle.trim(), items: listItems,
				boardId, authorId: user.uid, authorName: user.displayName || user.email, authorPhotoURL: user.photoURL
			} as Omit<ListContentDoc, 'id' | 'createdAt'>);
			hapticSuccess();
			showToast('List saved!', 'success');
			onClose(true);
		} catch { showToast('Failed to save list'); }
		finally { busy = false; }
	}

	const canSubmit = $derived(!busy && listTitle.trim().length > 0 && listItems.length > 0);
</script>

{#snippet navLeft()}
	<NavbarBackLink onClick={onClose} text="Close" />
{/snippet}

{#snippet navRight()}
	{#if canSubmit}
		<Link onClick={submitList}>
			{#if busy}
				<Icon icon="ph:circle-notch-bold" class="text-lg animate-spin" />
			{:else}
				Save
			{/if}
		</Link>
	{/if}
{/snippet}

<QuickCaptureShell {onClose}>
	<Navbar title="New List" left={navLeft} right={navRight} />

		<div class="flex-1 overflow-y-auto">
			<!-- Title input -->
			<List inset strong outline>
				<ListInput
					outline
					label="Title"
					type="text"
					placeholder="List title"
					value={listTitle}
					onInput={(e) => { listTitle = e.target.value; }}
					clearButton={listTitle.length > 0}
					onClear={() => { listTitle = ''; }}
				/>
			</List>

			<!-- Existing items -->
			{#if listItems.length > 0}
				<BlockTitle>Items ({listItems.length})</BlockTitle>
				<List inset strong dividers>
					{#each listItems as item, i (item.id)}
						<ListItem title={item.text}>
							{#snippet media()}
								<Icon icon="ph:check-circle" class="text-lg text-success" />
							{/snippet}
							{#snippet after()}
								<button onclick={() => removeItem(i)} class="p-1.5 -mr-1 text-muted active:text-error transition-colors" aria-label="Remove">
									<Icon icon="ph:x-circle" class="text-base" />
								</button>
							{/snippet}
						</ListItem>
					{/each}
				</List>
			{/if}

			<!-- Add item input -->
			<BlockTitle>Add Item</BlockTitle>
			<form onsubmit={(e) => { e.preventDefault(); addListItem(); }}>
				<List inset strong outline>
					<ListInput
						outline
						label="New item"
						type="text"
						placeholder="Type item text..."
						value={listItemText}
						onInput={(e) => { listItemText = e.target.value; }}
					/>
				</List>
				<div class="flex justify-end px-8 -mt-2">
					<Button small clear rounded onClick={addListItem} disabled={!listItemText.trim()}>
						<Icon icon="ph:plus-circle" class="mr-1.5" />
						Add
					</Button>
				</div>
			</form>
		</div>

	<!-- Save footer -->
	<div class="p-4 pb-safe border-t border-border-light">
		<SubmitButton {busy} disabled={!canSubmit} onClick={submitList}>
			Save List
		</SubmitButton>
	</div>
</QuickCaptureShell>
