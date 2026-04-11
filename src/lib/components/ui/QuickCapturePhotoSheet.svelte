<!--
  @file QuickCapturePhotoSheet.svelte
  @description Fullscreen photo capture overlay with two phases:
               1. Select — camera capture (mobile), file picker, drag & drop (desktop)
               2. Review — photo grid, caption, save
               Mobile: fullscreen. Desktop: centered panel.
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Icon from '@iconify/svelte';
	import { Navbar, NavbarBackLink, Link, Button, List, ListInput } from 'konsta/svelte';
	import { userStore, showToast, queuePhotoUpload } from '$lib/stores';
	import { hapticLight } from '$lib/utils/haptics';
	// PhotoContentDoc type used by uploadStore internally
	import { onDestroy } from 'svelte';

	let {
		boardId,
		onClose
	}: {
		boardId: string;
		onClose: () => void;
	} = $props();

	const MAX_PHOTOS = 5;

	// ─── Phase management ────────────────────────────────────────────────
	type Phase = 'select' | 'review';
	let phase = $state<Phase>('select');

	// ─── Photo state ─────────────────────────────────────────────────────
	let photoFiles = $state<File[]>([]);
	let photoPreviews = $state<string[]>([]);
	let photoCaption = $state('');
	let busy = $state(false);
	let draggingOver = $state(false);
	let destroyed = false;
	let fileInputEl = $state<HTMLInputElement | undefined>();
	let cameraInputEl = $state<HTMLInputElement | undefined>();

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

	// ─── Keyboard ────────────────────────────────────────────────────────
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') handleClose();
	}

	onDestroy(() => {
		destroyed = true;
		photoPreviews.forEach((u) => URL.revokeObjectURL(u));
	});

	// ─── File handling ───────────────────────────────────────────────────
	function addFiles(files: FileList | File[]) {
		const maxSlots = MAX_PHOTOS - photoFiles.length;
		const newFiles = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, maxSlots);
		if (newFiles.length === 0) return;
		photoFiles = [...photoFiles, ...newFiles];
		photoPreviews = [...photoPreviews, ...newFiles.map((f) => URL.createObjectURL(f))];
		hapticLight();
		phase = 'review';
	}

	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;
		addFiles(input.files);
		// Reset input so same file can be re-selected
		input.value = '';
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		draggingOver = false;
		if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
	}

	function removePhoto(index: number) {
		URL.revokeObjectURL(photoPreviews[index]);
		photoFiles = photoFiles.filter((_, i) => i !== index);
		photoPreviews = photoPreviews.filter((_, i) => i !== index);
		if (photoFiles.length === 0) phase = 'select';
	}

	// ─── Submit ──────────────────────────────────────────────────────────
	function submitPhotos() {
		const user = $userStore.user;
		if (!user || photoFiles.length === 0) return;

		// Hand off files and previews to background queue — don't revoke URLs here
		queuePhotoUpload({
			boardId,
			userId: user.uid,
			userName: user.displayName || user.email || '',
			userPhoto: user.photoURL,
			files: [...photoFiles],
			previews: [...photoPreviews],
			caption: photoCaption.trim()
		});

		// Clear local refs so onDestroy doesn't revoke the URLs the upload still needs
		photoPreviews = [];
		photoFiles = [];
		onClose();
	}

	function handleClose() {
		onClose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) handleClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Hidden file inputs -->
<input bind:this={fileInputEl} type="file" accept="image/*" multiple onchange={handleFileSelect} class="hidden" />
<input bind:this={cameraInputEl} type="file" accept="image/*" capture="environment" onchange={handleFileSelect} class="hidden" />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 z-[60] flex items-stretch sm:items-center sm:justify-center"
	onclick={handleBackdropClick}
	transition:fade={{ duration: 200 }}
>
	<div class="fixed inset-0 bg-black sm:bg-black/60 sm:backdrop-blur-md" aria-hidden="true"></div>

	<div
		class="relative z-10 w-full h-full sm:h-auto sm:max-w-xl sm:max-h-[85vh] sm:rounded-2xl sm:shadow-2xl sm:ring-1 sm:ring-white/10
			bg-surface flex flex-col overflow-hidden"
		in:fly={{ y: 40, duration: 300, easing: quintOut }}
	>
		<!-- Header -->
		{#snippet navLeft()}
			<NavbarBackLink onClick={handleClose} text="Close" />
		{/snippet}
		{#snippet navRight()}
			{#if phase === 'review' && photoFiles.length > 0 && photoFiles.length < MAX_PHOTOS}
				<Link onClick={() => fileInputEl?.click()}>
					<Icon icon="ph:plus" class="w-5 h-5 mr-1" />
					Add
				</Link>
			{/if}
		{/snippet}
		<Navbar title="Photos" left={navLeft} right={navRight} />

		<!-- Content -->
		<div class="flex-1 flex flex-col overflow-y-auto">
			{#if phase === 'select'}
				<!-- ═══ Select phase ═══ -->
				<div class="flex-1 flex flex-col items-center justify-center px-6 sm:px-8 py-8 sm:py-10 gap-5" in:fade={{ duration: 200 }}>
					<!-- Drag & drop zone (covers the whole content area on desktop) -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="w-full max-w-sm flex flex-col items-center gap-6 py-10 sm:py-14 px-6 rounded-2xl border-2 border-dashed transition-all duration-200
							{draggingOver ? 'border-accent bg-accent/5 scale-[1.02]' : 'border-border/40 sm:hover:border-accent/30'}"
						ondragover={(e) => { e.preventDefault(); draggingOver = true; }}
						ondragleave={() => { draggingOver = false; }}
						ondrop={handleDrop}
					>
						<div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
							<Icon icon={draggingOver ? 'ph:arrow-down-bold' : 'ph:camera'} class="text-3xl text-primary" />
						</div>

						<div class="text-center">
							<p class="text-[15px] font-semibold text-primary">Add photos</p>
							<p class="text-[13px] text-muted mt-1">Up to {MAX_PHOTOS} photos at once</p>
							<p class="hidden sm:block text-[12px] text-muted/50 mt-1">Drag & drop images here</p>
						</div>

						<!-- Action buttons -->
						<div class="flex flex-col sm:flex-row items-center gap-3 w-full max-w-xs">
							<div class="sm:hidden w-full">
								<Button large rounded onClick={() => cameraInputEl?.click()}>
									<Icon icon="ph:camera" class="text-lg mr-2" />
									Take Photo
								</Button>
							</div>
							<div class="w-full">
								<Button large rounded outline onClick={() => fileInputEl?.click()}>
									<Icon icon="ph:folder-open" class="text-lg mr-2" />
									Browse Files
								</Button>
							</div>
						</div>
					</div>

					<!-- Keyboard hint on desktop -->
					<p class="hidden sm:block text-[11px] text-muted/50">
						Press <kbd class="px-1.5 py-0.5 bg-card border border-border/60 rounded text-[10px] font-mono">Esc</kbd> to cancel
					</p>
				</div>

			{:else if phase === 'review'}
				<!-- ═══ Review phase ═══ -->
				<div class="flex-1 flex flex-col px-5 sm:px-6 py-5 gap-4" in:fly={{ y: 20, duration: 250, easing: quintOut }}>
					<!-- Photo grid -->
					<div class={photoFiles.length === 1
						? 'flex justify-center'
						: photoFiles.length === 2
							? 'grid grid-cols-2 gap-2.5'
							: 'grid grid-cols-3 gap-2.5'}>
						{#each photoPreviews as preview, i (preview)}
							<div class="relative group/thumb {photoFiles.length === 1 ? 'max-w-xs w-full' : ''}">
								<img
									src={preview}
									alt="Photo {i + 1}"
									class="w-full rounded-xl object-cover ring-1 ring-border/20 shadow-sm
										{photoFiles.length === 1 ? 'max-h-72 sm:max-h-80' : photoFiles.length <= 2 ? 'h-44 sm:h-56' : 'h-28 sm:h-36'}"
								/>
								<!-- Remove button -->
								<button onclick={() => removePhoto(i)}
									class="absolute -top-2 -right-2 w-7 h-7 bg-black/70 backdrop-blur-sm text-white rounded-full text-xs
										flex items-center justify-center shadow-lg border border-white/20
										opacity-80 sm:opacity-0 sm:group-hover/thumb:opacity-100 transition-all duration-150
										hover:bg-[color:var(--color-delete-action)] active:scale-90"
									aria-label="Remove photo">
									<Icon icon="ph:x-bold" class="text-[11px]" />
								</button>
								<!-- Photo number badge -->
								{#if photoFiles.length > 1}
									<div class="absolute bottom-1.5 left-1.5 w-5 h-5 bg-black/60 backdrop-blur-sm rounded-full
										flex items-center justify-center border border-white/20">
										<span class="text-[9px] font-bold text-white">{i + 1}</span>
									</div>
								{/if}
							</div>
						{/each}

						<!-- Add more tile (when under max) -->
						{#if photoFiles.length > 0 && photoFiles.length < MAX_PHOTOS}
							<button
								onclick={() => fileInputEl?.click()}
								class="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border/40
									hover:border-accent/40 hover:bg-accent/5 transition-all active:scale-95
									{photoFiles.length <= 2 ? 'h-44 sm:h-56' : 'h-28 sm:h-36'}"
							>
								<Icon icon="ph:plus" class="text-xl text-muted/30" />
								<span class="text-[10px] text-muted/50 font-medium">{photoFiles.length}/{MAX_PHOTOS}</span>
							</button>
						{/if}
					</div>

					<!-- Caption input -->
					<List inset strong outline>
						<ListInput
							outline
							label="Caption"
							type="text"
							placeholder="Add a caption..."
							value={photoCaption}
							onInput={(e) => { photoCaption = e.target.value; }}
							clearButton={photoCaption.length > 0}
							onClear={() => { photoCaption = ''; }}
						/>
					</List>

					<!-- Spacer to push save button down on mobile -->
					<div class="flex-1 min-h-4"></div>
				</div>
			{/if}
		</div>

		<!-- Save footer (review phase only) -->
		{#if phase === 'review' && photoFiles.length > 0}
			<div class="p-4 pb-safe border-t border-border-light">
				<Button large rounded onClick={submitPhotos} disabled={busy}>
					{#if busy}
						<Icon icon="ph:circle-notch-bold" class="text-lg animate-spin mr-2" />
						Uploading...
					{:else}
						{photoFiles.length > 1 ? `Save ${photoFiles.length} Photos` : 'Save Photo'}
					{/if}
				</Button>
			</div>
		{/if}
	</div>
</div>

<style>
	.pb-safe {
		padding-bottom: max(env(safe-area-inset-bottom, 0px), 1rem);
	}
</style>
