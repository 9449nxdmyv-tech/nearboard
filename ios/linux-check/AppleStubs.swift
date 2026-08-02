// Type-level stubs for the Apple/Capacitor surface MeshPeripheralPlugin uses.
//
// CoreBluetooth and Capacitor do not exist on Linux, so the plugin cannot be
// typechecked against the real SDK here. These declarations mirror the exact
// signatures the plugin calls, which is enough for the compiler to catch a
// misspelled method, a wrong argument label, a bad delegate signature, or a
// type mismatch — the errors that otherwise surface only when Xcode is opened.
//
// Signatures transcribed from Apple's published API. If one is wrong, the
// typecheck is checking against a fiction, so a clean result here means "no
// obvious errors", not "will compile".

import Foundation

// MARK: - CoreBluetooth

public class CBUUID {
    public init(string: String) {}
}

public enum CBManagerState {
    case unknown, resetting, unsupported, unauthorized, poweredOff, poweredOn
}

public struct CBCharacteristicProperties: OptionSet {
    public let rawValue: UInt
    public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let write = CBCharacteristicProperties(rawValue: 1)
    public static let writeWithoutResponse = CBCharacteristicProperties(rawValue: 2)
    public static let notify = CBCharacteristicProperties(rawValue: 4)
}

public struct CBAttributePermissions: OptionSet {
    public let rawValue: UInt
    public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let readable = CBAttributePermissions(rawValue: 1)
    public static let writeable = CBAttributePermissions(rawValue: 2)
}

public class CBCharacteristic {
    public var uuid: CBUUID { CBUUID(string: "") }
}

public class CBMutableCharacteristic: CBCharacteristic {
    public init(type: CBUUID, properties: CBCharacteristicProperties, value: Data?, permissions: CBAttributePermissions) {}
}

public class CBService {}

public class CBMutableService: CBService {
    public var characteristics: [CBCharacteristic]?
    public init(type: CBUUID, primary: Bool) {}
}

public class CBCentral {
    public var identifier: UUID { UUID() }
    public var maximumUpdateValueLength: Int { 0 }
}

public class CBATTRequest {
    public var central: CBCentral { CBCentral() }
    public var value: Data?
}

public enum CBATTError {
    public enum Code { case success }
}

public let CBAdvertisementDataServiceUUIDsKey = "kCBAdvDataServiceUUIDs"
public let CBAdvertisementDataLocalNameKey = "kCBAdvDataLocalName"
public let CBPeripheralManagerOptionShowPowerAlertKey = "kCBPeripheralManagerOptionShowPowerAlert"

public protocol CBPeripheralManagerDelegate: AnyObject {
    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager)
}

public class CBPeripheralManager {
    public var state: CBManagerState { .poweredOn }
    public init(delegate: CBPeripheralManagerDelegate?, queue: DispatchQueue?, options: [String: Any]?) {}
    public func startAdvertising(_ advertisementData: [String: Any]?) {}
    public func stopAdvertising() {}
    public func add(_ service: CBMutableService) {}
    public func removeAllServices() {}
    public func updateValue(_ value: Data, for characteristic: CBMutableCharacteristic, onSubscribedCentrals centrals: [CBCentral]?) -> Bool { true }
    public func respond(to request: CBATTRequest, withResult result: CBATTError.Code) {}
}

// MARK: - Capacitor

public class CAPPluginCall {
    public func getString(_ key: String) -> String? { nil }
    public func getString(_ key: String, _ defaultValue: String) -> String { defaultValue }
    public func resolve() {}
    public func resolve(_ data: [String: Any]) {}
    public func reject(_ message: String) {}
    public func keepAlive(_ keepAlive: Bool) {}
}

open class CAPPlugin: NSObject {
    public func notifyListeners(_ eventName: String, data: [String: Any]) {}
}
