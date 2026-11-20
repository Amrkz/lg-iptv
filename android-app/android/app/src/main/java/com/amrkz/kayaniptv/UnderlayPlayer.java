package com.amrkz.kayaniptv;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.Locale;
import java.util.Map;

/**
 * ExoPlayer drawn UNDER a transparent WebView. The page keeps the keys and draws the app's own
 * player controls (episodes, next/previous, download, tracks...) on top of the native picture.
 * The page drives it through NativePlayerPlugin (open / control) and listens to "nvstate" events.
 */
@OptIn(markerClass = UnstableApi.class)
final class UnderlayPlayer {
    interface Sink { void emit(String event, JSObject data); }

    private static final String DEFAULT_UA = "VLC/3.0.20 LibVLC/3.0.20";
    private final Activity act;
    private final WebView web;
    private final Sink sink;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private PlayerView view;
    private ExoPlayer player;
    private String url;
    private boolean live;
    private String userAgent = DEFAULT_UA;
    private Map<String, String> headers;
    private boolean started;
    private int typeAttempt;
    private Boolean forceHls;
    private long startPosMs;
    private int session;

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (player == null) return;
            emitState("tick");
            ui.postDelayed(this, 500);
        }
    };

    UnderlayPlayer(Activity act, WebView web, Sink sink) {
        this.act = act; this.web = web; this.sink = sink;
    }

    private void ensureView() {
        if (view != null) return;
        view = new PlayerView(act);
        view.setUseController(false);          // the page draws the controls
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER);
        view.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        view.setKeepScreenOn(true);
        view.setFocusable(false);
        view.setFocusableInTouchMode(false);
        view.setClickable(false);
        view.setBackgroundColor(Color.BLACK);
        ViewGroup parent = (ViewGroup) web.getParent();
        parent.addView(view, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void setUnderlay(boolean on) {
        // the page is see-through only while a native picture is under it
        web.setBackgroundColor(on ? Color.TRANSPARENT : 0xFF0A0A0C); // capacitor.config backgroundColor
        if (view != null) view.setVisibility(on ? View.VISIBLE : View.GONE);
        if (on) web.requestFocus();
    }

    void open(String url, boolean live, long posMs, String ua, Map<String, String> headers) {
        this.url = url; this.live = live; this.startPosMs = Math.max(0, posMs);
        this.userAgent = ua == null || ua.isEmpty() ? DEFAULT_UA : ua;
        this.headers = headers;
        typeAttempt = 0; forceHls = null; started = false;
        ensureView();
        setUnderlay(true);
        build(startPosMs);
    }

    private boolean guessHls() {
        if (forceHls != null) return forceHls;
        String path = url.toLowerCase(Locale.ROOT);
        int q = path.indexOf('?');
        String p = q >= 0 ? path.substring(0, q) : path;
        if (p.endsWith(".m3u8") || p.endsWith(".m3u")) return true;
        if (p.matches(".*\\.(mp4|m4v|mkv|avi|mov|webm|ts|mpg|mpeg|flv|wmv|3gp|mp3|aac)$")) return false;
        return path.contains("m3u8");
    }

    private void build(long seekMs) {
        releasePlayer();
        final int my = ++session;
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(userAgent)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15_000)
                .setReadTimeoutMs(20_000)
                .setKeepPostFor302Redirects(true);
        if (headers != null && !headers.isEmpty()) http.setDefaultRequestProperties(headers);
        DefaultLoadControl load = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(live ? 20_000 : 30_000, live ? 60_000 : 120_000, 1_500, 4_000)
                .build();
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(act)
                .setEnableDecoderFallback(true)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON);
        player = new ExoPlayer.Builder(act, renderers)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(act).setDataSourceFactory(http))
                .setLoadControl(load)
                .build();
        view.setPlayer(player);
        MediaItem.Builder item = new MediaItem.Builder().setUri(Uri.parse(url));
        if (guessHls()) item.setMimeType(MimeTypes.APPLICATION_M3U8);
        else {
            String lower = url.toLowerCase(Locale.ROOT);
            if (lower.matches(".*\\.ts(\\?.*)?$")) item.setMimeType(MimeTypes.VIDEO_MP2T);
            else if (lower.matches(".*\\.mkv(\\?.*)?$")) item.setMimeType(MimeTypes.VIDEO_MATROSKA);
            else if (lower.matches(".*\\.(mp4|m4v)(\\?.*)?$")) item.setMimeType(MimeTypes.VIDEO_MP4);
            else if (forceHls != null) item.setMimeType(MimeTypes.VIDEO_MP2T);
        }
        if (live) item.setLiveConfiguration(new MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(10_000).build());
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (my != session) return;
                if (state == Player.STATE_READY && !started) started = true;
                emitState(state == Player.STATE_ENDED ? "ended" : "state");
            }
            @Override public void onIsPlayingChanged(boolean playing) { if (my == session) emitState("state"); }
            @Override public void onPlayWhenReadyChanged(boolean pwr, int reason) { if (my == session) emitState("state"); }
            @Override public void onVideoSizeChanged(VideoSize s) { if (my == session) emitState("state"); }
            @Override public void onTracksChanged(Tracks t) { if (my == session) emitTracks(); }
            @Override public void onPlayerError(PlaybackException error) { if (my == session) handleError(error); }
        });
        player.setMediaItem(item.build(), seekMs > 0 && !live ? seekMs : C.TIME_UNSET);
        player.setPlayWhenReady(true);
        player.prepare();
        ui.removeCallbacks(tick);
        ui.postDelayed(tick, 500);
    }

    private static int httpStatusOf(Throwable e) {
        while (e != null) {
            if (e instanceof HttpDataSource.InvalidResponseCodeException) return ((HttpDataSource.InvalidResponseCodeException) e).responseCode;
            e = e.getCause();
        }
        return 0;
    }

    private void handleError(PlaybackException error) {
        int code = error.errorCode;
        if (code == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW && player != null) {
            player.seekToDefaultPosition();
            player.prepare();
            return;
        }
        boolean parse = code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED
                || code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED
                || code == PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED
                || code == PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED;
        if (parse && !started && typeAttempt == 0) { // the address said the wrong kind: try the other one once
            typeAttempt = 1;
            forceHls = !guessHls();
            build(startPosMs);
            return;
        }
        JSObject o = new JSObject();
        o.put("code", error.getErrorCodeName());
        o.put("errorCode", code);
        o.put("httpStatus", httpStatusOf(error));
        o.put("started", started);
        o.put("decoder", code >= 4000 && code < 5000);
        o.put("network", code >= 2000 && code < 3000);
        o.put("position", player != null ? Math.max(0, player.getCurrentPosition()) / 1000.0 : 0);
        sink.emit("nverror", o);
    }

    private void emitState(String why) {
        if (player == null) return;
        JSObject o = new JSObject();
        long pos = Math.max(0, player.getCurrentPosition());
        long dur = player.getDuration();
        int st = player.getPlaybackState();
        o.put("why", why);
        o.put("t", pos / 1000.0);
        o.put("d", live || dur == C.TIME_UNSET || dur <= 0 ? -1 : dur / 1000.0);
        o.put("buf", Math.max(0, player.getBufferedPosition()) / 1000.0);
        o.put("paused", !player.getPlayWhenReady());
        o.put("playing", player.isPlaying());
        o.put("buffering", st == Player.STATE_BUFFERING);
        o.put("ready", st == Player.STATE_READY);
        o.put("ended", st == Player.STATE_ENDED);
        o.put("started", started);
        VideoSize vs = player.getVideoSize();
        o.put("w", vs.width);
        o.put("h", vs.height);
        o.put("rate", player.getPlaybackParameters().speed);
        sink.emit("nvstate", o);
    }

    private void emitTracks() {
        if (player == null) return;
        JSArray audio = new JSArray(), text = new JSArray();
        Tracks tracks = player.getCurrentTracks();
        int ai = 0, ti = 0;
        for (Tracks.Group g : tracks.getGroups()) {
            int type = g.getType();
            if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_TEXT) continue;
            for (int i = 0; i < g.length; i++) {
                if (!g.isTrackSupported(i)) continue;
                Format f = g.getTrackFormat(i);
                JSObject t = new JSObject();
                t.put("label", f.label == null ? "" : f.label);
                t.put("lang", f.language == null ? "" : f.language);
                t.put("on", g.isTrackSelected(i));
                if (type == C.TRACK_TYPE_AUDIO) { t.put("i", ai++); audio.put(t); }
                else { t.put("i", ti++); text.put(t); }
            }
        }
        JSObject o = new JSObject();
        o.put("audio", audio);
        o.put("text", text);
        sink.emit("nvtracks", o);
    }

    private void selectTrack(int type, int index) {
        if (player == null) return;
        if (type == C.TRACK_TYPE_TEXT && index < 0) {
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build());
            emitTracks();
            return;
        }
        int n = 0;
        for (Tracks.Group g : player.getCurrentTracks().getGroups()) {
            if (g.getType() != type) continue;
            for (int i = 0; i < g.length; i++) {
                if (!g.isTrackSupported(i)) continue;
                if (n++ == index) {
                    TrackGroup tg = g.getMediaTrackGroup();
                    player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                            .setTrackTypeDisabled(type, false)
                            .setOverrideForType(new TrackSelectionOverride(tg, i)).build());
                    return;
                }
            }
        }
    }

    void control(String op, double value) {
        if ("stop".equals(op)) { stop(); return; }
        if (player == null) return;
        switch (op) {
            case "play":
                if (player.getPlaybackState() == Player.STATE_IDLE) { build(player.getCurrentPosition()); return; }
                if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
                player.setPlayWhenReady(true);
                break;
            case "pause": player.setPlayWhenReady(false); break;
            case "seek": {
                long ms = (long) (value * 1000);
                long d = player.getDuration();
                if (d != C.TIME_UNSET && d > 0) ms = Math.min(ms, Math.max(0, d - 500));
                player.seekTo(Math.max(0, ms));
                break;
            }
            case "live": player.seekToDefaultPosition(); break;
            case "rate": player.setPlaybackParameters(new PlaybackParameters((float) Math.max(0.25, Math.min(4, value)))); break;
            case "audio": selectTrack(C.TRACK_TYPE_AUDIO, (int) value); break;
            case "text": selectTrack(C.TRACK_TYPE_TEXT, (int) value); break;
            case "fit": view.setResizeMode((int) value == 1 ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                    : (int) value == 2 ? AspectRatioFrameLayout.RESIZE_MODE_FILL : AspectRatioFrameLayout.RESIZE_MODE_FIT); break;
            case "volume": player.setVolume((float) Math.max(0, Math.min(1, value))); break;
            default: break;
        }
        emitState("control");
    }

    private void releasePlayer() {
        ui.removeCallbacks(tick);
        session++;
        if (player != null) {
            try { player.release(); } catch (Exception ignored) {}
            player = null;
        }
        if (view != null) view.setPlayer(null);
    }

    void stop() {
        releasePlayer();
        setUnderlay(false);
    }

    void onPause() { if (player != null) player.setPlayWhenReady(false); }
}
