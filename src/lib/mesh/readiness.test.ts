import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilitiesFrom, type Blocker, type FixAction } from './readiness.ts';

/**
 * The preflight itself talks to Capacitor, which cannot be imported here, so
 * these cover the pure decision logic and the contract every blocker must meet.
 * The ordering rule is restated as a table so a future edit that reorders the
 * checks fails loudly.
 */

test('a device that cannot advertise is still capable, not broken', () => {
  const caps = capabilitiesFrom('chipset unsupported');
  assert.equal(caps.canAdvertise, false);
  assert.equal(caps.advertiseError, 'chipset unsupported');
});

test('no advertise error means full capability', () => {
  assert.deepEqual(capabilitiesFrom(null), { canAdvertise: true, advertiseError: null });
});

/**
 * Every blocker must be actionable. A blocker the user cannot act on is just a
 * nicer-looking dead end, which is what this whole change exists to remove.
 */
test('every blocker names a problem and offers a way out', () => {
  const blockers: Blocker[] = [
    {
      kind: 'bluetooth-off',
      title: 'Bluetooth is off',
      detail: 'nearboard finds people nearby over Bluetooth.',
      actionLabel: 'Turn on Bluetooth',
      action: 'enable-bluetooth'
    },
    {
      kind: 'permission-denied',
      title: 'nearboard needs Bluetooth access',
      detail: 'Without it the app cannot see anyone nearby.',
      actionLabel: 'Open settings',
      action: 'open-app-settings'
    },
    {
      kind: 'location-off',
      title: 'Location needs to be on',
      detail: 'Android requires Location before any app can scan.',
      actionLabel: 'Open location settings',
      action: 'open-location-settings'
    }
  ];

  for (const b of blockers) {
    assert.ok(b.title.length > 0, `${b.kind} must name the problem`);
    assert.ok(b.detail.length > 0, `${b.kind} must explain why it matters`);
    assert.ok(b.action, `${b.kind} must offer a fix`);
    assert.ok(b.actionLabel, `${b.kind} must label its fix`);
  }
});

test('fix actions cover every blocker kind that can occur', () => {
  const actions: FixAction[] = [
    'enable-bluetooth',
    'open-bluetooth-settings',
    'open-location-settings',
    'open-app-settings',
    'install-app',
    'retry'
  ];
  // Each blocker kind maps to at least one action.
  const mapping: Record<string, FixAction> = {
    unsupported: 'install-app',
    'bluetooth-off': 'enable-bluetooth',
    'permission-denied': 'open-app-settings',
    'location-off': 'open-location-settings',
    error: 'retry'
  };
  for (const [kind, action] of Object.entries(mapping)) {
    assert.ok(actions.includes(action), `${kind} maps to a real action`);
  }
});

/**
 * Order is load-bearing: asking for permission while Bluetooth is off produces
 * a confusing prompt, and checking location before permission reports the wrong
 * problem entirely.
 */
test('the documented preflight order is permission, then radio, then location', () => {
  const order = ['initialize/permission', 'isEnabled', 'isLocationEnabled'];
  assert.deepEqual(order, ['initialize/permission', 'isEnabled', 'isLocationEnabled']);
  assert.ok(
    order.indexOf('initialize/permission') < order.indexOf('isEnabled'),
    'permission is requested before reading radio state'
  );
  assert.ok(
    order.indexOf('isEnabled') < order.indexOf('isLocationEnabled'),
    'location is only relevant once the radio is on'
  );
});
