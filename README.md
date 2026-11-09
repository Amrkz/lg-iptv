# Kayan IPTV

An IPTV player for LG webOS TVs. It talks to any Xtream Codes provider (`player_api.php`) and plays live channels, films and series with a Netflix-style player.

You enter your own server, username and password in the app. No provider or credentials are stored in this repository.

## What it does

- Live TV, films and series, with favorites and Continue Watching.
- Opens on the section you used last. If that section is empty, it opens on the first tab (Live TV).
- Live: Up/Down changes channel, number keys jump to a channel, Green returns to the last channel, a channel banner shows now/next with a progress bar.
- Series: Up Next card with a 10 s countdown, "Watch credits", Skip intro (learned from where you skip), "Are you still watching?" after 3 autoplayed episodes, Start over.
- Player: picture modes (Fit, Fill, Zoom, Stretch, 4:3), audio and subtitle choice with language memory, subtitle size, playback speed, pause info card, sleep timer.
- Catch-up (Start over and a replay guide) on channels where the provider offers an archive.
- Recovery: a stalled stream reconnects up to 3 times; a live channel paused for 30 s or more reopens at the live point.
- Languages: English and Arabic (العربية). The first start follows the TV's menu language; the language button on the sign-in screen and in the top bar switches it. Arabic mirrors the sign-in screen, top bar and dialogs; rows, the hero and the player keep their left-to-right layout so the arrow keys, scrolling and the seek bar behave the same.

## Adding a language

1. Copy `lg-iptv/js/lang-ar.js` to `lang-<id>.js` and translate the values (the keys are the English texts used in the app; keep the `{placeholders}`).
2. Add the language to `LANGS` in `lg-iptv/js/i18n.js` (`rtl: true` for a right-to-left language) and load the file in `lg-iptv/index.html` after `i18n.js`.
3. Add font faces for the script in `lg-iptv/css/styles.css` if Latin and Arabic fonts do not cover it.

## How it works

- `lg-iptv/` is the web app (HTML, CSS, JavaScript). It targets the old Chromium in webOS TVs: no `async`/`await`, no object spread.
- `lg-iptv/service/` is a small Node.js helper that runs on the TV (Node 8). Many providers refuse the TV browser's own requests, so the helper fetches the stream with a player identity and hands it to the `<video>` element. It listens on port `18491`.
- Only this app can use the helper. On start it makes a random token, returns it on the Luna bus, and requires that token on every request (the TV player cannot set a header, so the token is in the stream URL). Other websites are refused. The helper will not fetch loopback, link-local, or private LAN addresses, including after a redirect.
- It binds to the TV's own LAN address and to `127.0.0.1` when it can see them. The native player opens the LAN address; hls.js opens loopback. Binding only to loopback leaves a black picture. If the TV reports no LAN address, it falls back to `0.0.0.0`.
- TLS certificate checks are off on the helper's upstream connection. IPTV panels often present a certificate that is self-signed, expired, or issued for a different name than the host in the playlist. Checking those certificates drops playback for the providers the helper exists to reach. The TV browser never sees that TLS session. A network attacker between the TV and the provider could still substitute a certificate.
- The video is played natively when possible, with `hls.js` (`lg-iptv/lib/hls.min.js`) as the fallback.

## Remote keys

| Key | Films and series | Live |
|---|---|---|
| OK | Show controls / press focused button | Show controls / confirm channel number |
| Up / Down (controls hidden) | Show controls | Next / previous channel |
| Left / Right (controls hidden) | Scrub | Show controls |
| CH+ / CH− | Next / previous episode | Next / previous channel |
| 0–9 | — | Channel number |
| Info | Show / hide controls | Show / hide controls and programme info |
| Red | Audio & Subtitles | Audio & Subtitles |
| Green | — | Last channel |
| Yellow | Favorite | Favorite |
| Blue | Next picture mode | Next picture mode |
| Back | Close card or menu, then leave player | Cancel number, close menu, then leave player |

The full key table is in [`PLAN.md`](PLAN.md).

## Build and install

You need the [webOS TV CLI](https://webostv.developer.lge.com/develop/tools/cli-installation) (`ares-*`) and a TV in Developer Mode that is registered as a device.

```sh
# One-time: register the TV (here named "tv")
ares-setup-device

# Package the app together with its service
ares-package lg-iptv lg-iptv/service -o .

# Install and start it
ares-install --device tv com.amrkz.kayaniptv_1.0.0_all.ipk
ares-launch  --device tv com.amrkz.kayaniptv
```

If `com.amrkz.lumioplayer` is still installed, remove it first. That was the previous id. Its saved logins, PIN, and downloads stay with that app and do not move.

Check that the helper is running. Healthy output shows port `18491` listening on the TV's LAN address and on `127.0.0.1` (`0.0.0.0` only if the TV reported no LAN address), and a `listen` line in the log:

```sh
ares-novacom --device tv --run "netstat -ltn | grep 18491; tail -20 /tmp/kayan-proxy.log"
```

### Things that went wrong before

- The TV's Luna bus rejects service names that contain `-`. The app id is `com.amrkz.kayaniptv` and the service is `com.amrkz.kayaniptv.proxy` for that reason. Do not put a hyphen in either name. The id locks after the first LG Content Store submission.
- A `node boot.js` started by hand over SSH keeps old code in memory after a reinstall and can hold port `18491`. Check `ps -ef | grep node` before trusting a test.
- On the webOS video plane, any CSS transform, opacity or full-screen box over the `<video>` drops the picture. Picture modes therefore resize the `<video>` box only.

## Project notes

- [`PLAN.md`](PLAN.md): the player plan, decisions, phases and the test checklist to run on the TV.
- [`ERROR.md`](ERROR.md): the black-screen bug on live playback, its root cause and the fix.

## Status (9 November 2026)

- Player phases 1–5 from [`PLAN.md`](PLAN.md) (1 November 2026) are in the tree. Phase 6 (a new look for the control bar) is not started.
- Live playback was confirmed on a TV on 1 November 2026 with an earlier package. After any helper change, live and VOD still need a check on the real TV.
- The Android wrapper in [`android-app/`](android-app/) is the Capacitor project for this repo (JDK 21). Release signing reads `keystore.properties` or environment variables. This repo does not publish to the Play Production track.

## webOS app id

The packaged app id is `com.amrkz.kayaniptv`. The helper service is `com.amrkz.kayaniptv.proxy`. Android already uses the same package name. The previous webOS id, `com.amrkz.lumioplayer`, is a different app: uninstall it on the TV by hand. Saved logins, the parental PIN, and downloads do not carry over.

## Disclaimer

This is a player only. It provides no content. You are responsible for using it only with a service you are entitled to use.

## Android APK

The Android (phone + TV) project is [`android-app/`](android-app/). It wraps the same web UI with Capacitor 7. JDK 21 is required. Debug builds do not need the release keystore.

```bash
export JAVA_HOME=/path/to/jdk-21
export ANDROID_HOME=/path/to/Android/Sdk
cd android-app && npm install && node scripts/copy-web.js && npx cap sync android
cd android && ./gradlew assembleDebug
```

A release build needs `android-app/keystore.properties` (see `keystore.properties.example`) or the `KAYAN_STORE_PASSWORD` and `KAYAN_KEY_PASSWORD` environment variables. The keystore file is `android-app/keystore/kayan-release.jks` (not in git; alias `kayan`). The signed APK is `android/app/build/outputs/apk/release/app-release.apk`. See [`android-app/README.md`](android-app/README.md).
