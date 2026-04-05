<!--
  @file AgeGate.svelte
  @description Birthday picker that validates age before allowing account setup.
               Blocks under-13, flags teens (13–17) for restricted features.
-->
<script lang="ts">
	import { calculateAge } from '$lib/firebase/userService';
	import { MIN_AGE } from '$lib/config/constants';

	let { onVerified }: { onVerified: (birthDate: Date) => void } = $props();

	let year = $state('');
	let month = $state('');
	let day = $state('');
	let error = $state<string | null>(null);

	const currentYear = new Date().getFullYear();

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		error = null;

		const y = parseInt(year, 10);
		const m = parseInt(month, 10);
		const d = parseInt(day, 10);

		if (!y || !m || !d || y < 1900 || y > currentYear || m < 1 || m > 12 || d < 1 || d > 31) {
			error = 'Please enter a valid date of birth.';
			return;
		}

		const birthDate = new Date(y, m - 1, d);
		// Validate the date is real (e.g. not Feb 30)
		if (birthDate.getFullYear() !== y || birthDate.getMonth() !== m - 1 || birthDate.getDate() !== d) {
			error = 'Please enter a valid date of birth.';
			return;
		}

		const age = calculateAge(birthDate);
		if (age < MIN_AGE) {
			error = `You must be at least ${MIN_AGE} years old to use Nearboard.`;
			return;
		}

		onVerified(birthDate);
	}
</script>

<div class="flex flex-col gap-4">
	<div class="text-center">
		<h2 class="font-display text-lg font-semibold text-primary">When were you born?</h2>
		<p class="text-sm text-muted mt-1">We need this to keep Nearboard safe for everyone.</p>
	</div>

	<form onsubmit={handleSubmit} class="flex flex-col gap-3">
		<div class="flex gap-2">
			<input
				type="number"
				bind:value={month}
				placeholder="MM"
				min="1"
				max="12"
				required
				class="flex-1 py-3 px-4 border border-border rounded-lg text-sm bg-surface text-center
					placeholder:text-muted focus:outline-none focus:border-accent transition-colors"
			/>
			<input
				type="number"
				bind:value={day}
				placeholder="DD"
				min="1"
				max="31"
				required
				class="flex-1 py-3 px-4 border border-border rounded-lg text-sm bg-surface text-center
					placeholder:text-muted focus:outline-none focus:border-accent transition-colors"
			/>
			<input
				type="number"
				bind:value={year}
				placeholder="YYYY"
				min="1900"
				max={currentYear}
				required
				class="flex-[1.5] py-3 px-4 border border-border rounded-lg text-sm bg-surface text-center
					placeholder:text-muted focus:outline-none focus:border-accent transition-colors"
			/>
		</div>

		{#if error}
			<p class="text-error text-sm text-center">{error}</p>
		{/if}

		<button
			type="submit"
			class="w-full py-3 bg-accent text-white rounded-lg font-medium
				active:scale-[0.98] transition-transform"
		>
			Continue
		</button>
	</form>

	<p class="text-xs text-muted text-center leading-relaxed">
		Your birth date is used only to verify your age.
		We don't share it or use it for advertising.
	</p>
</div>
