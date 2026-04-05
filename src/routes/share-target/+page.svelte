<!--
  @file share-target/+page.svelte
  @description Receives shared content from the PWA Web Share Target API and
               Android intent filters. Lets the user pick a board and saves
               the content as a note or link card.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { browser } from '$app/environment';
	import { userStore, boardStore, showToast } from '$lib/stores';
	import { addContent, createBoard } from '$lib/firebase';
	import { extractMetadata } from '$lib/api';
	import { detectContentType, refineContentType, isUrl } from '$lib/utils/contentDetector';
	import { extractDomain, faviconUrl } from '$lib/utils/ogParser';
	import { inferBoardNameFromContent, SEED_SUMMARY } from '$lib/utils/onboardingUtils';
	import {
		routeCapture,
		routeCaptureWithAI,
		loadCorrections,
		recordCorrection,
		type RouteResult,
		type BoardSummary
	} from '$lib/services';
	import type { RouteBoardResponse } from '$lib/types/api';
	import type { LinkContentDoc, ProductContentDoc, NoteContentDoc } from '$lib/types';
	import { Page } from 'konsta/svelte';
	import Header from '$lib/components/ui/Header.svelte';

	let sharedTitle = $state('');
	let sharedText = $state('');
	let sharedUrl = $state('');
	let selectedBoardId = $state<string | null>(null);
	let saving = $state(false);
	let saved = $state(false);
	let autoCreatedBoardName = $state<string | null>(null);
	let routeResult = $state<RouteResult | null>(null);

	const boards = $derived($boardStore.boards);
	const user = $derived($userStore.user);

	/** Combine all shared params into a single display string */
	const displayText = $derived.by(() => {
		const parts: string[] = [];
		if (sharedTitle) parts.push(sharedTitle);
		if (sharedText) parts.push(sharedText);
		if (sharedUrl) parts.push(sharedUrl);
		return parts.join('\n');
	});

	/** Detect if shared content contains a URL */
	const detectedUrl = $derived.by(() => {
		if (sharedUrl) return sharedUrl;
		// Check if text contains a URL
		const urlMatch = sharedText.match(/https?:\/\/[^\s]+/);
		return urlMatch?.[0] ?? null;
	});

	const LAST_BOARD_KEY = 'nearboard_last_shared_board';

	onMount(async () => {
		if (!browser) return;

		// Read query params from Web Share Target API
		const params = $page.url.searchParams;
		sharedTitle = params.get('title') ?? '';
		sharedText = params.get('text') ?? '';
		sharedUrl = params.get('url') ?? '';

		// If nothing shared, redirect home
		if (!sharedTitle && !sharedText && !sharedUrl) {
			goto('/');
			return;
		}

		// Path B: Auto-create board if user has none
		if (boards.length === 0 && user) {
			const url = detectedUrl ?? '';
			const boardName = inferBoardNameFromContent(url);
			autoCreatedBoardName = boardName;
			try {
				const boardId = await createBoard(
					boardName, 'blank', user.uid, null,
					user.displayName || '', user.photoURL,
					{ isOnboarding: true, livingSummary: SEED_SUMMARY }
				);
				selectedBoardId = boardId;
			} catch (err) {
				console.error('Auto-board creation failed:', err);
				showToast('Failed to create board', 'error');
			}
			return;
		}

		// Smart board routing
		await runSmartRoute();
	});

	async function runSmartRoute() {
		const contentText = displayText.trim();
		const boardSummaries: BoardSummary[] = boards.map((b) => ({
			id: b.id,
			name: b.name,
			summary: b.livingSummary?.content ?? null
		}));

		const input = {
			content: contentText,
			activeBoardId: null,
			boards: boardSummaries,
			lastUsedBoardId: localStorage.getItem(LAST_BOARD_KEY),
			corrections: loadCorrections()
		};

		const syncResult = routeCapture(input);

		if (syncResult === null) return;
		if (syncResult !== 'needs-ai') {
			routeResult = syncResult;
			selectedBoardId = syncResult.boardId;
			return;
		}

		// T4: AI classification
		try {
			const aiClassify = async (
				scrubbedContent: string,
				aiBoards: Array<{ id: string; name: string; summary: string }>
			) => {
				const res = await fetch('/api/route-board', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ content: scrubbedContent, boards: aiBoards })
				});
				if (!res.ok) return null;
				return (await res.json()) as RouteBoardResponse;
			};
			const result = await routeCaptureWithAI(input, aiClassify);
			routeResult = result;
			selectedBoardId = result.boardId;
		} catch {
			// Fallback: last-used or first board
			const lastBoard = localStorage.getItem(LAST_BOARD_KEY);
			if (lastBoard && boards.some((b) => b.id === lastBoard)) {
				selectedBoardId = lastBoard;
			} else if (boards.length > 0) {
				selectedBoardId = boards[0].id;
			}
		}
	}

	async function handleSave() {
		if (!selectedBoardId || !user || saving) return;

		saving = true;
		localStorage.setItem(LAST_BOARD_KEY, selectedBoardId);

		// Record correction if user overrode the smart suggestion
		if (routeResult && routeResult.boardId !== selectedBoardId) {
			recordCorrection(selectedBoardId);
		}

		try {
			if (detectedUrl) {
				// Save as link/product card
				let metadata = null;
				try {
					metadata = await extractMetadata(detectedUrl);
				} catch {
					// Fall back to raw URL
				}

				if (metadata) {
					const resolvedUrl = metadata.url || detectedUrl;
					const domain = extractDomain(resolvedUrl);
					const detectedType = metadata.type;

					if (detectedType === 'product') {
						const detectedPrice = metadata.price || null;
						const contentId = await addContent(selectedBoardId, {
							type: 'product',
							url: resolvedUrl,
							title: metadata.title || sharedTitle || detectedUrl,
							image: metadata.image,
							price: detectedPrice ?? '',
							domain,
							originalPrice: detectedPrice,
							lastCheckedPrice: null,
							lastCheckedAt: null,
							priceDrop: false,
							boardId: selectedBoardId,
							authorId: user.uid,
							authorName: user.displayName || '',
							authorPhotoURL: user.photoURL,
							userIntent: 'Shared via Web Share Target'  // Lever 7: Required intent
						} as Omit<ProductContentDoc, 'id' | 'createdAt'>);
						const { registerProductForTracking } = await import('$lib/firebase/pricingService');
						await registerProductForTracking(detectedUrl, selectedBoardId, contentId, detectedPrice ?? '');
					} else {
						await addContent(selectedBoardId, {
							type: 'link',
							url: metadata.url || detectedUrl,
							title: metadata.title || sharedTitle || detectedUrl,
							description: metadata.description,
							image: metadata.image,
							domain,
							favicon: faviconUrl(domain),
							enrichment: metadata.enrichment ?? null,
							boardId: selectedBoardId,
							authorId: user.uid,
							authorName: user.displayName || '',
							authorPhotoURL: user.photoURL,
							userIntent: 'Shared via Web Share Target'  // Lever 7: Required intent
						} as Omit<LinkContentDoc, 'id' | 'createdAt'>);
					}
				} else {
					// No metadata — check domain for product detection
					const domain = extractDomain(detectedUrl);
					const domainType = detectContentType(detectedUrl);

					if (domainType.type === 'product') {
						const contentId = await addContent(selectedBoardId, {
							type: 'product',
							url: detectedUrl,
							title: sharedTitle || detectedUrl,
							image: null,
							price: '',
							domain,
							originalPrice: null,
							lastCheckedPrice: null,
							lastCheckedAt: null,
							priceDrop: false,
							boardId: selectedBoardId,
							authorId: user.uid,
							authorName: user.displayName || '',
							authorPhotoURL: user.photoURL,
							userIntent: 'Shared via Web Share Target'  // Lever 7: Required intent
						} as Omit<ProductContentDoc, 'id' | 'createdAt'>);
						const { registerProductForTracking } = await import('$lib/firebase/pricingService');
						await registerProductForTracking(detectedUrl, selectedBoardId, contentId, '');
					} else {
						await addContent(selectedBoardId, {
							type: 'link',
							url: detectedUrl,
							title: sharedTitle || detectedUrl,
							description: sharedText || null,
							image: null,
							domain,
							favicon: faviconUrl(domain),
							boardId: selectedBoardId,
							authorId: user.uid,
							authorName: user.displayName || '',
							authorPhotoURL: user.photoURL,
							userIntent: 'Shared via Web Share Target'  // Lever 7: Required intent
						} as Omit<LinkContentDoc, 'id' | 'createdAt'>);
					}
				}
			} else {
				// Save as note card
				const text = [sharedTitle, sharedText].filter(Boolean).join('\n');
				await addContent(selectedBoardId, {
					type: 'note',
					text,
					boardId: selectedBoardId,
					authorId: user.uid,
					authorName: user.displayName || '',
					authorPhotoURL: user.photoURL,
					userIntent: 'Shared via Web Share Target'  // Lever 7: Required intent
				} as Omit<NoteContentDoc, 'id' | 'createdAt'>);
			}

			saved = true;
			showToast('Saved to board!', 'success');
			setTimeout(() => goto(`/board/${selectedBoardId}`), 1200);
		} catch (err) {
			console.error('[ShareTarget] Save failed:', err);
			showToast('Failed to save shared content');
		} finally {
			saving = false;
		}
	}
</script>

<Page>
	<Header title="Save to Nearboard" backHref="/" />

	<main class="flex-1 px-6 py-6">
		{#if !user}
			<div class="flex flex-col items-center justify-center mt-20 gap-3">
				<Icon icon="ph:sign-in" class="text-3xl text-on-surface/60" />
				<p class="text-muted text-sm text-center">Sign in to save shared content.</p>
				<a href="/onboarding" class="text-sm text-accent font-medium hover:underline">Sign in</a>
			</div>
		{:else if saved}
			<div class="flex flex-col items-center justify-center mt-20 gap-4" in:fly={{ y: 10, duration: 300 }}>
				<div class="w-14 h-14 rounded-full bg-success/10 text-success flex items-center justify-center">
					<Icon icon="ph:check-bold" class="text-2xl" />
				</div>
				<p class="text-primary font-medium">Saved!</p>
				<p class="text-muted text-sm">Redirecting to your board...</p>
			</div>
		{:else}
			<!-- Preview of shared content -->
			<div class="bg-card rounded-card shadow-card p-4 mb-6">
				<p class="text-[10px] font-bold text-muted uppercase tracking-wider mb-2">Shared Content</p>
				{#if detectedUrl}
					<div class="flex items-center gap-2 mb-2">
						<Icon icon="ph:link" class="text-on-surface text-sm shrink-0" />
						<p class="text-xs text-accent truncate">{detectedUrl}</p>
					</div>
				{/if}
				{#if sharedTitle}
					<p class="text-sm font-medium text-primary">{sharedTitle}</p>
				{/if}
				{#if sharedText && sharedText !== sharedTitle}
					<p class="text-sm text-primary mt-1 whitespace-pre-wrap line-clamp-6">{sharedText}</p>
				{/if}

				<div class="mt-3 pt-2 border-t border-border/50">
					<p class="text-[10px] text-muted">
						Will save as {detectedUrl ? 'link' : 'note'} card
					</p>
				</div>
			</div>

			<!-- Board picker -->
			<div class="mb-6">
				<p class="text-xs font-bold text-muted uppercase tracking-wider mb-3">Save to board</p>

				{#if boards.length === 0 && autoCreatedBoardName}
					<div class="flex items-center gap-3 px-4 py-3 rounded-card border border-accent bg-accent/5">
						<Icon icon="ph:check-circle-fill" class="text-lg text-success" />
						<span class="text-sm font-medium text-primary">{autoCreatedBoardName}</span>
						<span class="text-[11px] text-muted ml-auto capitalize">Auto-created</span>
					</div>
				{:else if boards.length === 0}
					<p class="text-sm text-muted">No boards yet. Create one first.</p>
				{:else}
					<div class="flex flex-col gap-2">
						{#each boards as board (board.id)}
							<button
								onclick={() => { selectedBoardId = board.id; }}
								class="flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors
									{selectedBoardId === board.id
										? 'border-accent bg-accent/5 text-primary'
										: 'border-border bg-card text-muted hover:border-accent/30'}"
							>
								<Icon
									icon={selectedBoardId === board.id ? 'ph:check-circle-fill' : 'ph:circle'}
									class="text-lg {selectedBoardId === board.id ? 'text-accent' : 'text-border'}"
								/>
								<span class="text-sm font-medium">{board.name}</span>
								{#if routeResult && routeResult.boardId === board.id && routeResult.confidence !== 'exact'}
									<span class="text-[10px] text-accent ml-auto">Suggested</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Save button -->
			<button
				onclick={handleSave}
				disabled={!selectedBoardId || saving}
				class="w-full py-3.5 bg-accent text-white rounded-lg font-medium text-sm
					disabled:opacity-50 active:scale-[0.98] transition-transform"
			>
				{#if saving}
					<span class="flex items-center justify-center gap-2">
						<Icon icon="ph:circle-notch-bold" class="animate-spin" />
						Saving...
					</span>
				{:else}
					Save to Board
				{/if}
			</button>
		{/if}
	</main>
</Page>
