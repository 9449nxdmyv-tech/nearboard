<!--
  @file board/[boardId]/publish-template/+page.svelte
  @description Publish current board as a reusable template in the marketplace.
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { CARD_ENTRANCE } from '$lib/config/animations';
	import Header from '$lib/components/ui/Header.svelte';
	import { publishTemplate, subscribeToBoard, subscribeToBoardContent } from '$lib/firebase';
	import { userStore } from '$lib/stores';
	import { Page, List, ListInput, Button, Block, BlockTitle } from 'konsta/svelte';
	import { onMount } from 'svelte';
	import type { BoardDoc, BoardTemplate, ContentType, ContentDoc, TemplateSectionDoc } from '$lib/types';

	const boardId = $derived($page.params.boardId ?? '');
	let board = $state<BoardDoc | null>(null);
	let name = $state('');
	let description = $state('');
	let saving = $state(false);
	let error = $state<string | null>(null);
	let sectionsAutoPopulated = $state(false);

	// Section builder
	let sectionTitle = $state('');
	let sectionType = $state<ContentType>('note');
	let sectionPlaceholder = $state('');
	let sections = $state<TemplateSectionDoc[]>([]);

	const CONTENT_TYPES: { value: ContentType; label: string; icon: string }[] = [
		{ value: 'note', label: 'Note', icon: 'ph:note-pencil' },
		{ value: 'list', label: 'List', icon: 'ph:list-checks' },
		{ value: 'link', label: 'Link', icon: 'ph:link' },
		{ value: 'product', label: 'Product', icon: 'ph:shopping-bag' },
		{ value: 'voice', label: 'Voice', icon: 'ph:microphone' },
		{ value: 'poll', label: 'Poll', icon: 'ph:chart-bar' },
		{ value: 'photo', label: 'Photo', icon: 'ph:camera' },
		{ value: 'video', label: 'Video', icon: 'ph:video-camera' },
		{ value: 'location', label: 'Location', icon: 'ph:map-pin' }
	];

	const CATEGORY_ICON: Record<string, string> = {
		household: 'ph:house', family: 'ph:users-three', trip: 'ph:suitcase-rolling', team: 'ph:briefcase',
		creative: 'ph:paint-brush', wishlist: 'ph:gift', renovation: 'ph:wrench', blank: 'ph:sparkle'
	};

	const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
		note: 'Notes',
		list: 'Lists',
		link: 'Links',
		product: 'Products',
		voice: 'Voice Notes',
		poll: 'Polls',
		photo: 'Photos',
		video: 'Videos',
		location: 'Locations'
	};

	onMount(() => {
		const unsubBoard = subscribeToBoard(boardId, (b) => {
			board = b;
			if (b && !name) name = `${b.name} Template`;
		});

		// Auto-populate sections from existing board content types
		const unsubContent = subscribeToBoardContent(boardId, (content: ContentDoc[]) => {
			if (sectionsAutoPopulated || sections.length > 0) return;
			const types = new Set<ContentType>();
			for (const item of content) {
				types.add(item.type as ContentType);
			}
			if (types.size > 0) {
				sections = Array.from(types).map((type) => ({
					title: CONTENT_TYPE_LABELS[type] ?? type,
					contentType: type,
					placeholder: `Add a ${type}...`
				}));
				sectionsAutoPopulated = true;
			}
		});

		return () => {
			unsubBoard();
			unsubContent();
		};
	});

	function addSection() {
		if (!sectionTitle.trim()) return;
		sections = [...sections, {
			title: sectionTitle.trim(),
			contentType: sectionType,
			placeholder: sectionPlaceholder.trim() || `Add a ${sectionType}...`
		}];
		sectionTitle = '';
		sectionPlaceholder = '';
		sectionType = 'note';
	}

	function removeSection(index: number) {
		sections = sections.filter((_, i) => i !== index);
	}

	async function handlePublish() {
		const user = $userStore.user;
		if (!user || !board || !name.trim() || !description.trim() || sections.length === 0) return;

		saving = true;
		error = null;
		try {
			await publishTemplate(
				boardId,
				name.trim(),
				description.trim(),
				board.template,
				user.uid,
				user.displayName || user.email,
				sections
			);
			goto('/templates');
		} catch (e) {
			error = 'Failed to publish. Please try again.';
			console.error(e);
		} finally {
			saving = false;
		}
	}
</script>

<Page>
	<Header title="Publish Template" subtitle="Share this board's structure with others" backHref="/board/{boardId}" />

	<div in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration }}>
		<!-- Name & Description -->
		<List inset strong outline>
			<ListInput
				outline
				label="Template Name"
				type="text"
				placeholder="e.g. Family Weekly Planner"
				value={name}
				onInput={(e) => { name = e.target.value; }}
				maxlength={60}
			/>
			<ListInput
				outline
				label="Description"
				type="textarea"
				placeholder="Describe what this template is for..."
				value={description}
				onInput={(e) => { description = e.target.value; }}
				maxlength={200}
				inputClass="!h-20 resize-none"
			/>
		</List>

		<!-- Sections -->
		<BlockTitle>Sections</BlockTitle>
		<Block class="!pt-0">
			<p class="text-xs text-muted">Define the starter content sections for this template.</p>
		</Block>

		{#if sections.length > 0}
			<List inset strong>
				{#each sections as section, i}
					{#snippet sectionMedia()}
						<Icon icon={CONTENT_TYPES.find(t => t.value === section.contentType)?.icon ?? 'ph:note-pencil'} class="text-base text-on-surface/60" />
					{/snippet}
					{#snippet sectionAfter()}
						<button
							onclick={() => removeSection(i)}
							class="p-1.5 text-muted hover:text-error transition-colors"
							aria-label="Remove section"
						>
							<Icon icon="ph:x" class="text-sm" />
						</button>
					{/snippet}
					<li class="flex items-center gap-3 px-4 py-3">
						{@render sectionMedia()}
						<div class="flex-1 min-w-0">
							<span class="text-sm text-primary">{section.title}</span>
							<span class="text-xs text-muted ml-1">({section.contentType})</span>
						</div>
						{@render sectionAfter()}
					</li>
				{/each}
			</List>
		{/if}

		<!-- Add section form -->
		<List inset strong outline>
			<ListInput
				outline
				label="Section title"
				type="text"
				placeholder="e.g. Inspiration"
				value={sectionTitle}
				onInput={(e) => { sectionTitle = e.target.value; }}
			/>
			<ListInput
				outline
				label="Content type"
				type="select"
				value={sectionType}
				onInput={(e) => { sectionType = e.target.value; }}
			>
				{#each CONTENT_TYPES as ct}
					<option value={ct.value}>{ct.label}</option>
				{/each}
			</ListInput>
			<ListInput
				outline
				label="Placeholder (optional)"
				type="text"
				placeholder="Add a note..."
				value={sectionPlaceholder}
				onInput={(e) => { sectionPlaceholder = e.target.value; }}
			/>
		</List>

		<Block class="!pt-0">
			<Button small clear onClick={addSection} disabled={!sectionTitle.trim()}>
				+ Add Section
			</Button>
		</Block>

		<!-- Template preview -->
		{#if name.trim() && description.trim() && sections.length > 0 && board}
			<BlockTitle>Preview</BlockTitle>
			<Block>
				<p class="text-xs text-muted mb-3">How your template will appear in the marketplace.</p>
				<div class="bg-card rounded-card shadow-card p-4">
					<div class="flex items-start justify-between mb-2">
						<div class="flex items-center gap-2">
							<div class="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
								<Icon icon={CATEGORY_ICON[board.template] ?? 'ph:sparkle'} class="text-lg text-on-surface" />
							</div>
							<div>
								<h3 class="font-semibold text-sm text-primary">{name.trim()}</h3>
								<p class="text-xs text-muted">by {$userStore.user?.displayName || $userStore.user?.email || 'You'}</p>
							</div>
						</div>
						<span class="text-xs text-muted">0 clones</span>
					</div>

					<span class="inline-block px-2.5 py-1 bg-accent/10 text-accent text-xs font-medium rounded-full capitalize mb-3">
						{board.template}
					</span>

					<p class="text-xs text-muted mb-3 leading-relaxed line-clamp-2">{description.trim()}</p>

					<div class="flex gap-1.5 flex-wrap">
						{#each sections.slice(0, 3) as section}
							<span class="px-2 py-0.5 bg-surface rounded-full text-[10px] text-muted border border-border">
								{section.title}
							</span>
						{/each}
						{#if sections.length > 3}
							<span class="px-2 py-0.5 text-[10px] text-muted">+{sections.length - 3}</span>
						{/if}
					</div>
				</div>
			</Block>
		{/if}

		{#if error}
			<Block>
				<p class="text-error text-sm text-center">{error}</p>
			</Block>
		{/if}

		<!-- Publish button -->
		<Block>
			<Button
				large
				rounded
				onClick={handlePublish}
				disabled={saving || !name.trim() || !description.trim() || sections.length === 0}
				class="w-full"
			>
				{saving ? 'Publishing...' : 'Publish Template'}
			</Button>
			<p class="text-xs text-muted text-center mt-3">
				Published templates are visible to all Nearboard users.
			</p>
		</Block>
	</div>
</Page>
