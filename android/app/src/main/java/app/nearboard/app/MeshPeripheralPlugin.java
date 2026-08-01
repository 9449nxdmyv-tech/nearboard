package app.nearboard.app;

import android.Manifest;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.Context;
import android.os.Build;
import android.os.ParcelUuid;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The peripheral half of the mesh.
 *
 * @capacitor-community/bluetooth-le is central-only — it can connect out but
 * cannot advertise or serve GATT. A mesh needs both roles on every device, so
 * this plugin supplies advertising and the GATT server; the community plugin
 * still handles the central side.
 *
 * Android specifics worth knowing:
 *
 *  - BLUETOOTH_ADVERTISE is required from API 31 (declared in the manifest).
 *  - Sustained scanning and advertising in the background needs a foreground
 *    service, which this plugin does not start. Backgrounded, the mesh will go
 *    quiet — a deliberate scope limit, not an oversight.
 *  - Many chipsets cap concurrent GATT connections around 4-7.
 *  - The advertisement payload is 31 bytes. A 128-bit service UUID uses 18 of
 *    them, so the device name is sent in the scan response rather than the
 *    advertisement, which would otherwise fail to register.
 */
@CapacitorPlugin(
    name = "MeshPeripheral",
    permissions = {
        @Permission(alias = "advertise", strings = { Manifest.permission.BLUETOOTH_ADVERTISE }),
        @Permission(alias = "connect", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class MeshPeripheralPlugin extends Plugin {

    private static final UUID CCC_DESCRIPTOR_UUID =
        UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private BluetoothManager bluetoothManager;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothGattServer gattServer;

    private BluetoothGattCharacteristic outboundCharacteristic;

    /** Centrals subscribed to notifications, keyed by address. */
    private final Map<String, BluetoothDevice> subscribers = new HashMap<>();
    /** Negotiated usable payload per device. */
    private final Map<String, Integer> deviceMtu = new HashMap<>();

    private AdvertiseCallback advertiseCallback;
    private PluginCall startCall;

    @Override
    public void load() {
        bluetoothManager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
    }

    // ---- Plugin API ----

    @PluginMethod
    public void startAdvertising(PluginCall call) {
        String service = call.getString("serviceUuid");
        String inbound = call.getString("inboundUuid");
        String outbound = call.getString("outboundUuid");

        if (service == null || inbound == null || outbound == null) {
            call.reject("serviceUuid, inboundUuid and outboundUuid are required");
            return;
        }

        if (bluetoothManager == null || bluetoothManager.getAdapter() == null) {
            call.reject("Bluetooth is not available on this device");
            return;
        }
        if (!bluetoothManager.getAdapter().isEnabled()) {
            call.reject("Bluetooth is turned off");
            return;
        }

        advertiser = bluetoothManager.getAdapter().getBluetoothLeAdvertiser();
        if (advertiser == null) {
            // Not every chipset supports the peripheral role, and there is no
            // way to know before asking.
            call.reject("This device cannot advertise as a BLE peripheral");
            return;
        }

        try {
            startGattServer(UUID.fromString(service), UUID.fromString(inbound), UUID.fromString(outbound));
        } catch (IllegalArgumentException e) {
            call.reject("Invalid UUID: " + e.getMessage());
            return;
        }

        startCall = call;
        call.setKeepAlive(true);
        beginAdvertising(UUID.fromString(service));
    }

    @PluginMethod
    public void stopAdvertising(PluginCall call) {
        if (advertiser != null && advertiseCallback != null) {
            advertiser.stopAdvertising(advertiseCallback);
            advertiseCallback = null;
        }
        if (gattServer != null) {
            gattServer.close();
            gattServer = null;
        }
        subscribers.clear();
        deviceMtu.clear();
        call.resolve();
    }

    /**
     * Push one frame to subscribed centrals. `centralId` targets a single peer;
     * omitting it broadcasts. The mesh targets, so a relay does not echo a
     * packet back to the peer it came from.
     */
    @PluginMethod
    public void notify(PluginCall call) {
        String base64 = call.getString("data");
        if (base64 == null) {
            call.reject("data is required");
            return;
        }
        if (gattServer == null || outboundCharacteristic == null) {
            call.reject("Not advertising");
            return;
        }

        byte[] payload;
        try {
            payload = Base64.decode(base64, Base64.NO_WRAP);
        } catch (IllegalArgumentException e) {
            call.reject("data must be valid base64");
            return;
        }

        List<BluetoothDevice> targets = new ArrayList<>();
        String centralId = call.getString("centralId");
        if (centralId != null) {
            BluetoothDevice device = subscribers.get(centralId);
            if (device == null) {
                call.reject("Unknown central " + centralId);
                return;
            }
            targets.add(device);
        } else {
            targets.addAll(subscribers.values());
        }

        int sent = 0;
        for (BluetoothDevice device : targets) {
            if (sendNotification(device, payload)) sent++;
        }

        JSObject result = new JSObject();
        result.put("sent", sent);
        call.resolve(result);
    }

    @PluginMethod
    public void getSubscribers(PluginCall call) {
        JSObject result = new JSObject();
        result.put("centralIds", new ArrayList<>(subscribers.keySet()));
        call.resolve(result);
    }

    // ---- GATT server ----

    private void startGattServer(UUID serviceUuid, UUID inboundUuid, UUID outboundUuid) {
        gattServer = bluetoothManager.openGattServer(getContext(), gattServerCallback);

        // Inbound: peers write frames to us. WRITE_NO_RESPONSE avoids an ack per
        // fragment, which would dominate transfer time for a large post.
        BluetoothGattCharacteristic inbound = new BluetoothGattCharacteristic(
            inboundUuid,
            BluetoothGattCharacteristic.PROPERTY_WRITE
                | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        );

        // Outbound: we push frames to peers. Notify inverts the direction a GATT
        // read allows, so a peripheral can initiate.
        outboundCharacteristic = new BluetoothGattCharacteristic(
            outboundUuid,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        );

        // Android requires the Client Characteristic Configuration descriptor to
        // exist before a central can subscribe. Omitting it is a common cause of
        // notifications that register successfully and then never arrive.
        BluetoothGattDescriptor ccc = new BluetoothGattDescriptor(
            CCC_DESCRIPTOR_UUID,
            BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE
        );
        outboundCharacteristic.addDescriptor(ccc);

        BluetoothGattService service =
            new BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        service.addCharacteristic(inbound);
        service.addCharacteristic(outboundCharacteristic);

        gattServer.addService(service);
    }

    private void beginAdvertising(UUID serviceUuid) {
        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(true)
            .setTimeout(0) // advertise until told to stop
            .build();

        // 31-byte budget: a 128-bit UUID takes 18, so the name goes in the scan
        // response. Including both here makes registration fail outright.
        AdvertiseData data = new AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(new ParcelUuid(serviceUuid))
            .build();

        AdvertiseData scanResponse = new AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .build();

        advertiseCallback = new AdvertiseCallback() {
            @Override
            public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                resolveStart();
            }

            @Override
            public void onStartFailure(int errorCode) {
                rejectStart("Advertising failed: " + describeAdvertiseError(errorCode));
            }
        };

        advertiser.startAdvertising(settings, data, scanResponse, advertiseCallback);
    }

    private final BluetoothGattServerCallback gattServerCallback = new BluetoothGattServerCallback() {

        @Override
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            String address = device.getAddress();
            if (newState == BluetoothGatt.STATE_DISCONNECTED) {
                subscribers.remove(address);
                deviceMtu.remove(address);
                JSObject event = new JSObject();
                event.put("centralId", address);
                notifyListeners("peerDisconnected", event);
            }
        }

        @Override
        public void onMtuChanged(BluetoothDevice device, int mtu) {
            // Reported MTU includes the 3-byte ATT header, which is not usable
            // payload. Store the usable figure so JS fragments to the right size.
            deviceMtu.put(device.getAddress(), Math.max(1, mtu - 3));
        }

        @Override
        public void onCharacteristicWriteRequest(
            BluetoothDevice device,
            int requestId,
            BluetoothGattCharacteristic characteristic,
            boolean preparedWrite,
            boolean responseNeeded,
            int offset,
            byte[] value
        ) {
            if (value != null && value.length > 0) {
                JSObject event = new JSObject();
                event.put("centralId", device.getAddress());
                event.put("data", Base64.encodeToString(value, Base64.NO_WRAP));
                notifyListeners("frameReceived", event);
            }

            if (responseNeeded && gattServer != null) {
                gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null);
            }
        }

        @Override
        public void onDescriptorWriteRequest(
            BluetoothDevice device,
            int requestId,
            BluetoothGattDescriptor descriptor,
            boolean preparedWrite,
            boolean responseNeeded,
            int offset,
            byte[] value
        ) {
            // A central subscribing writes ENABLE_NOTIFICATION_VALUE to the CCC
            // descriptor. This is the only signal that it is ready to receive.
            if (CCC_DESCRIPTOR_UUID.equals(descriptor.getUuid())) {
                boolean enabling = value != null
                    && value.length > 0
                    && value[0] == BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE[0];

                String address = device.getAddress();
                if (enabling) {
                    subscribers.put(address, device);
                    JSObject event = new JSObject();
                    event.put("centralId", address);
                    event.put("mtu", deviceMtu.containsKey(address) ? deviceMtu.get(address) : 20);
                    notifyListeners("peerConnected", event);
                } else {
                    subscribers.remove(address);
                    JSObject event = new JSObject();
                    event.put("centralId", address);
                    notifyListeners("peerDisconnected", event);
                }
            }

            if (responseNeeded && gattServer != null) {
                gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null);
            }
        }
    };

    @SuppressWarnings("deprecation")
    private boolean sendNotification(BluetoothDevice device, byte[] payload) {
        if (gattServer == null || outboundCharacteristic == null) return false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // API 33+ takes the value directly, avoiding the shared-state race
            // in the older setValue-then-notify pattern.
            return gattServer.notifyCharacteristicChanged(device, outboundCharacteristic, false, payload)
                == BluetoothGatt.GATT_SUCCESS;
        }

        outboundCharacteristic.setValue(payload);
        return gattServer.notifyCharacteristicChanged(device, outboundCharacteristic, false);
    }

    // ---- Helpers ----

    private void resolveStart() {
        if (startCall == null) return;
        startCall.resolve();
        startCall.setKeepAlive(false);
        startCall = null;
    }

    private void rejectStart(String message) {
        if (startCall == null) return;
        startCall.reject(message);
        startCall.setKeepAlive(false);
        startCall = null;
    }

    private static String describeAdvertiseError(int code) {
        switch (code) {
            case AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE:
                return "advertisement payload exceeds 31 bytes";
            case AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS:
                return "too many advertisers already running";
            case AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED:
                return "already advertising";
            case AdvertiseCallback.ADVERTISE_FAILED_INTERNAL_ERROR:
                return "internal Bluetooth stack error";
            case AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED:
                return "peripheral role unsupported on this chipset";
            default:
                return "unknown error " + code;
        }
    }
}
