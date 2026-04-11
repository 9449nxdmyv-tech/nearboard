<!--
  @file ChatInput.svelte
  @description Reusable messenger-style input with auto-growing textarea and circular send button.
               Used by CaptureSheet (lg) and CardComments (sm) for consistent chat UX.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';

	let {
		value = $bindable(''),
		placeholder = 'Message...',
		size = 'sm',
		disabled = false,
		maxlength,
		onsubmit,
		oninput,
		onkeydown
	}: {
		value: string;
		placeholder?: string;
		size?: 'sm' | 'lg';
		disabled?: boolean;
		maxlength?: number;
		onsubmit?: () => void;
		oninput?: () => void;
		onkeydown?: (e: KeyboardEvent) => void;
	} = $props();

	const hasText = $derived(value.trim().length > 0);

	const containerClass = $derived(
		size === 'lg'
			? 'bg-surface-1 rounded-2xl border border-border focus-within:border-accent/50 transition-colors overflow-hidden'
			: 'bg-surface-1 rounded-2xl border border-border/30 focus-within:border-accent/40 transition-colors overflow-hidden'
	);

	const textareaClass = $derived(
		size === 'lg'
			? 'w-full px-4 py-2.5 text-[16px] leading-[22px] bg-transparent resize-none placeholder:text-muted text-on-surface focus:outline-none disabled:opacity-50'
			: 'w-full py-2 pl-3 pr-2 bg-transparent text-[16px] text-on-surface placeholder:text-muted/40 focus:outline-none resize-none'
	);

	const textareaStyle = $derived(
		size === 'lg'
			? 'max-height: 120px; field-sizing: content;'
			: 'field-sizing: content;'
	);

	const btnSize = $derived(size === 'lg' ? 'w-10 h-10' : 'w-8 h-8');
	const iconSize = $derived(size === 'lg' ? 'text-lg' : 'text-sm');
	const minH = $derived(size === 'lg' ? '' : 'min-h-[36px] max-h-[80px]');
</script>

<div class="flex items-end gap-2">
	<div class="flex-1 {containerClass}">
		<textarea
			bind:value
			{placeholder}
			{disabled}
			maxlength={maxlength}
			rows={1}
			class="{textareaClass} {minH}"
			style={textareaStyle}
			oninput={oninput}
			onkeydown={onkeydown}
		></textarea>
	</div>
	{#if hasText}
		<button
			type={onsubmit ? 'button' : 'submit'}
			onclick={onsubmit}
			{disabled}
			class="shrink-0 {btnSize} rounded-full bg-accent text-white flex items-center justify-center
				disabled:opacity-30 active:scale-90 transition-all"
			aria-label="Send"
		>
			<Icon icon="ph:arrow-up-bold" class={iconSize} />
		</button>
	{/if}
</div>
