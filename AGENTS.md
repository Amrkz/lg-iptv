# AGENTS.md — Kayan IPTV

Brief for any AI agent working on this repo. Read fully before changing anything.

## What this is
Kayan IPTV is an IPTV *viewer* (no content of its own). The user signs in with Xtream Codes or an M3U playlist.
One web app (`lg-iptv/`) is shipped to several platforms:
- **LG webOS TV**: app id `com.amrkz.lumioplayer` (the main target, a 2021 LG TV).
- **Android / Android TV**: Capacitor app, package `com.amrkz.kayaniptv` (Play Console, account amokazes@gmail.com).
- **Samsung Tizen**: `tizen-app/` (not packaged yet; needs Tizen Studio and a Samsung certificate).

## Layout
- `lg-iptv/index.html`: single page, scripts loaded in order.
- `lg-iptv/js/`:
  - `keys.js`: remote key codes (BACK is 461 on webOS).
  - `api.js`: Xtream/M3U loading and caching (`clearLists()` must also reset `m3uItems`).
  - `ui.js`: rows, grids and focus.
  - `player.js`: hls.js and native playback, plus the control bar.
  - `settings.js`, `downloads.js`.
  - `app.js`: boot, auto-login, the Recent hero and tab rotation.
  - `i18n.js` and `lang-ar.js`: Arabic strings (no duplicate keys; RTL supported).
- `lg-iptv/css/`: `styles.css` and `themes.css`.
- `lg-iptv/lib/hls.min.js`.
- `android-app/`, `tizen-app/`, `play/` and `store/`: platform wrappers and store assets.
- The Android Capacitor project lives outside the repo, at `/workspace/kayan-android` on the box. `scripts/copy-web.js` copies `lg-iptv/` into `www/`.

## Rules
- Owner: Amr (GitHub `Amrkz`). He has ADD, so keep the UI simple: one clear next action, big focus cues, and resume where the user left off.
- Gather the full spec up front and build it once; avoid back-and-forth.
- Everything must work with a D-pad remote only. Mouse and hover are extras.
- Every new UI string needs an Arabic entry in `lang-ar.js`.
- Commit as the owner: `git -c user.name=Amrkz -c user.email=$(git log -1 --format=%ae) commit -m "..."`, then `git push`.
- Never touch the Play **Production** track without an explicit ask. Testing uses the closed "Alpha" track with the "Mine" tester list.

## Build and install
**LG TV** (run on Amr's Mac, which is on the same network as the TV at 192.168.100.10, MAC address 70:97:41:25:25:0e):
```
cd ~/Developer/lg-iptv-github && git pull -q && ares-package lg-iptv -o ~/Desktop/KayanIPTV \
 && ares-install -d tv ~/Desktop/KayanIPTV/com.amrkz.lumioplayer_1.0.0_all.ipk && ares-launch -d tv com.amrkz.lumioplayer
```
If the TV is off, send it a Wake-on-LAN packet first.

**Android** (on the box):
```
export JAVA_HOME=/home/box/sdk/jdk/jdk-17.0.21+9 ANDROID_HOME=/home/box/sdk/android
cd /workspace/kayan-android && node scripts/copy-web.js && npx cap sync android && cd android && ./gradlew -q bundleRelease assembleRelease
```
- Bump `versionCode` and `versionName` in `android/app/build.gradle` for every Play upload.
- The signing keystore is in `kayan-android/keystore/`.
- Check the result with `apksigner verify`, putting `$JAVA_HOME/bin` on PATH.

**Sideload release:** run `gh release create vX.Y.Z KayanIPTV.apk`. The Downloader code **3617910** (https://aftv.news/3617910) points to `releases/latest/download/KayanIPTV.apk`, so a new release updates it automatically.

## Testing
- On the box, a mock Xtream server runs at `localhost:8765/app`. Puppeteer scripts are in `/workspace/mock` (`hunt.js` checks every section in English and Arabic for page errors).

## Known issues / open work
- **Android on old WebViews** (for example a ClassPro TV): streams never start and the app shows "slow internet". hls.js and the WebView's MSE fail there. Planned fix: native Media3 ExoPlayer playback through a Capacitor plugin, used only on Android.
- **Play closed test:** blocked on reviewer sign-in details. The plan is to give reviewers the free playlist https://iptv-org.github.io/iptv/index.m3u.
- **Ads:** none yet. Advertising ID is declared as "No"; change that declaration before adding ads.
