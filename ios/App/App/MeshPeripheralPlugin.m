#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Capacitor discovers plugin methods through the Objective-C runtime, so a
// Swift plugin still needs this macro block to be callable from JavaScript.
// Without it the class compiles, registers, and every call fails as "not
// implemented".
CAP_PLUGIN(MeshPeripheralPlugin, "MeshPeripheral",
    CAP_PLUGIN_METHOD(startAdvertising, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopAdvertising, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(notify, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getSubscribers, CAPPluginReturnPromise);
)
