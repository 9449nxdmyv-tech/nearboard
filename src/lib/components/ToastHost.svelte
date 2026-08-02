<script lang="ts">
  /**
   * Renders confirmations above everything else.
   *
   * Lives in the root layout so a toast survives navigation — reporting a post
   * moves you nowhere, but blocking someone re-renders the feed underneath, and
   * the confirmation should not vanish with it.
   */
  import { toasts, dismissToast, runUndo } from '$lib/stores/toasts';
</script>

<div class="toast-host" aria-live="polite">
  {#each $toasts as toast (toast.id)}
    <div class="toast">
      <span class="toast-message">{toast.message}</span>
      {#if toast.undo}
        <button class="toast-undo" onclick={() => runUndo(toast)}>undo</button>
      {:else}
        <button
          class="toast-dismiss"
          onclick={() => dismissToast(toast.id)}
          aria-label="Dismiss"
        >×</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toast-host {
    position: fixed;
    left: 0;
    right: 0;
    /* Above the compose button, and clear of the home indicator. */
    bottom: calc(88px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    pointer-events: none;
    z-index: 100;
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 420px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--bg, #141414);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
    animation: toast-in 160ms ease-out;
  }

  .toast-message {
    flex: 1;
    font-size: 13px;
    line-height: 1.4;
  }

  .toast-undo {
    font-size: 12px;
    color: var(--accent);
    padding: 4px 8px;
    min-height: 0;
  }

  .toast-dismiss {
    font-size: 16px;
    line-height: 1;
    color: var(--text-tertiary);
    padding: 2px 6px;
    min-height: 0;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  /* Respect a system preference for less motion. */
  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
