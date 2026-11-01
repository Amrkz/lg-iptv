# Playback error

Black screen. No picture, no sound report, and no error line on the last confirmed try.

The app is the webOS package `com.example.lg-iptv`. The channel list loads. Choosing a live channel opens the player and stays black.

## What the official app does

The provider app is `LTVNew13.apk`, package `com.ipltv.ipltvbox`, version 4.0. It is an IPTV Smarters / ipltv box build. Playback was read from the unpacked smali, not from the menu labels.

The default player is IJKPlayer (`NSTIJKPlayerSky` for live TV, `NSTIJKPlayerVOD` for films and episodes). Native libraries in the APK: `libijkplayer.so`, `libijkffmpeg.so`, `libijksdl.so`. There is no `libvlc.so`. The settings strings are "Built-in Player ( Default )" for IJK, "Built-in Player 2" for ExoPlayer (`NSTEXOPlayer*`), and "VLC Player" for an external handoff.

IJK sends this request name unless the user saved another one:

```
user_agent = LTVPlayer
```

That string is the shared-preference default in both `NSTIJKPlayerSky.smali` and `NSTIJKPlayerVOD.smali`, passed to `IjkMediaPlayer.setOption`.

A live channel is built as:

```
{protocol}://{server}:{port}/live/{username}/{password}/{streamId}.{ts|m3u8}
```

The extension comes from the saved output format. Movies use `/movie/`. Episodes use `/series/`. IJK plays a raw MPEG-TS stream itself. This webOS app cannot ship that player.

## What this app does

The TV browser is refused by the provider with HTTP 409. The page cannot change its own User-Agent, so `lg-iptv/service/proxy.js` fetches the stream as `LTVPlayer` and serves it on the TV. The video element is then pointed at that local address.

Live TV is requested as HLS (`.m3u8`) because the webOS video element does not play the endless `.ts` file IJK plays. The TV's own player is tried first, at the TV's LAN address. If that produces no moving picture within 8 seconds, hls.js is tried through `127.0.0.1`.

While the picture has not started, the channel subtitle is replaced with the status or the error. A `playing` event alone is not treated as success, because this TV can fire it on a black frame.

## Why the screen stayed the same

The file `com.example.lg-iptv_1.0.0_all.ipk` in this folder was the package from 00:13. Quitting and opening the icon kept running that package, so later edits of `lg-iptv/js` and `lg-iptv/css` were not on the TV.

A new package was built from the current source and installed on the configured device `tv` (`192.168.100.10`). That install is not confirmed by a playback test yet.

## Root cause found (2026-11-01, 02:53)

Checked on the TV over SSH:

1. **The proxy service could never start.** This TV's Luna bus rejects any service name containing `-`:
   ```
   LUNASERVICE ERROR -22: LSUriParse: Not a valid service name in uri luna://com.example.lg-iptv.proxy/alive
   ```
   The same call without the hyphen parses fine. A service name must begin with the app ID, so the app ID had to change too.
2. **A stale proxy hid this.** `node boot.js` (PID 3141) had been started by hand over SSH at 00:30. It was still running code from before the 02:51 install, and it listened on `127.0.0.1:18491` only. The app found it on loopback, so it never asked the bus for the service.
3. **The player was sent to a dead address.** Native playback uses the TV's LAN address, `192.168.100.10:18491`, and that connection was refused. The video element got nothing and showed black with no error.

A test server bound to `0.0.0.0` works for this user (`bound 0.0.0.0:18499`, LAN and loopback both answer), so the current `proxy.js` can serve the LAN address.

## Fix applied

- App ID `com.example.lg-iptv` → `com.example.lgiptv`; service `com.example.lg-iptv.proxy` → `com.example.lgiptv.proxy` (`appinfo.json`, `service/services.json`, `service/package.json`, `js/api.js`).
- `js/api.js`: the LAN address is used only after the proxy answers on it. If it does not answer, the URL falls back to `127.0.0.1` and no longer points at a refused port.
- Stale PID 3141 was stopped.
- Built and installed `com.example.lgiptv_1.0.0_all.ipk` on `tv` (install: Success).

## Confirmed

- After the TV was turned back on, `luna-send-pub luna://com.example.lgiptv.proxy/alive` returned `{"returnValue":true,"port":18491}`. The proxy listens on `0.0.0.0:18491`, and both `192.168.100.10:18491` and `127.0.0.1:18491` answer.
- Live channel playback works on `com.example.lgiptv` (confirmed by the user, 2026-11-01).

## Remaining

- The old app `com.example.lg-iptv` is still installed, with its broken service. The new app has its own storage, so the login has to be entered again.
