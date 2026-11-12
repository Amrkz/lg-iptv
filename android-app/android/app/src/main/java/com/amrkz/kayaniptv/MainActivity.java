package com.amrkz.kayaniptv;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Native ExoPlayer screen for TV boxes whose WebView cannot play IPTV (ClassPro and others).
        registerPlugin(NativePlayerPlugin.class);
        super.onCreate(savedInstanceState);
        // Release must not answer chrome://inspect, even if a debug sync left the flag on.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0) {
            WebView.setWebContentsDebuggingEnabled(false);
        }
    }
}
