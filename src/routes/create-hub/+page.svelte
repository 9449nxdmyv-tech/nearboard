<script lang="ts">
  import { goto } from '$app/navigation';
  import { saveHub } from '$lib/db/localDb';
  import { loadHubs } from '$lib/stores/hubs';
  import { deriveHubId, hubJoinUrl } from '$lib/domain/hubId';
  import { getOrCreateSigningIdentity } from '$lib/crypto/signing';
  import type { Hub } from '$lib/domain/types';

  let name = $state('');
  let description = $state('');
  let createdHub = $state<Hub | null>(null);
  let qrDataUrl = $state('');

  async function handleSubmit() {
    if (!name.trim()) return;

    const hub: Hub = {
      // Derived from the name, so anyone who knows the name reaches this
      // same board rather than creating a parallel one.
      hubId: await deriveHubId(name),
      name: name.trim(),
      description: description.trim() || undefined,
      createdAt: Date.now(),
      isOwned: true,
      // Creating a board makes you the curator others will honour.
      curatorId: getOrCreateSigningIdentity().authorId
    };

    await saveHub(hub);
    await loadHubs();
    createdHub = hub;

    try {
      const QRCode = (await import('qrcode')).default;
      qrDataUrl = await QRCode.toDataURL(
        hubJoinUrl(location.origin, hub.hubId, hub.name),
        {
          width: 200,
          margin: 2,
          color: { dark: '#ccc', light: '#0a0a0a' }
        }
      );
    } catch {
      // QR generation is optional
    }
  }
</script>

{#if !createdHub}
  <div class="animate-in">
    <h1 style="font-size: 18px; font-weight: 400; margin-bottom: 24px;">start a hub</h1>

    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="flex flex-col gap-4">
      <div>
        <label for="name">hub name *</label>
        <input id="name" bind:value={name} placeholder="e.g. Coffee Shop Wall" maxlength="60" required />
      </div>

      <div>
        <label for="desc">description (optional)</label>
        <input id="desc" bind:value={description} placeholder="e.g. Leave a note for other regulars" maxlength="200" />
      </div>

      <div class="flex flex-col gap-3 mt-2">
        <button type="submit" class="primary w-full" disabled={!name.trim()}>create hub</button>
        <button type="button" class="ghost w-full" onclick={() => goto('/')}>cancel</button>
      </div>
    </form>
  </div>

{:else}
  <div class="text-center animate-in" style="padding-top: 40px;">
    <h1 style="font-size: 18px; font-weight: 400; margin-bottom: 8px;">hub created</h1>
    <p class="text-muted mb-6">{createdHub.name}</p>

    {#if qrDataUrl}
      <div class="mb-6">
        <p class="text-xs text-tertiary mb-3" style="text-transform: uppercase; letter-spacing: 0.08em;">
          share with nearby people
        </p>
        <img
          src={qrDataUrl}
          alt="QR code"
          style="border-radius: 2px; width: 200px; height: 200px; margin: 0 auto; display: block;"
        />
      </div>
    {/if}

    <p class="text-xs text-tertiary mb-6" style="max-width: 280px; margin-inline: auto; line-height: 1.6;">
      Anyone who scans this — or types the same hub name — reaches this board.
      Posts sync over Bluetooth when you are near each other.
    </p>

    <button class="primary w-full" onclick={() => goto(`/hub/${createdHub!.hubId}`)}>
      go to hub
    </button>
  </div>
{/if}
