<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Capacitor } from '@capacitor/core';
  import { hubs, loadHubs } from '$lib/stores/hubs';
  import { meshStatus, ensureMeshStarted } from '$lib/stores/mesh';
  import { mesh } from '$lib/mesh/service';
  import { canInstall, triggerInstall } from '$lib/pwa/installPrompt';

  const isNative = Capacitor.isNativePlatform();

  let isIos = $state(false);
  let webBleSupported = $state(false);
  let connecting = $state(false);
  let error = $state('');

  onMount(async () => {
    isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    webBleSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
    await loadHubs();
    // Native devices discover peers continuously; there is nothing to press.
    if (isNative) await ensureMeshStarted();
  });

  /**
   * Web has no peripheral role and no background scan, so a browser can only
   * join the mesh by the user picking a device from the chooser — which must
   * happen inside a user gesture.
   */
  async function connectFromBrowser() {
    connecting = true;
    error = '';
    try {
      await ensureMeshStarted();
      await mesh.connectToChosenDevice();
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') error = e?.message ?? 'Failed to connect';
    } finally {
      connecting = false;
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

{#if !isNative && !webBleSupported}
  <div style="border: 1px solid rgba(212, 160, 64, 0.2); padding: 12px; margin-top: 12px; border-radius: 2px;">
    <p class="text-sm" style="color: var(--ephemeral);">
      This browser has no Bluetooth. Install the app to join the mesh — you can
      still read hubs you have already joined.
    </p>
  </div>
{/if}

<!-- Mesh state. On native this is ambient: the device is always looking. -->
<div class="mesh-status mt-6" class:live={$meshStatus.peerCount > 0}>
  <span class="mesh-dot" class:pulse={$meshStatus.running && $meshStatus.peerCount === 0}></span>
  {#if !$meshStatus.running}
    <span class="text-sm text-tertiary">mesh off</span>
  {:else if $meshStatus.peerCount === 0}
    <span class="text-sm text-tertiary">looking for people nearby...</span>
  {:else}
    <span class="text-sm">
      {$meshStatus.peerCount} {$meshStatus.peerCount === 1 ? 'person' : 'people'} nearby
    </span>
  {/if}
</div>

{#if $meshStatus.running && !$meshStatus.advertising && isNative}
  <p class="text-xs text-tertiary mt-2" style="line-height: 1.5;">
    This device can find others but cannot be found by them — its Bluetooth
    chipset does not support advertising.
  </p>
{/if}

<div class="flex flex-col gap-3 mt-6 mb-8">
  {#if !isNative && webBleSupported}
    <button onclick={connectFromBrowser} disabled={connecting} class="w-full">
      {connecting ? 'connecting...' : 'connect to someone nearby'}
    </button>
  {/if}
  <button class="w-full" onclick={() => goto('/create-hub')}>
    start a hub
  </button>
</div>

{#if error}
  <p class="text-sm text-accent mt-2">{error}</p>
{:else if $meshStatus.error}
  <p class="text-xs text-tertiary mt-2">{$meshStatus.error}</p>
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
