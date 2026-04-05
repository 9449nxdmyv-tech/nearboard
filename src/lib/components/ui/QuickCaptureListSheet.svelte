<!--
  @file QuickCaptureListSheet.svelte
  @description Fullscreen sheet for creating a new checklist.
               Uses Konsta UI List/ListInput for native iOS form styling.
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Icon from '@iconify/svelte';
	import { Navbar, NavbarBackLink, Link, List, ListInput, ListItem, Button, BlockTitle } from 'konsta/svelte';
	import { addContent } from '$lib/firebase';
	import { userStore, showToast } from '$lib/stores';
	import { hapticSuccess, hapticLight } from '$lib/utils/haptics';
	import type { ListContentDoc } from '$lib/types';

	let {
		boardId,
		onClose
	}: {
		boardId: string;
		onClose: () => void;
	} = $props();

	// ─── Body scroll lock ────────────────────────────────────────────────
	$effect(() => {
		const scrollY = window.scrollY;
		document.body.style.overflow = 'hidden';
		document.body.style.position = 'fixed';
		document.body.style.top = `-${scrollY}px`;
		document.body.style.width = '100%';
		return () => {
			document.body.style.overflow = '';
			document.body.style.position = '';
			document.body.style.top = '';
			document.body.style.width = '';
			window.scrollTo(0, scrollY);
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

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
			showToast('List saved!');
			onClose();
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

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-[60] flex items-stretch sm:items-center sm:justify-center"
	transition:fade={{ duration: 200 }}
>
	<div class="fixed inset-0 bg-black/40 sm:bg-black/60 sm:backdrop-blur-md" aria-hidden="true" onclick={onClose}></div>

	<div
		class="relative z-10 w-full h-full sm:h-auto sm:max-w-xl sm:max-h-[85vh] sm:rounded-2xl sm:shadow-2xl
			bg-surface flex flex-col overflow-hidden"
		in:fly={{ y: 40, duration: 300, easing: quintOut }}
		onclick={(e) => e.stopPropagation()}
	>
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
			<Button large rounded onClick={submitList} disabled={!canSubmit}>
				{#if busy}
					<Icon icon="ph:circle-notch-bold" class="mr-2 animate-spin" />
					Saving...
				{:else}
					Save List
				{/if}
			</Button>
		</div>
	</div>
</div>

<style>
	.pb-safe {
		padding-bottom: max(env(safe-area-inset-bottom, 0px), 1rem);
	}
</style>
