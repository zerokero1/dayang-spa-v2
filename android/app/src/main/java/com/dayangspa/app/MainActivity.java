package com.dayangspa.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BluetoothPrinterPlugin.class);
        registerPlugin(WhatsAppSharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
