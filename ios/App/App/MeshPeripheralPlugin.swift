import Foundation
import Capacitor
import CoreBluetooth

/**
 * The peripheral half of the mesh.
 *
 * @capacitor-community/bluetooth-le is central-only: it can connect out to
 * something that advertises, but it cannot advertise or serve GATT. That is
 * fine for talking to a dedicated hub and useless for a mesh, where every
 * device must be discoverable by every other. This plugin supplies the missing
 * half; the community plugin still handles the central role.
 *
 * Known iOS constraints, none of which have workarounds:
 *
 *  - Backgrounded, iOS moves the service UUID into the advertisement "overflow
 *    area". Only another iOS device explicitly scanning for that exact UUID can
 *    see it; Android cannot see it at all. Background discovery is therefore
 *    degraded by design, and the app is strongest in the foreground.
 *  - The local name is not advertised in the background.
 *  - Requires `bluetooth-peripheral` in UIBackgroundModes (already set).
 */
@objc(MeshPeripheralPlugin)
public class MeshPeripheralPlugin: CAPPlugin, CBPeripheralManagerDelegate {

    private var manager: CBPeripheralManager?
    private var inboundCharacteristic: CBMutableCharacteristic?
    private var outboundCharacteristic: CBMutableCharacteristic?

    /// Centrals currently subscribed to notifications, keyed by their identifier.
    private var subscribers: [String: CBCentral] = [:]

    /// Notifications iOS refused to send because its queue was full, retried on
    /// `peripheralManagerIsReady`. Without this, a large post silently loses
    /// fragments the moment the queue backs up — which it will, since a 150 KB
    /// post is over a thousand frames.
    private var pendingNotifications: [(data: Data, central: CBCentral?)] = []

    private var serviceUUID: CBUUID?
    private var inboundUUID: CBUUID?
    private var outboundUUID: CBUUID?
    private var localName: String = "nearboard"

    private var startCall: CAPPluginCall?
    private var serviceAdded = false

    // MARK: - Plugin API

    /// Begin advertising and stand up the GATT server.
    @objc func startAdvertising(_ call: CAPPluginCall) {
        guard let service = call.getString("serviceUuid"),
              let inbound = call.getString("inboundUuid"),
              let outbound = call.getString("outboundUuid") else {
            call.reject("serviceUuid, inboundUuid and outboundUuid are required")
            return
        }

        serviceUUID = CBUUID(string: service)
        inboundUUID = CBUUID(string: inbound)
        outboundUUID = CBUUID(string: outbound)
        localName = call.getString("localName") ?? "nearboard"

        // Held until the radio reports poweredOn — resolving now would tell the
        // caller we are advertising before we are.
        startCall = call
        call.keepAlive(true)

        if manager == nil {
            manager = CBPeripheralManager(delegate: self, queue: nil, options: [
                CBPeripheralManagerOptionShowPowerAlertKey: true
            ])
        } else if manager?.state == .poweredOn {
            configureAndAdvertise()
        }
    }

    @objc func stopAdvertising(_ call: CAPPluginCall) {
        manager?.stopAdvertising()
        manager?.removeAllServices()
        serviceAdded = false
        subscribers.removeAll()
        pendingNotifications.removeAll()
        call.resolve()
    }

    /**
     * Push one frame to subscribed centrals.
     *
     * `centralId` targets a single peer; omitting it broadcasts. The mesh uses
     * the targeted form so a relay does not echo a packet back to the peer it
     * came from.
     */
    @objc func notify(_ call: CAPPluginCall) {
        guard let base64 = call.getString("data"),
              let data = Data(base64Encoded: base64) else {
            call.reject("data must be a base64 string")
            return
        }
        guard let characteristic = outboundCharacteristic else {
            call.reject("Not advertising")
            return
        }

        var targets: [CBCentral]? = nil
        if let centralId = call.getString("centralId") {
            guard let central = subscribers[centralId] else {
                call.reject("Unknown central \(centralId)")
                return
            }
            targets = [central]
        }

        let sent = manager?.updateValue(data, for: characteristic, onSubscribedCentrals: targets) ?? false
        if !sent {
            // Queue full. iOS calls peripheralManagerIsReady when it drains.
            pendingNotifications.append((data: data, central: targets?.first))
        }

        call.resolve(["queued": !sent])
    }

    @objc func getSubscribers(_ call: CAPPluginCall) {
        call.resolve(["centralIds": Array(subscribers.keys)])
    }

    // MARK: - CBPeripheralManagerDelegate

    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        switch peripheral.state {
        case .poweredOn:
            configureAndAdvertise()
        case .unauthorized:
            rejectStart("Bluetooth permission denied")
        case .unsupported:
            rejectStart("BLE peripheral role not supported on this device")
        case .poweredOff:
            notifyListeners("stateChange", data: ["state": "poweredOff"])
        default:
            break
        }
    }

    private func configureAndAdvertise() {
        guard let manager = manager,
              let serviceUUID = serviceUUID,
              let inboundUUID = inboundUUID,
              let outboundUUID = outboundUUID else { return }

        if !serviceAdded {
            // Inbound: peers write frames to us. writeWithoutResponse avoids an
            // ack per fragment, which would dominate transfer time.
            let inbound = CBMutableCharacteristic(
                type: inboundUUID,
                properties: [.write, .writeWithoutResponse],
                value: nil,
                permissions: [.writeable]
            )

            // Outbound: we push frames to peers. Notify inverts the direction a
            // GATT read allows, so a peripheral with something to say can say it.
            let outbound = CBMutableCharacteristic(
                type: outboundUUID,
                properties: [.notify],
                value: nil,
                permissions: [.readable]
            )

            let service = CBMutableService(type: serviceUUID, primary: true)
            service.characteristics = [inbound, outbound]

            inboundCharacteristic = inbound
            outboundCharacteristic = outbound

            manager.add(service)
            serviceAdded = true
        }

        manager.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
            CBAdvertisementDataLocalNameKey: localName
        ])
    }

    public func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error = error {
            rejectStart("Failed to advertise: \(error.localizedDescription)")
            return
        }
        resolveStart()
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager,
                                  central: CBCentral,
                                  didSubscribeTo characteristic: CBCharacteristic) {
        let id = central.identifier.uuidString
        subscribers[id] = central
        notifyListeners("peerConnected", data: [
            "centralId": id,
            // Usable notification payload, i.e. MTU minus the ATT header. This
            // is the fragment budget the JS layer must respect.
            "mtu": central.maximumUpdateValueLength
        ])
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager,
                                  central: CBCentral,
                                  didUnsubscribeFrom characteristic: CBCharacteristic) {
        let id = central.identifier.uuidString
        subscribers.removeValue(forKey: id)
        notifyListeners("peerDisconnected", data: ["centralId": id])
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager,
                                  didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            guard let value = request.value else { continue }
            notifyListeners("frameReceived", data: [
                "centralId": request.central.identifier.uuidString,
                "data": value.base64EncodedString()
            ])
        }
        // Only the first request needs a response, and only for .write.
        if let first = requests.first {
            peripheral.respond(to: first, withResult: .success)
        }
    }

    /// iOS drained its notification queue; retry what it refused earlier.
    public func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        guard let characteristic = outboundCharacteristic else { return }

        while !pendingNotifications.isEmpty {
            let next = pendingNotifications[0]
            let targets = next.central.map { [$0] }
            let sent = peripheral.updateValue(next.data, for: characteristic, onSubscribedCentrals: targets)
            if !sent { return } // still full; wait for the next callback
            pendingNotifications.removeFirst()
        }
    }

    // MARK: - Helpers

    private func resolveStart() {
        startCall?.resolve()
        startCall?.keepAlive(false)
        startCall = nil
    }

    private func rejectStart(_ message: String) {
        startCall?.reject(message)
        startCall?.keepAlive(false)
        startCall = nil
        notifyListeners("stateChange", data: ["state": "error", "message": message])
    }
}
