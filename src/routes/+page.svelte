<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { hubs, loadHubs } from '$lib/stores/hubs';
  import { isBluetoothSupported, requestDevice, createHubConnection } from '$lib/ble/bleAdapter';
  import { saveHub } from '$lib/db/localDb';
  import { canInstall, triggerInstall } from '$lib/pwa/installPrompt';
  import type { Hub } from '$lib/domain/types';

  let bleSupported = $state(false);
  let isIos = $state(false);
  let scanning = $state(false);
  let error = $state('');

  onMount(async () => {
    bleSupported = isBluetoothSupported();
    isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    await loadHubs();
  });

  async function scanForHub() {
    scanning = true;
    error = '';
    try {
      const device = await requestDevice();
      error = 'connecting...';

      // Retry GATT connect up to 3 times (BLE can be flaky)
      let conn = createHubConnection();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await conn.connect(device);
          break;
        } catch (e) {
          if (attempt < 2) {
            conn = createHubConnection();
            error = `retrying connection (${attempt + 2}/3)...`;
            await new Promise(r => setTimeout(r, 500));
          } else {
            throw e;
          }
        }
      }

      error = 'reading hub info...';
      const meta = await conn!.getHubMeta();
      await conn!.disconnect();

      const hub: Hub = {
        hubId: meta.hubId,
        name: meta.name,
        description: meta.description,
        createdAt: Date.now(),
        isOwned: false
      };
      await saveHub(hub);
      await loadHubs();
      error = '';
      goto(`/hub/${meta.hubId}`);
    } catch (e: any) {
      if (e.name !== 'NotFoundError') {
        error = e.message || 'Failed to connect';
      } else {
        error = '';
      }
    } finally {
      scanning = false;
    }
  }
</script>

<div class="animate-in" style="padding-top: max(40px, env(safe-area-inset-top));">
  <h1 style="font-size: 22px; font-weight: 400; letter-spacing: -0.02em;">nearboard</h1>
  <p class="text-tertiary mt-2" style="line-height: 1.6; max-width: 300px;">
    Local walls for nearby people.<br>
    No accounts. No cloud. No global feed.
  </p>
</div>

{#if $canInstall}
  <div style="border: 1px solid rgba(233, 69, 96, 0.2); padding: 12px; margin-top: 20px; border-radius: 2px;">
    <p class="text-sm text-muted mb-2">Install for the best experience</p>
    <button class="w-full primary" onclick={triggerInstall}>Install app</button>
  </div>
{/if}

{#if isIos && !bleSupported}
  <div style="border: 1px solid rgba(212, 160, 64, 0.2); padding: 12px; margin-top: 12px; border-radius: 2px;">
    <p class="text-sm" style="color: var(--ephemeral);">
      BLE requires Chrome on Android or Bluefy on iOS. You can still browse saved hubs.
    </p>
  </div>
{/if}

<div class="flex flex-col gap-3 mt-8 mb-8">
  {#if bleSupported}
    <button onclick={scanForHub} disabled={scanning} class="w-full">
      {scanning ? 'scanning...' : 'scan for a hub'}
    </button>
  {/if}
  <button class="w-full" onclick={() => goto('/create-hub')}>
    start a hub
  </button>
</div>

{#if error}
  <p class="text-sm text-accent mt-2">{error}</p>
{/if}

{#if $hubs.length > 0}
  <p class="text-xs text-tertiary mb-3" style="text-transform: uppercase; letter-spacing: 0.08em;">
    Your hubs
  </p>
  <div class="stagger">
    {#each $hubs as hub}
      <div
        class="card interactive"
        role="button"
        tabindex="0"
        onclick={() => goto(`/hub/${hub.hubId}`)}
        onkeydown={(e) => e.key === 'Enter' && goto(`/hub/${hub.hubId}`)}
      >
        <div class="flex items-center gap-2">
          <span style="font-weight: 500;">{hub.name}</span>
          {#if hub.isOwned}<span class="badge">yours</span>{/if}
        </div>
        {#if hub.description}
          <p class="text-sm text-muted mt-1">{hub.description}</p>
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <div class="text-center" style="padding: 40px 0; color: var(--text-tertiary);">
    <p>no hubs found</p>
    <p class="text-xs mt-1">start a hub to create a local board</p>
  </div>
{/if}
