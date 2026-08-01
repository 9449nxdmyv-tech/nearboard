/**
 * A BLE peripheral built on BlueZ's D-Bus API.
 *
 * bleno drives the HCI socket directly, which means competing with bluetoothd
 * for ownership of the adapter. On any modern desktop bluetoothd is always
 * running, and the result is a peripheral that advertises convincingly and then
 * refuses every connection — the phone sees the advertisement, attempts to
 * connect, and times out. Observed exactly that here, in both directions
 * (bleno as peripheral got GATT 133; noble as central got "Command Disallowed").
 *
 * BlueZ's D-Bus interfaces are the supported path on such a system. Registering
 * a GATT application with org.bluez.GattManager1 and an advertisement with
 * org.bluez.LEAdvertisingManager1 asks bluetoothd to do the work on our behalf,
 * so there is nothing to contend over — and it needs no elevated privileges.
 *
 * Exposes the same shape the rest of the anchor node expects: two
 * characteristics, one written to and one notified from.
 */

import dbus from 'dbus-next';

const { Variant } = dbus;
const { Interface, ACCESS_READ, method, property } = dbus.interface;

const BLUEZ = 'org.bluez';
const ADAPTER_IFACE = 'org.bluez.Adapter1';
const GATT_MANAGER_IFACE = 'org.bluez.GattManager1';
const LE_ADVERTISING_MANAGER_IFACE = 'org.bluez.LEAdvertisingManager1';
const DBUS_OM_IFACE = 'org.freedesktop.DBus.ObjectManager';

const APP_PATH = '/app/nearboard';
const SERVICE_PATH = `${APP_PATH}/service0`;
const ADV_PATH = `${APP_PATH}/advertisement0`;

/** The advertisement bluetoothd broadcasts on our behalf. */
class Advertisement extends Interface {
  constructor(path, serviceUuid, localName) {
    super('org.bluez.LEAdvertisement1');
    this.path = path;
    this.serviceUuid = serviceUuid;
    this.localName = localName;
  }

  get Type() {
    return 'peripheral';
  }
  get ServiceUUIDs() {
    return [this.serviceUuid];
  }
  // No LocalName on purpose.
  //
  // An advertisement carries 31 bytes. BlueZ prepends a 3-byte Flags field for
  // a connectable advertisement, and a 128-bit service UUID consumes 18 more,
  // leaving 10 — not enough for a useful name once its own 2-byte header is
  // counted. Including one makes the controller reject the whole advertisement
  // with "Invalid Parameters (0x0d)", which surfaces only as a generic "Failed
  // to register advertisement".
  //
  // Nothing is lost: peers filter on the service UUID, and the hub's name
  // travels inside the protocol where it is not competing for 31 bytes.

  Release() {
    // bluetoothd tells us it has dropped the advertisement.
  }
}

Advertisement.configureMembers({
  properties: {
    Type: { signature: 's', access: ACCESS_READ },
    ServiceUUIDs: { signature: 'as', access: ACCESS_READ }
  },
  methods: {
    Release: { inSignature: '', outSignature: '' }
  }
});

/** A primary GATT service. */
class GattService extends Interface {
  constructor(path, uuid) {
    super('org.bluez.GattService1');
    this.path = path;
    this.uuid = uuid;
  }
  get UUID() {
    return this.uuid;
  }
  get Primary() {
    return true;
  }
}

GattService.configureMembers({
  properties: {
    UUID: { signature: 's', access: ACCESS_READ },
    Primary: { signature: 'b', access: ACCESS_READ }
  }
});

/**
 * A characteristic.
 *
 * `onWrite` receives inbound frames. `notify` pushes outbound ones — BlueZ
 * delivers a notification by emitting PropertiesChanged on Value, which is why
 * the value is held here rather than passed straight through.
 */
class GattCharacteristic extends Interface {
  constructor(path, uuid, flags, servicePath, onWrite) {
    super('org.bluez.GattCharacteristic1');
    this.path = path;
    this.uuid = uuid;
    this.flags = flags;
    this.servicePath = servicePath;
    this.onWrite = onWrite;
    this.value = Buffer.alloc(0);
    this.notifying = false;
  }

  get UUID() {
    return this.uuid;
  }
  get Service() {
    return this.servicePath;
  }
  get Flags() {
    return this.flags;
  }
  get Notifying() {
    return this.notifying;
  }
  get Value() {
    return this.value;
  }

  ReadValue() {
    return this.value;
  }

  WriteValue(value) {
    this.onWrite?.(Buffer.from(value));
  }

  StartNotify() {
    this.notifying = true;
  }

  StopNotify() {
    this.notifying = false;
  }

  /** Push one frame to whoever is subscribed. */
  notify(buffer) {
    if (!this.notifying) return false;
    this.value = Buffer.from(buffer);
    this.emit('PropertiesChanged', 'org.bluez.GattCharacteristic1', {
      Value: new Variant('ay', this.value)
    }, []);
    return true;
  }
}

GattCharacteristic.configureMembers({
  properties: {
    UUID: { signature: 's', access: ACCESS_READ },
    Service: { signature: 'o', access: ACCESS_READ },
    Flags: { signature: 'as', access: ACCESS_READ },
    Notifying: { signature: 'b', access: ACCESS_READ },
    Value: { signature: 'ay', access: ACCESS_READ }
  },
  methods: {
    ReadValue: { inSignature: 'a{sv}', outSignature: 'ay' },
    WriteValue: { inSignature: 'aya{sv}', outSignature: '' },
    StartNotify: { inSignature: '', outSignature: '' },
    StopNotify: { inSignature: '', outSignature: '' }
  }
});

/**
 * The ObjectManager BlueZ reads to learn our GATT tree.
 *
 * RegisterApplication does not take the objects directly; BlueZ calls back into
 * GetManagedObjects to discover them, so this must be exported first.
 */
class GattApplication extends Interface {
  constructor(objects) {
    super(DBUS_OM_IFACE);
    this.objects = objects;
  }

  GetManagedObjects() {
    return this.objects();
  }
}

GattApplication.configureMembers({
  methods: {
    GetManagedObjects: { inSignature: '', outSignature: 'a{oa{sa{sv}}}' }
  }
});

/** Find the first adapter that supports both GATT and advertising. */
async function findAdapter(bus) {
  const root = await bus.getProxyObject(BLUEZ, '/');
  const objects = await root.getInterface(DBUS_OM_IFACE).GetManagedObjects();
  for (const [path, interfaces] of Object.entries(objects)) {
    if (interfaces[GATT_MANAGER_IFACE] && interfaces[LE_ADVERTISING_MANAGER_IFACE]) {
      return path;
    }
  }
  throw new Error('No BlueZ adapter with GattManager1 and LEAdvertisingManager1');
}

/**
 * Stand up a peripheral.
 *
 * Returns handles for pushing outbound frames and shutting down cleanly.
 */
export async function startPeripheral({
  serviceUuid,
  inboundUuid,
  outboundUuid,
  localName,
  onWrite,
  log = () => {}
}) {
  const bus = dbus.systemBus();
  const adapterPath = await findAdapter(bus);
  log('ble', 'adapter', adapterPath);

  // Powered on and discoverable, or the advertisement goes nowhere.
  const adapterObj = await bus.getProxyObject(BLUEZ, adapterPath);
  const props = adapterObj.getInterface('org.freedesktop.DBus.Properties');
  await props.Set(ADAPTER_IFACE, 'Powered', new Variant('b', true));

  const inboundPath = `${SERVICE_PATH}/char0`;
  const outboundPath = `${SERVICE_PATH}/char1`;

  const service = new GattService(SERVICE_PATH, serviceUuid);
  const inbound = new GattCharacteristic(
    inboundPath,
    inboundUuid,
    ['write', 'write-without-response'],
    SERVICE_PATH,
    onWrite
  );
  const outbound = new GattCharacteristic(
    outboundPath,
    outboundUuid,
    ['notify'],
    SERVICE_PATH,
    null
  );

  const managedObjects = () => ({
    [SERVICE_PATH]: {
      'org.bluez.GattService1': {
        UUID: new Variant('s', serviceUuid),
        Primary: new Variant('b', true)
      }
    },
    [inboundPath]: {
      'org.bluez.GattCharacteristic1': {
        UUID: new Variant('s', inboundUuid),
        Service: new Variant('o', SERVICE_PATH),
        Flags: new Variant('as', ['write', 'write-without-response'])
      }
    },
    [outboundPath]: {
      'org.bluez.GattCharacteristic1': {
        UUID: new Variant('s', outboundUuid),
        Service: new Variant('o', SERVICE_PATH),
        Flags: new Variant('as', ['notify'])
      }
    }
  });

  bus.export(SERVICE_PATH, service);
  bus.export(inboundPath, inbound);
  bus.export(outboundPath, outbound);
  bus.export(APP_PATH, new GattApplication(managedObjects));

  const gattManager = adapterObj.getInterface(GATT_MANAGER_IFACE);
  await gattManager.RegisterApplication(APP_PATH, {});
  log('ble', 'gatt', 'application registered with bluetoothd');

  const advertisement = new Advertisement(ADV_PATH, serviceUuid, localName);
  bus.export(ADV_PATH, advertisement);

  const advManager = adapterObj.getInterface(LE_ADVERTISING_MANAGER_IFACE);
  await advManager.RegisterAdvertisement(ADV_PATH, {});
  log('ble', 'advertising', `started as "${localName}"`);

  return {
    /** Push a frame to subscribed centrals. Returns false if nobody is listening. */
    notify: (buffer) => outbound.notify(buffer),
    isSubscribed: () => outbound.notifying,
    async stop() {
      try {
        await advManager.UnregisterAdvertisement(ADV_PATH);
        await gattManager.UnregisterApplication(APP_PATH);
      } catch {
        // Already gone.
      }
      bus.disconnect();
    }
  };
}
