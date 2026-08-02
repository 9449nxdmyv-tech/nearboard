/**
 * Why the mesh is not working, and what the user can do about it.
 *
 * The mesh has one visible symptom for a great many causes: nothing happens.
 * Bluetooth off, permission denied, location services off, a chipset that
 * cannot advertise, and a genuinely empty room all look identical from the
 * outside — the app sits there saying it is looking for people.
 *
 * That ambiguity is the single worst thing about the experience. It cost an
 * afternoon of debugging with a logcat attached; a user has no logcat. So every
 * precondition is checked explicitly, in the order the platform requires, and
 * each failure names itself and carries the one tap that fixes it.
 *
 * The rule this file exists to enforce: never show a resting state that cannot
 * distinguish working from broken.
 */

import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';

const isNative = Capacitor.isNativePlatform();

/** What the user can do about a blocker. The UI maps these to handlers. */
export type FixAction =
  | 'enable-bluetooth'
  | 'open-bluetooth-settings'
  | 'open-location-settings'
  | 'open-app-settings'
  | 'install-app'
  | 'retry';

export type BlockerKind =
  | 'unsupported'
  | 'bluetooth-off'
  | 'permission-denied'
  | 'location-off'
  | 'error';

export interface Blocker {
  kind: BlockerKind;
  /** Short line naming the problem, in the user's terms. */
  title: string;
  /** One sentence on why it is needed — people grant permissions they understand. */
  detail: string;
  actionLabel?: string;
  action?: FixAction;
}

/** Capabilities of this device, once known. */
export interface Capabilities {
  /** Can this device be discovered by others, or only find them? */
  canAdvertise: boolean;
  /** Reason advertising is unavailable, if it is. */
  advertiseError: string | null;
}

const BLOCKERS: Record<Exclude<BlockerKind, 'error'>, Blocker> = {
  unsupported: {
    kind: 'unsupported',
    title: 'This browser cannot join the mesh',
    detail:
      'Browsers can only connect to one device at a time and cannot be discovered by others. Install the app to take part properly.',
    actionLabel: 'Get the app',
    action: 'install-app'
  },
  'bluetooth-off': {
    kind: 'bluetooth-off',
    title: 'Bluetooth is off',
    detail: 'nearboard finds people nearby over Bluetooth. Nothing is sent to a server.',
    actionLabel: 'Turn on Bluetooth',
    action: 'enable-bluetooth'
  },
  'permission-denied': {
    kind: 'permission-denied',
    title: 'nearboard needs Bluetooth access',
    detail:
      'Without it the app cannot see anyone nearby or be seen by them. It is only used to exchange posts with people in range.',
    actionLabel: 'Open settings',
    action: 'open-app-settings'
  },
  'location-off': {
    kind: 'location-off',
    title: 'Location needs to be on',
    detail:
      'Android requires Location to be enabled before any app can scan for Bluetooth devices. nearboard never reads your location.',
    actionLabel: 'Open location settings',
    action: 'open-location-settings'
  }
};

function errorBlocker(message: string): Blocker {
  return {
    kind: 'error',
    title: 'Bluetooth could not start',
    detail: message,
    actionLabel: 'Try again',
    action: 'retry'
  };
}

export interface PreflightResult {
  /** Something the user must fix before the mesh can run at all. */
  blocker: Blocker | null;
  /** Whether this device can use Bluetooth at all. */
  bluetooth: boolean;
}

/**
 * Check every precondition, in platform order, stopping at the first failure.
 *
 * A blocker means "the user can fix this and the mesh cannot run until they
 * do". A missing capability is different: it is a fact about the platform,
 * nothing to fix, and must not stop the parts that do work.
 *
 * That distinction was wrong and it mattered. A browser without Web Bluetooth —
 * iOS Safari, and every browser on a Fire tablet — was treated as blocked, so
 * the mesh never started and the internet transport was unreachable even though
 * it works perfectly there. Bluetooth being absent is a reason to run over the
 * internet, not a reason to run nothing.
 *
 * Order still matters among the real blockers: asking for permission while
 * Bluetooth is off produces a confusing prompt, and checking location before
 * permission reports the wrong problem.
 */
export async function preflight(): Promise<PreflightResult> {
  if (!isNative) {
    const hasWebBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
    // Never a blocker: the internet transport does not need Bluetooth, and a
    // browser cannot install one anyway.
    return { blocker: null, bluetooth: hasWebBluetooth };
  }

  // initialize() both sets up the plugin and requests the runtime permissions.
  // A rejection here is the user declining, not a fault.
  try {
    await BleClient.initialize({ androidNeverForLocation: false });
  } catch (e) {
    const message = (e as Error)?.message ?? '';
    if (/permission|denied/i.test(message)) {
      return { blocker: BLOCKERS['permission-denied'], bluetooth: false };
    }
    return { blocker: errorBlocker(message || 'Could not initialise Bluetooth.'), bluetooth: false };
  }

  try {
    const enabled = await BleClient.isEnabled();
    if (!enabled) return { blocker: BLOCKERS['bluetooth-off'], bluetooth: false };
  } catch (e) {
    return {
      blocker: errorBlocker((e as Error)?.message ?? 'Could not read Bluetooth state.'),
      bluetooth: false
    };
  }

  // Android only, and only below API 31. isLocationEnabled throws on iOS, where
  // the requirement does not exist — treat that as "not applicable".
  if (Capacitor.getPlatform() === 'android') {
    try {
      const locationOn = await BleClient.isLocationEnabled();
      if (!locationOn) return { blocker: BLOCKERS['location-off'], bluetooth: false };
    } catch {
      // Newer Android versions do not tie scanning to location; carry on.
    }
  }

  return { blocker: null, bluetooth: true };
}

/** Run the fix a blocker offers. Returns true if the user may now be unblocked. */
export async function applyFix(action: FixAction): Promise<boolean> {
  switch (action) {
    case 'enable-bluetooth':
      // Android can prompt inline; iOS has no API for it and must go to settings.
      if (Capacitor.getPlatform() === 'android') {
        try {
          await BleClient.requestEnable();
          return true;
        } catch {
          await BleClient.openBluetoothSettings();
          return false;
        }
      }
      await BleClient.openBluetoothSettings();
      return false;

    case 'open-bluetooth-settings':
      await BleClient.openBluetoothSettings();
      return false;

    case 'open-location-settings':
      await BleClient.openLocationSettings();
      return false;

    case 'open-app-settings':
      await BleClient.openAppSettings();
      return false;

    case 'retry':
      return true;

    case 'install-app':
      return false;
  }
}

/**
 * Find out whether this device can advertise.
 *
 * Not a blocker: a device that can only scan is still a useful mesh member, it
 * just cannot be discovered. Worth telling the user plainly rather than leaving
 * them to wonder why nobody finds them.
 */
export function capabilitiesFrom(advertiseError: string | null): Capabilities {
  return {
    canAdvertise: advertiseError === null,
    advertiseError
  };
}
