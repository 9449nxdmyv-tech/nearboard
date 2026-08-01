import { writable } from 'svelte/store';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

/** Whether the PWA install prompt is available */
export const canInstall = writable(false);

/** Listen for the browser's install prompt and defer it */
export function initInstallPrompt(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    canInstall.set(true);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    canInstall.set(false);
  });
}

/** Trigger the native install dialog */
export async function triggerInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  canInstall.set(false);
  return outcome === 'accepted';
}
