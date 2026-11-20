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
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/** Hands a stream to the native ExoPlayer screen and reports back how it ended. */
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    // ---------- underlay: native picture under the see-through page (the page keeps its own controls) ----------
    private UnderlayPlayer under;

    private UnderlayPlayer under() {
        if (under == null) under = new UnderlayPlayer(getActivity(), getBridge().getWebView(), (ev, data) -> notifyListeners(ev, data));
        return under;
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("No stream address"); return; }
        boolean live = Boolean.TRUE.equals(call.getBoolean("live", false));
        Double pos = call.getDouble("position", 0.0);
        String ua = call.getString("userAgent", null);
        Map<String, String> hdr = new HashMap<>();
        JSObject headers = call.getObject("headers", null);
        if (headers != null) {
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                String v = headers.optString(k, null);
                if (v == null) continue;
                if ("user-agent".equalsIgnoreCase(k)) ua = v; else hdr.put(k, v);
            }
        }
        final String fua = ua;
        final long ms = (long) ((pos == null ? 0 : pos) * 1000);
        getActivity().runOnUiThread(() -> {
            try { under().open(url, live, ms, fua, hdr); call.resolve(); }
            catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
        });
    }

    @PluginMethod
    public void control(PluginCall call) {
        String op = call.getString("op", "");
        Double v = call.getDouble("value", 0.0);
        final double value = v == null ? 0 : v;
        getActivity().runOnUiThread(() -> {
            try { if (under != null || "stop".equals(op)) under().control(op, value); call.resolve(); }
            catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
        });
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        // leaving the app (Home key): stop pulling the stream
        if (under != null) under.onPause();
    }

    @Override
    protected void handleOnDestroy() {
        if (under != null) under.stop();
        super.handleOnDestroy();
    }

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
