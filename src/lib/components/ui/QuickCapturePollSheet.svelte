<!--
  @file QuickCapturePollSheet.svelte
  @description Fullscreen sheet for creating a poll.
               Uses Konsta UI List/ListItem/ListInput for native iOS form styling.
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Icon from '@iconify/svelte';
	import { Navbar, NavbarBackLink, Link, List, ListInput, ListItem, Button, Block, BlockTitle } from 'konsta/svelte';
	import { addContent } from '$lib/firebase';
	import { userStore, showToast } from '$lib/stores';
	import { hapticSuccess, hapticLight } from '$lib/utils/haptics';
	import type { PollContentDoc } from '$lib/types';

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
	let pollQuestion = $state('');
	let pollOptionText = $state('');
	let pollOptions = $state<{ id: string; text: string }[]>([]);

	function addPollOption() {
		if (!pollOptionText.trim() || pollOptions.length >= 4) return;
		pollOptions = [...pollOptions, { id: crypto.randomUUID(), text: pollOptionText.trim() }];
		pollOptionText = '';
		hapticLight();
	}

	function removeOption(index: number) {
		pollOptions = pollOptions.filter((_, i) => i !== index);
	}

	async function submitPoll() {
		const user = $userStore.user;
		if (!user || !pollQuestion.trim() || pollOptions.length < 2) return;
		busy = true;
		try {
			await addContent(boardId, {
				type: 'poll', question: pollQuestion.trim(), options: pollOptions,
				boardId, authorId: user.uid, authorName: user.displayName || user.email, authorPhotoURL: user.photoURL
			} as Omit<PollContentDoc, 'id' | 'createdAt'>);
			hapticSuccess();
			showToast('Poll saved!');
			onClose();
		} catch { showToast('Failed to save poll'); }
		finally { busy = false; }
	}

	const canSubmit = $derived(!busy && pollQuestion.trim().length > 0 && pollOptions.length >= 2);
</script>

{#snippet navLeft()}
	<NavbarBackLink onClick={onClose} text="Close" />
{/snippet}

{#snippet navRight()}
	{#if canSubmit}
		<Link onClick={submitPoll}>
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
		<Navbar title="New Poll" left={navLeft} right={navRight} />

		<div class="flex-1 overflow-y-auto">
			<!-- Question input -->
			<List inset strong outline>
				<ListInput
					outline
					label="Question"
					type="text"
					placeholder="Ask a question..."
					value={pollQuestion}
					onInput={(e) => { pollQuestion = e.target.value; }}
					clearButton={pollQuestion.length > 0}
					onClear={() => { pollQuestion = ''; }}
				/>
			</List>

			<!-- Existing options -->
			{#if pollOptions.length > 0}
				<BlockTitle>Options ({pollOptions.length}/4)</BlockTitle>
				<List inset strong dividers>
					{#each pollOptions as opt, i (opt.id)}
						<ListItem title={opt.text}>
							{#snippet media()}
								<span class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary">
									{String.fromCharCode(65 + i)}
								</span>
							{/snippet}
							{#snippet after()}
								<button onclick={() => removeOption(i)} class="p-1.5 -mr-1 text-muted active:text-error transition-colors" aria-label="Remove">
									<Icon icon="ph:x-circle" class="text-base" />
								</button>
							{/snippet}
						</ListItem>
					{/each}
				</List>
			{/if}

			<!-- Add option input -->
			{#if pollOptions.length < 4}
				<BlockTitle>Add Option</BlockTitle>
				<form onsubmit={(e) => { e.preventDefault(); addPollOption(); }}>
					<List inset strong outline>
						<ListInput
							outline
							label="New option"
							type="text"
							placeholder="Type option text..."
							value={pollOptionText}
							onInput={(e) => { pollOptionText = e.target.value; }}
						/>
					</List>
					<div class="flex justify-end px-8 -mt-2">
						<Button small clear rounded onClick={addPollOption} disabled={!pollOptionText.trim()}>
							<Icon icon="ph:plus-circle" class="mr-1.5" />
							Add
						</Button>
					</div>
				</form>
			{/if}

			{#if pollOptions.length < 2}
				<Block>
					<p class="text-xs text-muted">Add at least 2 options to save</p>
				</Block>
			{/if}
		</div>

		<!-- Save footer -->
		<div class="p-4 pb-safe border-t border-border-light">
			<Button large rounded onClick={submitPoll} disabled={!canSubmit}>
				{#if busy}
					<Icon icon="ph:circle-notch-bold" class="mr-2 animate-spin" />
					Saving...
				{:else}
					Save Poll
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
