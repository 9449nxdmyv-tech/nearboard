package app.nearboard.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // App-local plugins must be registered before super.onCreate, which is
        // where the bridge is built. Registering after it silently does nothing.
        registerPlugin(MeshPeripheralPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
