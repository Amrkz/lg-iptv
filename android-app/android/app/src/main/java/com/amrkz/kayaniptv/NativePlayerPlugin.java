package com.amrkz.kayaniptv;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Iterator;

/** Hands a stream to the native ExoPlayer screen and reports back how it ended. */
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", true);
        call.resolve(r);
    }

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("No stream address");
            return;
        }
        Intent i = new Intent(getContext(), NativePlayerActivity.class);
        i.putExtra(NativePlayerActivity.EXTRA_URL, url);
        i.putExtra(NativePlayerActivity.EXTRA_TITLE, call.getString("title", ""));
        i.putExtra(NativePlayerActivity.EXTRA_SUBTITLE, call.getString("subtitle", ""));
        i.putExtra(NativePlayerActivity.EXTRA_LIVE, Boolean.TRUE.equals(call.getBoolean("live", false)));
        Double pos = call.getDouble("position", 0.0);
        i.putExtra(NativePlayerActivity.EXTRA_POSITION_MS, (long) ((pos == null ? 0 : pos) * 1000));
        String ua = call.getString("userAgent", null);
        if (ua != null && !ua.isEmpty()) i.putExtra(NativePlayerActivity.EXTRA_UA, ua);
        JSObject headers = call.getObject("headers", null);
        if (headers != null) {
            ArrayList<String> kv = new ArrayList<>();
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                String v = headers.optString(k, null);
                if (v != null) { kv.add(k); kv.add(v); }
            }
            i.putStringArrayListExtra(NativePlayerActivity.EXTRA_HEADERS, kv);
        }
        startActivityForResult(call, i, "onPlayerResult");
    }

    @ActivityCallback
    private void onPlayerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        Intent d = result.getData();
        if (d == null) {
            r.put("action", "back");
            r.put("position", 0);
            r.put("duration", 0);
        } else {
            String action = d.getStringExtra(NativePlayerActivity.RES_ACTION);
            r.put("action", action == null ? "back" : action);
            r.put("position", d.getLongExtra(NativePlayerActivity.RES_POSITION_MS, 0) / 1000.0);
            r.put("duration", d.getLongExtra(NativePlayerActivity.RES_DURATION_MS, 0) / 1000.0);
            r.put("started", d.getBooleanExtra(NativePlayerActivity.RES_STARTED, false));
            String err = d.getStringExtra(NativePlayerActivity.RES_ERROR);
            if (err != null) r.put("error", err);
            int status = d.getIntExtra(NativePlayerActivity.RES_HTTP, 0);
            if (status != 0) r.put("httpStatus", status);
        }
        call.resolve(r);
    }
}
