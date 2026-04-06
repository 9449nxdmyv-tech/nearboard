<!--
  @file today/+page.svelte
  @description Today dashboard — daily digest with reminders, briefings, voice notes, streaks.
-->
<script lang="ts">
	import { boardStore, userStore, loadTodayData } from '$lib/stores';
	import { Page } from 'konsta/svelte';
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
</script>

<Page>
	<Header title="Today" />

	<PullToRefresh onRefresh={async () => { loadTodayData($boardStore.boards, $userStore.user?.uid); }}>
		<main class="flex-1 px-4 pb-6">
			<TodayDashboard />
		</main>
	</PullToRefresh>
</Page>
