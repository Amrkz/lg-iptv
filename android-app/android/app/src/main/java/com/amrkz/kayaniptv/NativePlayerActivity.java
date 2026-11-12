package com.amrkz.kayaniptv;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Full-screen native player (ExoPlayer) for Android TV boxes whose WebView cannot play IPTV streams.
 * Remote: OK = play/pause, Left/Right = -10/+10 s, Up/Down or CH+/CH- = next/previous channel (live),
 * Back = close and return to the app.
 */
@OptIn(markerClass = UnstableApi.class)
public class NativePlayerActivity extends Activity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_SUBTITLE = "subtitle";
    public static final String EXTRA_LIVE = "live";
    public static final String EXTRA_POSITION_MS = "positionMs";
    public static final String EXTRA_UA = "userAgent";
    public static final String EXTRA_HEADERS = "headers";

    public static final String RES_ACTION = "action";       // back | ended | error | next | prev
    public static final String RES_POSITION_MS = "positionMs";
    public static final String RES_DURATION_MS = "durationMs";
    public static final String RES_ERROR = "error";
    public static final String RES_HTTP = "httpStatus";
    public static final String RES_STARTED = "started";

    // Many IPTV providers refuse browser identities (HTTP 409/403) but accept a media player's.
    private static final String DEFAULT_UA = "VLC/3.0.20 LibVLC/3.0.20";
    private static final long SEEK_MS = 10_000;
    private static final int RECONNECT_MAX = 3;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private PlayerView view;
    private ProgressBar spinner;
    private TextView msg;
    private TextView osd;
    private LinearLayout infoBar;

    private String url;
    private String title;
    private String subtitle;
    private boolean live;
    private long startPosMs;
    private String userAgent;
    private final Map<String, String> headers = new HashMap<>();

    private boolean started = false;
    private boolean finishing = false;
    private int reconnects = 0;
    private int typeAttempt = 0;        // 0 = guessed type, 1 = the other type (HLS <-> progressive)
    private Boolean forceHls = null;    // null = guess from the address
    private long pendingSeekMs = -1;

    private final Runnable hideOsd = () -> {
        if (osd != null) osd.setVisibility(View.GONE);
        if (infoBar != null) infoBar.setVisibility(View.GONE);
    };
    private final Runnable commitSeek = () -> {
        if (player != null && pendingSeekMs >= 0) {
            player.seekTo(pendingSeekMs);
            pendingSeekMs = -1;
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        hideSystemUi();

        Intent in = getIntent();
        url = in.getStringExtra(EXTRA_URL);
        title = nz(in.getStringExtra(EXTRA_TITLE));
        subtitle = nz(in.getStringExtra(EXTRA_SUBTITLE));
        live = in.getBooleanExtra(EXTRA_LIVE, false);
        startPosMs = Math.max(0, in.getLongExtra(EXTRA_POSITION_MS, 0));
        userAgent = in.getStringExtra(EXTRA_UA);
        if (userAgent == null || userAgent.isEmpty()) userAgent = DEFAULT_UA;
        ArrayList<String> kv = in.getStringArrayListExtra(EXTRA_HEADERS);
        if (kv != null) {
            for (int i = 0; i + 1 < kv.size(); i += 2) {
                String k = kv.get(i);
                if ("user-agent".equalsIgnoreCase(k)) userAgent = kv.get(i + 1);
                else headers.put(k, kv.get(i + 1));
            }
        }

        buildUi();
        if (url == null || url.isEmpty()) {
            showErrorAndClose("No stream address", "لا يوجد عنوان للبث", 0);
            return;
        }
        open(startPosMs);
    }

    private static String nz(String s) { return s == null ? "" : s; }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        view = new PlayerView(this);
        view.setUseController(false);
        view.setKeepScreenOn(true);
        view.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER);
        view.setFocusable(false);
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        spinner = new ProgressBar(this);
        spinner.setIndeterminate(true);
        FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(dp(64), dp(64), Gravity.CENTER);
        root.addView(spinner, sp);

        msg = new TextView(this);
        msg.setTextColor(Color.WHITE);
        msg.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        msg.setGravity(Gravity.CENTER);
        msg.setPadding(dp(24), dp(16), dp(24), dp(16));
        msg.setBackgroundColor(0xCC000000);
        msg.setVisibility(View.GONE);
        FrameLayout.LayoutParams mp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        mp.topMargin = dp(110);
        root.addView(msg, mp);

        osd = new TextView(this);
        osd.setTextColor(Color.WHITE);
        osd.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        osd.setGravity(Gravity.CENTER);
        osd.setPadding(dp(20), dp(10), dp(20), dp(10));
        osd.setBackgroundColor(0x99000000);
        osd.setVisibility(View.GONE);
        root.addView(osd, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        infoBar = new LinearLayout(this);
        infoBar.setOrientation(LinearLayout.VERTICAL);
        infoBar.setPadding(dp(32), dp(20), dp(32), dp(20));
        infoBar.setBackgroundColor(0x99000000);
        TextView t = new TextView(this);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        t.setText(title);
        t.setTextDirection(View.TEXT_DIRECTION_ANY_RTL);
        infoBar.addView(t);
        if (!subtitle.isEmpty()) {
            TextView s = new TextView(this);
            s.setTextColor(0xFFBBBBBB);
            s.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            s.setText(subtitle);
            s.setTextDirection(View.TEXT_DIRECTION_ANY_RTL);
            infoBar.addView(s);
        }
        root.addView(infoBar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));
        setContentView(root);
        ui.postDelayed(hideOsd, 4000);
    }

    private void hideSystemUi() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    private boolean guessHls() {
        if (forceHls != null) return forceHls;
        String path = url.toLowerCase(Locale.ROOT);
        int q = path.indexOf('?');
        String p = q >= 0 ? path.substring(0, q) : path;
        if (p.endsWith(".m3u8") || p.endsWith(".m3u")) return true;
        if (p.matches(".*\\.(mp4|m4v|mkv|avi|mov|webm|ts|mpg|mpeg|flv|wmv|3gp|mp3|aac)$")) return false;
        // no extension: m3u8 mentioned anywhere (query, e.g. output=m3u8) means HLS
        return path.contains("m3u8");
    }

    private void open(long seekMs) {
        releasePlayer();
        msg.setVisibility(View.GONE);
        spinner.setVisibility(View.VISIBLE);

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(userAgent)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15_000)
                .setReadTimeoutMs(20_000)
                .setKeepPostFor302Redirects(true);
        if (!headers.isEmpty()) http.setDefaultRequestProperties(headers);

        DefaultLoadControl load = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                        live ? 20_000 : 30_000,
                        live ? 60_000 : 120_000,
                        1_500,
                        4_000)
                .build();

        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
                .setEnableDecoderFallback(true)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON);

        player = new ExoPlayer.Builder(this, renderers)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(this).setDataSourceFactory(http))
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
            else if (forceHls != null) item.setMimeType(MimeTypes.VIDEO_MP2T); // forced progressive for an extension-less address
        }
        if (live) item.setLiveConfiguration(new MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(10_000).build());

        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_BUFFERING) spinner.setVisibility(View.VISIBLE);
                else spinner.setVisibility(View.GONE);
                if (state == Player.STATE_READY) {
                    if (!started) started = true;
                    reconnects = 0;
                    msg.setVisibility(View.GONE);
                }
                if (state == Player.STATE_ENDED) {
                    if (live) reconnect();
                    else close("ended", null, 0);
                }
            }

            @Override
            public void onIsPlayingChanged(boolean playing) {
                if (playing) msg.setVisibility(View.GONE);
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                handleError(error);
            }
        });

        player.setMediaItem(item.build(), seekMs > 0 && !live ? seekMs : C.TIME_UNSET);
        player.setPlayWhenReady(true);
        player.prepare();
    }

    private static int httpStatusOf(Throwable e) {
        while (e != null) {
            if (e instanceof HttpDataSource.InvalidResponseCodeException) {
                return ((HttpDataSource.InvalidResponseCodeException) e).responseCode;
            }
            e = e.getCause();
        }
        return 0;
    }

    private void handleError(PlaybackException error) {
        int code = error.errorCode;
        int status = httpStatusOf(error);
        if (code == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW && player != null) {
            player.seekToDefaultPosition();
            player.prepare();
            return;
        }
        boolean parse = code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED
                || code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED
                || code == PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED
                || code == PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED;
        // the address did not say what it was, or said it wrong: try the other kind once
        if (parse && !started && typeAttempt == 0) {
            typeAttempt = 1;
            forceHls = !guessHls();
            open(startPosMs);
            return;
        }
        boolean network = code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
                || code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
                || code == PlaybackException.ERROR_CODE_IO_UNSPECIFIED
                || code == PlaybackException.ERROR_CODE_TIMEOUT
                || (status >= 500)
                || (live && status == 0 && code >= 2000 && code < 3000);
        if (network && (started || live) && reconnects < RECONNECT_MAX) {
            reconnect();
            return;
        }
        String en, ar;
        if (status == 401 || status == 403) {
            en = "The provider refused this stream (" + status + "). Check your subscription.";
            ar = "رفض المزوّد هذا البث (" + status + "). تحقق من اشتراكك.";
        } else if (status == 404) {
            en = "This stream was not found (404).";
            ar = "هذا البث غير موجود (404).";
        } else if (status == 409 || status == 429 || status == 458) {
            en = "The provider is busy or your connection limit was reached (" + status + ").";
            ar = "المزوّد مشغول أو تم بلوغ حد الاتصالات (" + status + ").";
        } else if (status > 0) {
            en = "The provider answered with error " + status + ".";
            ar = "ردّ المزوّد بالخطأ " + status + ".";
        } else if (code >= 4000 && code < 5000) {
            en = "This device cannot decode this stream format.";
            ar = "هذا الجهاز لا يستطيع تشغيل صيغة هذا البث.";
        } else if (code >= 2000 && code < 3000) {
            en = "Cannot reach the stream. Check your internet connection.";
            ar = "تعذّر الوصول إلى البث. تحقق من اتصال الإنترنت.";
        } else {
            en = "Cannot play this stream.";
            ar = "تعذّر تشغيل هذا البث.";
        }
        showErrorAndClose(en + " [" + error.getErrorCodeName() + "]", ar, status);
    }

    private void reconnect() {
        reconnects++;
        long at = (!live && player != null) ? Math.max(0, player.getCurrentPosition()) : 0;
        msg.setText("Reconnecting… / جارٍ إعادة الاتصال…");
        msg.setVisibility(View.VISIBLE);
        ui.postDelayed(() -> { if (!finishing) open(at); }, 1000);
    }

    private void showErrorAndClose(String en, String ar, int status) {
        spinner.setVisibility(View.GONE);
        msg.setText(en + "\n" + ar);
        msg.setVisibility(View.VISIBLE);
        if (player != null) player.pause();
        final String text = en + " — " + ar;
        ui.postDelayed(() -> close("error", text, status), 3500);
    }

    private void showOsd(String text) {
        osd.setText(text);
        osd.setVisibility(View.VISIBLE);
        infoBar.setVisibility(View.VISIBLE);
        ui.removeCallbacks(hideOsd);
        ui.postDelayed(hideOsd, 2500);
    }

    private static String fmt(long ms) {
        long s = Math.max(0, ms / 1000);
        long h = s / 3600, m = (s % 3600) / 60, sec = s % 60;
        return h > 0 ? String.format(Locale.US, "%d:%02d:%02d", h, m, sec) : String.format(Locale.US, "%d:%02d", m, sec);
    }

    private void seekBy(long delta) {
        if (player == null) return;
        long base = pendingSeekMs >= 0 ? pendingSeekMs : player.getCurrentPosition();
        long dur = player.getDuration();
        long target = Math.max(0, base + delta);
        if (dur != C.TIME_UNSET && dur > 0) target = Math.min(target, Math.max(0, dur - 1000));
        // the first press seeks at once; held keys gather and land when the key settles
        if (pendingSeekMs < 0) {
            player.seekTo(target);
        } else {
            pendingSeekMs = target;
            ui.removeCallbacks(commitSeek);
            ui.postDelayed(commitSeek, 250);
        }
        String label = (delta > 0 ? "+" : "−") + (Math.abs(delta) / 1000) + "s   " + fmt(target)
                + (dur != C.TIME_UNSET && dur > 0 ? " / " + fmt(dur) : "");
        showOsd(label);
    }

    private void togglePlay() {
        if (player == null) return;
        if (player.getPlaybackState() == Player.STATE_IDLE) { open(player.getCurrentPosition()); return; }
        boolean nowPlaying = !player.getPlayWhenReady();
        player.setPlayWhenReady(nowPlaying);
        showOsd(nowPlaying ? "▶" : "❚❚");
        if (!nowPlaying) ui.removeCallbacks(hideOsd); // stay visible while paused
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (k == KeyEvent.KEYCODE_VOLUME_UP || k == KeyEvent.KEYCODE_VOLUME_DOWN || k == KeyEvent.KEYCODE_VOLUME_MUTE) {
            return super.dispatchKeyEvent(e);
        }
        if (e.getAction() == KeyEvent.ACTION_UP) {
            if (k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_DPAD_RIGHT
                    || k == KeyEvent.KEYCODE_MEDIA_REWIND || k == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) {
                ui.removeCallbacks(commitSeek);
                commitSeek.run();
            }
            return true;
        }
        if (e.getAction() != KeyEvent.ACTION_DOWN) return true;
        boolean repeat = e.getRepeatCount() > 0;
        switch (k) {
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
            case KeyEvent.KEYCODE_MEDIA_STOP:
                if (!repeat) close("back", null, 0);
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_SPACE:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
                if (!repeat) togglePlay();
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                if (player != null) player.setPlayWhenReady(true);
                return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                if (player != null) player.setPlayWhenReady(false);
                return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                if (repeat && pendingSeekMs < 0 && player != null) pendingSeekMs = player.getCurrentPosition();
                seekBy(-SEEK_MS);
                return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                if (repeat && pendingSeekMs < 0 && player != null) pendingSeekMs = player.getCurrentPosition();
                seekBy(SEEK_MS);
                return true;
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_PAGE_UP:
                if (!repeat) {
                    if (live) close("next", null, 0);
                    else showOsd(title);
                }
                return true;
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
            case KeyEvent.KEYCODE_PAGE_DOWN:
                if (!repeat) {
                    if (live) close("prev", null, 0);
                    else showOsd(title);
                }
                return true;
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                if (!repeat) close("next", null, 0);
                return true;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                if (!repeat) close("prev", null, 0);
                return true;
            case KeyEvent.KEYCODE_INFO:
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_GUIDE:
                if (!repeat) showOsd(player != null && player.getDuration() > 0 && !live
                        ? fmt(player.getCurrentPosition()) + " / " + fmt(player.getDuration()) : title);
                return true;
            default:
                return super.dispatchKeyEvent(e);
        }
    }

    @Override
    public void onBackPressed() {
        close("back", null, 0);
    }

    private void close(String action, String error, int status) {
        if (finishing) return;
        finishing = true;
        Intent r = new Intent();
        r.putExtra(RES_ACTION, action);
        long pos = 0, dur = 0;
        if (player != null) {
            pos = Math.max(0, player.getCurrentPosition());
            long d = player.getDuration();
            dur = d == C.TIME_UNSET ? 0 : Math.max(0, d);
        }
        r.putExtra(RES_POSITION_MS, live ? 0 : pos);
        r.putExtra(RES_DURATION_MS, live ? 0 : dur);
        r.putExtra(RES_STARTED, started);
        if (error != null) r.putExtra(RES_ERROR, error);
        if (status != 0) r.putExtra(RES_HTTP, status);
        setResult(RESULT_OK, r);
        releasePlayer();
        finish();
    }

    private void releasePlayer() {
        if (player != null) {
            try { player.release(); } catch (Exception ignored) {}
            player = null;
        }
        if (view != null) view.setPlayer(null);
    }

    @Override
    protected void onStop() {
        super.onStop();
        // leaving the app (Home key): stop the stream so providers do not count a hidden connection
        if (!finishing && player != null) player.pause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        releasePlayer();
        super.onDestroy();
    }
}
