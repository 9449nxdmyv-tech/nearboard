<!--
  @file QuickCapturePollSheet.svelte
  @description Fullscreen sheet for creating a poll.
               Uses Konsta UI List/ListItem/ListInput for native iOS form styling.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { Navbar, NavbarBackLink, Link, List, ListInput, ListItem, Button, Block, BlockTitle } from 'konsta/svelte';
	import { addContent } from '$lib/firebase';
	import { userStore, showToast } from '$lib/stores';
	import { hapticSuccess, hapticLight } from '$lib/utils/haptics';
	import QuickCaptureShell from './QuickCaptureShell.svelte';
	import SubmitButton from './SubmitButton.svelte';
	import type { PollContentDoc } from '$lib/types';

	let {
		boardId,
		onClose
	}: {
		boardId: string;
		onClose: (posted?: boolean) => void;
	} = $props();

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
			showToast('Poll saved!', 'success');
			onClose(true);
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

<QuickCaptureShell {onClose}>
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
		<SubmitButton {busy} disabled={!canSubmit} onClick={submitPoll}>
			Save Poll
		</SubmitButton>
	</div>
</QuickCaptureShell>
