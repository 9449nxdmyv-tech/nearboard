<!--
  @file WhatsAppImportSheet.svelte
  @description 4-step bottom sheet for WhatsApp chat import.
               Step 1: Instructions + file picker
               Step 2: Processing indicator
               Step 3: Preview + select cards
               Step 4: Result summary
-->
<script lang="ts">
	import BottomSheet from './BottomSheet.svelte';
	import Icon from '@iconify/svelte';
	import { parseAndClassify, importApprovedCards } from '$lib/firebase/whatsAppImportService';
	import { showToast, userStore } from '$lib/stores';
	import { WHATSAPP_IMPORT_MAX_TXT_BYTES } from '$lib/config/constants';
	import { Button } from 'konsta/svelte';
	import type { ClassifiedWhatsAppCard, WhatsAppImportResult } from '$lib/types';

	let {
		open,
		boardId,
		boardName,
		onClose
	}: {
		open: boolean;
		boardId: string;
		boardName: string;
		onClose: () => void;
	} = $props();

	let step = $state<1 | 2 | 3 | 4>(1);
	let cards = $state<ClassifiedWhatsAppCard[]>([]);
	let selected = $state<Set<number>>(new Set());
	let result = $state<WhatsAppImportResult | null>(null);
	let error = $state<string | null>(null);
	let importError = $state<string | null>(null);
	let statusText = $state('Reading your chat...');
	let importing = $state(false);

	const selectedCount = $derived(selected.size);
	const title = $derived(
		step === 1 ? 'Import from WhatsApp' :
		step === 2 ? 'Processing...' :
		step === 3 ? 'Review Suggested Cards' :
		'Import Complete'
	);

	const CARD_ICONS: Record<string, string> = {
		link: 'ph:link',
		product: 'ph:shopping-bag',
		note: 'ph:note-pencil',
		list: 'ph:list-checks',
		photo: 'ph:camera'
	};

	const STATUS_MESSAGES = [
		'Reading your chat...',
		'Finding the good stuff...',
		'Classifying messages...',
		'Almost ready...'
	];

	function handleClose() {
		// Reset state on close
		step = 1;
		cards = [];
		selected = new Set();
		result = null;
		error = null;
		importError = null;
		importing = false;
		onClose();
	}

	async function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		// Validate file type
		const isZip = file.name.endsWith('.zip') || file.type === 'application/zip';
		const isTxt = file.name.endsWith('.txt') || file.type === 'text/plain';
		if (!isZip && !isTxt) {
			showToast('Please select a .txt or .zip WhatsApp export');
			return;
		}

		// Validate size (text files only — zips are streamed selectively)
		if (!isZip && file.size > WHATSAPP_IMPORT_MAX_TXT_BYTES) {
			const maxMB = Math.round(WHATSAPP_IMPORT_MAX_TXT_BYTES / (1024 * 1024));
			showToast(`File too large. Maximum ${maxMB} MB for text files.`);
			return;
		}

		// Move to processing step
		step = 2;
		error = null;

		// Cycle status text
		let statusIdx = 0;
		const interval = setInterval(() => {
			statusIdx = (statusIdx + 1) % STATUS_MESSAGES.length;
			statusText = STATUS_MESSAGES[statusIdx];
		}, 2500);

		try {
			const classified = await parseAndClassify(file);
			clearInterval(interval);

			if (classified.length === 0) {
				error = 'No cards could be created from this chat. Try a different conversation.';
				step = 2; // Stay on step 2 with error
				return;
			}

			cards = classified;
			// Select all by default
			selected = new Set(classified.map((_, i) => i));
			step = 3;
		} catch (err) {
			clearInterval(interval);
			error = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
		}

		// Reset file input
		input.value = '';
	}

	function toggleCard(index: number) {
		const next = new Set(selected);
		if (next.has(index)) {
			next.delete(index);
		} else {
			next.add(index);
		}
		selected = next;
	}

	function selectAll() {
		selected = new Set(cards.map((_, i) => i));
	}

	function deselectAll() {
		selected = new Set();
	}

	async function handleImport() {
		if (selectedCount === 0 || importing) return;

		const user = $userStore.user;
		if (!user) return;

		importing = true;
		importError = null;

		try {
			result = await importApprovedCards({
				boardId,
				importerUid: user.uid,
				importerName: user.displayName,
				importerPhotoURL: user.photoURL,
				cards,
				selectedIndices: [...selected]
			});
			step = 4;
		} catch (err) {
			console.error('Import failed:', err);
			importError = err instanceof Error ? err.message : 'Import failed. Please try again.';
			showToast('Import failed. Please try again.');
		} finally {
			importing = false;
		}
	}

	function formatTimestamp(iso: string): string {
		try {
			const d = new Date(iso);
			return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
				' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
		} catch {
			return '';
		}
	}
</script>

<BottomSheet {title} {open} onClose={handleClose}>
	{#if step === 1}
		<!-- Step 1: Instructions + File Picker -->
		<div class="space-y-4">
			<div class="bg-surface rounded-card p-3 space-y-2">
				<p class="text-sm text-primary font-medium">How to export from WhatsApp:</p>
				<ol class="text-xs text-muted space-y-1.5 list-decimal list-inside">
					<li>Open the WhatsApp chat you want to import</li>
					<li>Tap the three dots menu (Android) or the contact name (iOS)</li>
					<li>Select "Export chat"</li>
					<li>Choose "Attach media" to include photos, or "Without media" for text only</li>
					<li>Save the .txt or .zip file and upload it here</li>
				</ol>
			</div>

			<div class="bg-surface/50 rounded-card p-3">
				<div class="flex items-start gap-2">
					<Icon icon="ph:shield-check" class="text-primary text-base mt-0.5 shrink-0" />
					<p class="text-[11px] text-muted leading-relaxed">
						Your chat is processed to create cards. Messages are sent to AI for classification but nothing
						is saved beyond the cards you approve. Only messages from the last 30 days are processed.
					</p>
				</div>
			</div>

			<label
				class="flex items-center justify-center gap-2 w-full py-3 bg-accent text-white text-sm font-medium
					rounded-lg cursor-pointer hover:bg-accent/90 transition-colors"
			>
				<Icon icon="ph:upload-simple" class="text-base" />
				Choose File
				<input
					type="file"
					accept=".txt,.zip"
					class="hidden"
					onchange={handleFileSelect}
				/>
			</label>

			<Button clear onClick={handleClose} class="w-full">
				Cancel
			</Button>
		</div>

	{:else if step === 2}
		<!-- Step 2: Processing -->
		<div class="flex flex-col items-center py-8 space-y-4">
			{#if error}
				<Icon icon="ph:warning-circle" class="text-3xl text-error" />
				<p class="text-sm text-error text-center px-4">{error}</p>
				<Button large rounded outline onClick={() => { step = 1; error = null; }}>
					Try Again
				</Button>
			{:else}
				<div class="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
				<p class="text-sm text-muted">{statusText}</p>
			{/if}
		</div>

	{:else if step === 3}
		<!-- Step 3: Preview -->
		<div class="space-y-3">
			{#if importError}
				<div class="flex items-start gap-2 p-3 rounded-card bg-error/5 border border-error/20">
					<Icon icon="ph:warning-circle" class="text-error text-base mt-0.5 shrink-0" />
					<div class="flex-1 min-w-0">
						<p class="text-xs font-medium text-error">Import failed</p>
						<p class="text-[11px] text-muted mt-0.5">{importError}</p>
					</div>
					<button
						onclick={() => { importError = null; }}
						class="text-muted hover:text-on-surface p-0.5"
						aria-label="Dismiss error"
					>
						<Icon icon="ph:x" class="text-sm" />
					</button>
				</div>
			{/if}

			<div class="flex items-center justify-between">
				<p class="text-xs text-muted">{cards.length} cards found</p>
				<div class="flex gap-2">
					<Button clear small onClick={selectAll}>Select All</Button>
					<span class="text-muted">·</span>
					<Button clear small onClick={deselectAll}>Deselect All</Button>
				</div>
			</div>

			<div class="max-h-[45vh] overflow-y-auto -mx-1 px-1 space-y-2">
				{#each cards as card, i (i)}
					<button
						onclick={() => toggleCard(i)}
						class="w-full flex items-start gap-3 p-3 rounded-card border transition-colors text-left
							{selected.has(i) ? 'border-accent/40 bg-accent/5' : 'border-border bg-card'}"
					>
						<!-- Checkbox -->
						<div class="mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors
							{selected.has(i) ? 'border-accent bg-accent' : 'border-border'}"
						>
							{#if selected.has(i)}
								<Icon icon="ph:check-bold" class="text-white text-xs" />
							{/if}
						</div>

						<!-- Card type icon -->
						<Icon icon={CARD_ICONS[card.cardType] ?? 'ph:note'} class="text-lg text-primary mt-0.5 shrink-0" />

						<!-- Content -->
						<div class="flex-1 min-w-0">
							<p class="text-sm text-primary font-medium truncate">{card.proposedTitle}</p>
							<p class="text-xs text-muted mt-0.5 line-clamp-2">{card.proposedContent}</p>
							<p class="text-[10px] text-muted/60 mt-1">
								{card.originalMessage.author} · {formatTimestamp(card.originalMessage.timestamp)}
							</p>
						</div>
					</button>
				{/each}
			</div>

			<div class="flex gap-2 pt-2">
				<Button large outline rounded onClick={handleClose} class="flex-1">
					Cancel
				</Button>
				<Button large rounded onClick={handleImport} disabled={selectedCount === 0 || importing} class="flex-1">
					{#if importing}
						Importing...
					{:else if importError}
						Retry Import
					{:else}
						Import {selectedCount} Card{selectedCount === 1 ? '' : 's'}
					{/if}
				</Button>
			</div>
		</div>

	{:else if step === 4}
		<!-- Step 4: Result -->
		<div class="flex flex-col items-center py-6 space-y-4">
			<div class="w-14 h-14 rounded-full bg-[color:var(--color-whatsapp-import-bg)] flex items-center justify-center">
				<Icon icon="ph:check-circle-fill" class="text-3xl text-success" />
			</div>
			<div class="text-center">
				<p class="text-base font-medium text-primary">
					{result?.imported ?? 0} card{(result?.imported ?? 0) === 1 ? '' : 's'} added to {boardName}
				</p>
				{#if result && result.failed > 0}
					<p class="text-xs text-muted mt-1">{result.failed} card{result.failed === 1 ? '' : 's'} failed to import</p>
				{/if}
			</div>

			<Button large rounded onClick={handleClose} class="w-full">
				Done
			</Button>
		</div>
	{/if}
</BottomSheet>
