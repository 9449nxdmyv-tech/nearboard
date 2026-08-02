package app.nearboard.app;

import android.Manifest;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
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
 * The central half of the mesh.
 *
 * WHY THIS EXISTS
 * ---------------
 * @capacitor-community/bluetooth-le handles the central role well enough for
 * the job it was written for — talking to a fixed peripheral like a heart-rate
 * monitor — but not for peers. It resolves a device with
 *
 *     bluetoothAdapter.getRemoteDevice(address)
 *
 * which always assumes a PUBLIC address type. Android advertises with a RANDOM
 * address, and rotates it for privacy. Two consequences, both fatal here:
 *
 *   - the connection targets the right bytes with the wrong address type, so
 *     the controller never finds the peer and the attempt times out;
 *   - by the time a connect is issued, the scanned address may already have
 *     been rotated away.
 *
 * Observed exactly that between two Fire tablets: discovery worked every time,
 * the peer's address changed between attempts (5D:02:99:0D:3E:3E, then
 * 7a:00:49:08:53:29), and every connection failed with GATT 133.
 *
 * The fix is to hold the BluetoothDevice handed over by the scan rather than
 * rebuilding one from a string. That object carries the address type with it
 * and refers to the peer as it was actually seen.
 */
@CapacitorPlugin(
    name = "MeshCentral",
    permissions = {
        @Permission(alias = "scan", strings = { Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = "connect", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class MeshCentralPlugin extends Plugin {

    private static final UUID CCC_DESCRIPTOR_UUID =
        UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private BluetoothManager bluetoothManager;
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;

    /** Devices seen in the current scan, as the scanner handed them to us. */
    private final Map<String, BluetoothDevice> seen = new HashMap<>();
    /** Live connections, keyed by address. */
    private final Map<String, BluetoothGatt> connections = new HashMap<>();
    /** Inbound characteristic per connection, for writing frames out. */
    private final Map<String, BluetoothGattCharacteristic> writeChars = new HashMap<>();
    /** Calls waiting on a connection to become usable. */
    private final Map<String, PluginCall> pendingConnects = new HashMap<>();

    private UUID serviceUuid;
    private UUID inboundUuid;
    private UUID outboundUuid;

    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        bluetoothManager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
    }

    // ---- Plugin API ----

    @PluginMethod
    public void startScan(PluginCall call) {
        String service = call.getString("serviceUuid");
        String inbound = call.getString("inboundUuid");
        String outbound = call.getString("outboundUuid");
        if (service == null || inbound == null || outbound == null) {
            call.reject("serviceUuid, inboundUuid and outboundUuid are required");
            return;
        }

        if (bluetoothManager == null || bluetoothManager.getAdapter() == null) {
            call.reject("Bluetooth is not available");
            return;
        }
        if (!bluetoothManager.getAdapter().isEnabled()) {
            call.reject("Bluetooth is turned off");
            return;
        }

        try {
            serviceUuid = UUID.fromString(service);
            inboundUuid = UUID.fromString(inbound);
            outboundUuid = UUID.fromString(outbound);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid UUID: " + e.getMessage());
            return;
        }

        scanner = bluetoothManager.getAdapter().getBluetoothLeScanner();
        if (scanner == null) {
            call.reject("Scanner unavailable");
            return;
        }

        stopScanInternal();

        List<ScanFilter> filters = new ArrayList<>();
        filters.add(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(serviceUuid)).build());

        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build();

        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice device = result.getDevice();
                String address = device.getAddress();

                // Keep the object, not the string. This is the whole point: it
                // carries the address type and refers to the peer as seen.
                boolean isNew = seen.put(address, device) == null;
                if (isNew) {
                    JSObject event = new JSObject();
                    event.put("deviceId", address);
                    event.put("rssi", result.getRssi());
                    notifyListeners("peerFound", event);
                }
            }

            @Override
            public void onScanFailed(int errorCode) {
                JSObject event = new JSObject();
                event.put("error", "scan failed: " + errorCode);
                notifyListeners("scanFailed", event);
            }
        };

        scanner.startScan(filters, settings, scanCallback);
        call.resolve();
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        stopScanInternal();
        call.resolve();
    }

    /**
     * Connect to a peer seen in the current scan.
     *
     * Resolves once the service is discovered and notifications are live, not
     * merely when the link is up — a caller that starts writing at
     * STATE_CONNECTED writes into a GATT table that has not been read yet.
     */
    @PluginMethod
    public void connectPeer(PluginCall call) {
        String deviceId = call.getString("deviceId");
        if (deviceId == null) {
            call.reject("deviceId is required");
            return;
        }

        BluetoothDevice device = seen.get(deviceId);
        if (device == null) {
            call.reject("Unknown peer " + deviceId + " — it must be seen in a scan first");
            return;
        }

        if (connections.containsKey(deviceId)) {
            call.resolve();
            return;
        }

        // Scanning while connecting is a documented way to produce GATT 133.
        stopScanInternal();

        call.setKeepAlive(true);
        pendingConnects.put(deviceId, call);

        main.post(() -> {
            BluetoothGatt gatt;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                gatt = device.connectGatt(getContext(), false, gattCallback, BluetoothDevice.TRANSPORT_LE);
            } else {
                gatt = device.connectGatt(getContext(), false, gattCallback);
            }
            if (gatt == null) {
                finishConnect(deviceId, false, "connectGatt returned null");
            } else {
                connections.put(deviceId, gatt);
            }
        });
    }

    @PluginMethod
    public void disconnectPeer(PluginCall call) {
        String deviceId = call.getString("deviceId");
        if (deviceId != null) closeConnection(deviceId);
        call.resolve();
    }

    /** Write one frame to a connected peer's inbound characteristic. */
    @PluginMethod
    public void writePeer(PluginCall call) {
        String deviceId = call.getString("deviceId");
        String data = call.getString("data");
        if (deviceId == null || data == null) {
            call.reject("deviceId and data are required");
            return;
        }

        BluetoothGatt gatt = connections.get(deviceId);
        BluetoothGattCharacteristic characteristic = writeChars.get(deviceId);
        if (gatt == null || characteristic == null) {
            call.reject("Not connected to " + deviceId);
            return;
        }

        byte[] payload;
        try {
            payload = Base64.decode(data, Base64.NO_WRAP);
        } catch (IllegalArgumentException e) {
            call.reject("data must be valid base64");
            return;
        }

        boolean ok;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ok = gatt.writeCharacteristic(
                characteristic, payload,
                BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            ) == BluetoothGatt.GATT_SUCCESS;
        } else {
            characteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
            characteristic.setValue(payload);
            ok = gatt.writeCharacteristic(characteristic);
        }

        if (ok) {
            call.resolve();
        } else {
            call.reject("write rejected by the stack");
        }
    }

    @PluginMethod
    public void getConnectedPeers(PluginCall call) {
        JSObject result = new JSObject();
        result.put("deviceIds", new ArrayList<>(connections.keySet()));
        call.resolve(result);
    }

    // ---- GATT client ----

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {

        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            String address = gatt.getDevice().getAddress();

            if (newState == BluetoothGatt.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                // Ask for a larger MTU before discovering. A 150 KB post at the
                // default leaves over a thousand round trips.
                gatt.requestMtu(517);
                return;
            }

            if (newState == BluetoothGatt.STATE_DISCONNECTED) {
                finishConnect(address, false, "disconnected (status " + status + ")");
                closeConnection(address);
                JSObject event = new JSObject();
                event.put("deviceId", address);
                notifyListeners("peerLost", event);
            }
        }

        @Override
        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            // Proceed regardless: a refused MTU is not fatal, it just means
            // smaller fragments.
            gatt.discoverServices();
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            String address = gatt.getDevice().getAddress();

            if (status != BluetoothGatt.GATT_SUCCESS) {
                finishConnect(address, false, "service discovery failed (" + status + ")");
                closeConnection(address);
                return;
            }

            BluetoothGattService service = gatt.getService(serviceUuid);
            if (service == null) {
                finishConnect(address, false, "peer does not expose the mesh service");
                closeConnection(address);
                return;
            }

            BluetoothGattCharacteristic inbound = service.getCharacteristic(inboundUuid);
            BluetoothGattCharacteristic outbound = service.getCharacteristic(outboundUuid);
            if (inbound == null || outbound == null) {
                finishConnect(address, false, "mesh characteristics missing");
                closeConnection(address);
                return;
            }

            writeChars.put(address, inbound);

            // Subscribing takes two steps: tell the local stack, then write the
            // descriptor so the peer actually starts sending. Skipping the
            // second is a classic silent failure — everything looks connected
            // and no notification ever arrives.
            gatt.setCharacteristicNotification(outbound, true);
            BluetoothGattDescriptor ccc = outbound.getDescriptor(CCC_DESCRIPTOR_UUID);
            if (ccc != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    gatt.writeDescriptor(ccc, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                } else {
                    ccc.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    gatt.writeDescriptor(ccc);
                }
                // Completion is reported in onDescriptorWrite.
            } else {
                finishConnect(address, true, null);
            }
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            String address = gatt.getDevice().getAddress();
            if (CCC_DESCRIPTOR_UUID.equals(descriptor.getUuid())) {
                finishConnect(address, status == BluetoothGatt.GATT_SUCCESS,
                    status == BluetoothGatt.GATT_SUCCESS ? null : "could not subscribe (" + status + ")");
            }
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            emitFrame(gatt, characteristic.getValue());
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
            emitFrame(gatt, value);
        }
    };

    private void emitFrame(BluetoothGatt gatt, byte[] value) {
        if (value == null || value.length == 0) return;
        JSObject event = new JSObject();
        event.put("deviceId", gatt.getDevice().getAddress());
        event.put("data", Base64.encodeToString(value, Base64.NO_WRAP));
        notifyListeners("frameReceived", event);
    }

    // ---- helpers ----

    private void finishConnect(String address, boolean ok, String error) {
        PluginCall call = pendingConnects.remove(address);
        if (call == null) return;
        if (ok) {
            JSObject event = new JSObject();
            event.put("deviceId", address);
            notifyListeners("peerReady", event);
            call.resolve();
        } else {
            call.reject(error == null ? "connection failed" : error);
        }
        call.setKeepAlive(false);
    }

    private void closeConnection(String address) {
        BluetoothGatt gatt = connections.remove(address);
        writeChars.remove(address);
        if (gatt != null) {
            try {
                gatt.disconnect();
                gatt.close();
            } catch (SecurityException ignored) {
                // Permission revoked mid-flight.
            }
        }
    }

    private void stopScanInternal() {
        if (scanner != null && scanCallback != null) {
            try {
                scanner.stopScan(scanCallback);
            } catch (Exception ignored) {
                // Not scanning.
            }
            scanCallback = null;
        }
    }
}
