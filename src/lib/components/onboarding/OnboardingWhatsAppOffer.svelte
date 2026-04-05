<!--
  @file OnboardingWhatsAppOffer.svelte
  @description Bottom sheet offering WhatsApp chat import during onboarding.
               Surfaces the existing WhatsAppImportSheet — does not rebuild it.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
	import WhatsAppImportSheet from '$lib/components/ui/WhatsAppImportSheet.svelte';

	interface Props {
		boardId: string;
		onskip: () => void;
		onimport: (event: { authors: string[] }) => void;
	}

	let { boardId, onskip, onimport }: Props = $props();

	let showOffer = $state(true);
	let showImporter = $state(false);

	function handleStartImport() {
		showOffer = false;
		showImporter = true;
	}

	function handleImporterClose() {
		showImporter = false;
		onskip();
	}
</script>

<BottomSheet title="Already planning in WhatsApp?" open={showOffer} onClose={onskip}>
	<div class="flex flex-col items-center text-center gap-4 py-2">
		<div class="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
			<Icon icon="ph:whatsapp-logo-fill" class="text-2xl text-success" />
		</div>
		<p class="text-sm text-primary leading-relaxed">
			Import your chat and we'll turn it into an organized board instantly.
		</p>
		<button
			onclick={handleStartImport}
			class="w-full py-3.5 bg-accent text-white rounded-lg font-medium
				disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
		>
			<Icon icon="ph:upload-simple" class="text-base" />
			Import WhatsApp Chat
		</button>
		<button
			onclick={onskip}
			class="w-full py-2.5 text-muted hover:text-primary transition-colors text-sm"
		>
			Start fresh instead
		</button>
	</div>
</BottomSheet>

{#if showImporter}
	<WhatsAppImportSheet
		open={showImporter}
		{boardId}
		boardName="My Board"
		onClose={handleImporterClose}
	/>
{/if}
