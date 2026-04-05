<!--
  @file board/[boardId]/time-capsule/+page.svelte
  @description Time Capsule settings — lock a board with a future unlock date.
               Includes confirmation dialog and live countdown timer.
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { CARD_ENTRANCE } from '$lib/config/animations';
	import Header from '$lib/components/ui/Header.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { lockTimeCapsule, unlockTimeCapsule, subscribeToBoard } from '$lib/firebase';
	import { userStore } from '$lib/stores';
	import { Page } from 'konsta/svelte';
	import { onMount } from 'svelte';
	import type { BoardDoc } from '$lib/types';

	const boardId = $derived($page.params.boardId ?? '');
	let board = $state<BoardDoc | null>(null);
	let unlockDate = $state('');
	let saving = $state(false);
	let showConfirm = $state(false);

	// Countdown state
	let countdownDays = $state(0);
	let countdownHours = $state(0);
	let countdownMinutes = $state(0);
	let countdownInterval: ReturnType<typeof setInterval> | undefined;

	onMount(() => {
		const unsub = subscribeToBoard(boardId, (b) => {
			board = b;
		});

		countdownInterval = setInterval(updateCountdown, 60_000);
		// Run once immediately
		updateCountdown();

		return () => {
			unsub();
			if (countdownInterval) clearInterval(countdownInterval);
		};
	});

	function updateCountdown() {
		const unlockAt = board?.timeCapsuleUnlockAt?.toDate();
		if (!unlockAt) {
			countdownDays = 0;
			countdownHours = 0;
			countdownMinutes = 0;
			return;
		}
		const diff = unlockAt.getTime() - Date.now();
		if (diff <= 0) {
			countdownDays = 0;
			countdownHours = 0;
			countdownMinutes = 0;
			return;
		}
		countdownDays = Math.floor(diff / 86_400_000);
		countdownHours = Math.floor((diff % 86_400_000) / 3_600_000);
		countdownMinutes = Math.floor((diff % 3_600_000) / 60_000);
	}

	// Re-run countdown when board changes
	$effect(() => {
		if (board) updateCountdown();
	});

	function requestLock() {
		if (!unlockDate || saving) return;
		showConfirm = true;
	}

	async function confirmLock() {
		showConfirm = false;
		saving = true;
		await lockTimeCapsule(boardId, new Date(unlockDate));
		saving = false;
	}

	async function handleUnlock() {
		if (saving) return;
		saving = true;
		await unlockTimeCapsule(boardId);
		saving = false;
	}

	const isOwner = $derived(board?.ownerId === $userStore.user?.uid);
	const isLocked = $derived(board?.timeCapsuleLocked ?? false);
</script>

<Page>
	<Header title="Time Capsule" backHref="/board/{boardId}" />

	<div class="px-6 py-6">
		{#if !isOwner}
			<p class="text-muted text-sm">Only the board owner can manage the time capsule.</p>
		{:else if isLocked}
			<div in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration }} class="bg-card shadow-card rounded-card p-6 text-center">
				<Icon icon="ph:lock-fill" class="text-4xl text-on-surface mx-auto mb-3" />
				<h2 class="font-display text-lg font-semibold text-primary mb-2">Board is Locked</h2>
				<p class="text-sm text-muted mb-4">
					This board is sealed as a time capsule. It will automatically unlock on
					<strong class="text-primary">
						{board?.timeCapsuleUnlockAt?.toDate().toLocaleDateString() ?? 'the scheduled date'}
					</strong>.
				</p>

				<!-- Countdown timer -->
				{#if countdownDays > 0 || countdownHours > 0 || countdownMinutes > 0}
					<div class="flex items-center justify-center gap-4 mb-6">
						<div class="flex flex-col items-center">
							<span class="text-2xl font-bold text-primary">{countdownDays}</span>
							<span class="text-xs text-muted">days</span>
						</div>
						<span class="text-xl text-muted">:</span>
						<div class="flex flex-col items-center">
							<span class="text-2xl font-bold text-primary">{countdownHours}</span>
							<span class="text-xs text-muted">hours</span>
						</div>
						<span class="text-xl text-muted">:</span>
						<div class="flex flex-col items-center">
							<span class="text-2xl font-bold text-primary">{countdownMinutes}</span>
							<span class="text-xs text-muted">min</span>
						</div>
					</div>
				{/if}

				<button
					onclick={handleUnlock}
					disabled={saving}
					class="px-6 py-3 bg-red-500 text-white rounded-lg text-sm font-medium
						disabled:opacity-50 active:scale-[0.98] transition-transform"
				>
					{saving ? 'Unlocking...' : 'Unlock Early'}
				</button>
			</div>
		{:else}
			<div in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration }} class="bg-card shadow-card rounded-card p-6">
				<Icon icon="ph:hourglass-medium" class="text-4xl text-on-surface mx-auto mb-3" />
				<h2 class="font-display text-lg font-semibold text-primary mb-2 text-center">Create a Time Capsule</h2>
				<p class="text-sm text-muted mb-6 text-center">
					Lock this board until a future date. All content will be hidden from members until then.
				</p>

				<label for="unlock-date" class="block text-sm font-medium text-primary mb-2">Unlock Date</label>
				<input
					id="unlock-date"
					type="date"
					bind:value={unlockDate}
					min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
					class="w-full py-3 px-4 border border-border rounded-lg text-sm bg-surface
						focus:outline-none focus:border-accent transition-colors mb-6"
				/>

				<button
					onclick={requestLock}
					disabled={saving || !unlockDate}
					class="w-full px-6 py-3 bg-accent text-white rounded-lg text-sm font-medium
						disabled:opacity-50 active:scale-[0.98] transition-transform"
				>
					{saving ? 'Locking...' : 'Lock Board'}
				</button>
			</div>
		{/if}
	</div>
</Page>

{#if showConfirm}
	<ConfirmDialog
		title="Lock Time Capsule?"
		message="This will hide all board content from members until the unlock date. You can unlock early, but members will be notified."
		confirmLabel="Lock Board"
		onConfirm={confirmLock}
		onCancel={() => showConfirm = false}
	/>
{/if}
