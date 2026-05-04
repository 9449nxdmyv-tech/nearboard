<!--
  @file today/+page.svelte
  @description Today dashboard — daily digest with reminders, briefings, voice notes, streaks.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { boardStore, userStore, todayStore, loadTodayData } from '$lib/stores';
	import { Page, Block, Button } from 'konsta/svelte';
	import Header from '$lib/components/ui/Header.svelte';
	import TodayDashboard from '$lib/components/ui/TodayDashboard.svelte';
	import PullToRefresh from '$lib/components/ui/PullToRefresh.svelte';

	let lastBoardKey = $state('');

	$effect(() => {
		const boards = $boardStore.boards;
		const uid = $userStore.user?.uid;
		if (boards.length === 0) return;
		const key = boards.map(b => b.id).sort().join(',');
		if (key !== lastBoardKey) {
			lastBoardKey = key;
			loadTodayData(boards, uid);
		}
	});

	function retry() {
		loadTodayData($boardStore.boards, $userStore.user?.uid);
	}
</script>

<Page>
	<Header title="Today" backHref="/" />

	<PullToRefresh onRefresh={async () => { await loadTodayData($boardStore.boards, $userStore.user?.uid); }}>
		<main class="flex-1 px-4 pb-6">
			{#if $todayStore.error}
				<Block class="!text-center !mt-12">
					<div class="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mx-auto mb-3">
						<Icon icon="ph:warning-circle" class="text-3xl text-error" />
					</div>
					<p class="text-[15px] font-medium text-on-surface">Could not load today</p>
					<p class="text-[13px] text-muted mt-1">{$todayStore.error}</p>
					<div class="mt-4">
						<Button small rounded outline onClick={retry}>Try again</Button>
					</div>
				</Block>
			{:else}
				<TodayDashboard />
			{/if}
		</main>
	</PullToRefresh>
</Page>
