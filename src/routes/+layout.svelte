<script lang="ts">
  import { onMount } from 'svelte';
  import { initInstallPrompt } from '$lib/pwa/installPrompt';
  import { getOrCreateIdentity } from '$lib/crypto/identity';
  import { pruneAllExpired } from '$lib/db/localDb';
  import { page } from '$app/state';
  import '../app.css';
  import ToastHost from '$lib/components/ToastHost.svelte';

  let { children } = $props();

  onMount(() => {
    // Fire-and-forget async setup; the teardown below must be returned
    // synchronously or Svelte cannot use it (an async callback returns a Promise).
    getOrCreateIdentity();
    initInstallPrompt();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js');
    }
    const pruneInterval = setInterval(() => pruneAllExpired(), 30_000);
    return () => clearInterval(pruneInterval);
  });
</script>

<ToastHost />

<div class="container">
  {#key page.url.pathname}
    <div class="animate-in">
      {@render children()}
    </div>
  {/key}
</div>
