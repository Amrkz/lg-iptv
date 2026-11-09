# AGENTS.md — Kayan IPTV

Brief for any AI agent working on this repo. Read fully before changing anything.

## What this is
Kayan IPTV is an IPTV *viewer* (no content of its own). The user signs in with Xtream Codes or an M3U playlist.
One web app (`lg-iptv/`) is shipped to several platforms:
- **LG webOS TV**: app id `com.amrkz.kayaniptv`, helper `com.amrkz.kayaniptv.proxy` (the main target, a 2021 LG TV). No hyphen in either name. The id locks after the first Content Store submission.
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
- The Android Capacitor project is `android-app/` in this repo. `android-app/scripts/copy-web.js` copies `lg-iptv/` (the sibling of `android-app/`) into `android-app/www/`.

## Rules
- Owner: Amr (GitHub `Amrkz`). He has ADD, so keep the UI simple: one clear next action, big focus cues, and resume where the user left off.
- Gather the full spec up front and build it once; avoid back-and-forth.
- Everything must work with a D-pad remote only. Mouse and hover are extras.
- Every new UI string needs an Arabic entry in `lang-ar.js`.
- Commit as the owner: `git -c user.name=Amrkz -c user.email=$(git log -1 --format=%ae) commit -m "..."`, then `git push`.
- Never touch the Play **Production** track without an explicit ask. Testing uses the closed "Alpha" track with the "Mine" tester list.

## Build and install
**LG TV** (run on Amr's Mac, which is on the same network as the TV at 192.168.100.10, MAC address 70:97:41:25:25:0e). The helper service has to be in the package or playback stays on the TV browser:
```
cd ~/Developer/lg-iptv-github && git pull -q && ares-package lg-iptv lg-iptv/service -o ~/Desktop/KayanIPTV \
 && ares-install -d tv ~/Desktop/KayanIPTV/com.amrkz.kayaniptv_1.0.0_all.ipk && ares-launch -d tv com.amrkz.kayaniptv
```
If the TV is off, send it a Wake-on-LAN packet first. Uninstall the old `com.amrkz.lumioplayer` app by hand first; its logins do not move. A healthy helper listens on port `18491` (the TV's LAN address and `127.0.0.1`, or `0.0.0.0` only if the TV reports no LAN address). The log is `/tmp/kayan-proxy.log`.

**Android** (JDK 21 — Capacitor 7 and Android Gradle Plugin 8.7 do not build on JDK 17):
```
export JAVA_HOME=/path/to/jdk-21 ANDROID_HOME=/path/to/Android/Sdk
cd android-app && npm install && node scripts/copy-web.js && npx cap sync android && cd android && ./gradlew assembleDebug
```
- Release (`bundleRelease` / `assembleRelease`) needs `android-app/keystore.properties` (copy `keystore.properties.example`) or `KAYAN_STORE_PASSWORD` and `KAYAN_KEY_PASSWORD`. Debug does not.
- Bump `versionCode` and `versionName` in `android-app/android/app/build.gradle` for every Play upload.
- The signing keystore is `android-app/keystore/kayan-release.jks` (not in git; alias `kayan`). Do not put the passwords back in `build.gradle`.
- Check the result with `apksigner verify`, putting `$JAVA_HOME/bin` on PATH.

**Sideload release:** run `gh release create vX.Y.Z KayanIPTV.apk`. The Downloader code **3617910** (https://aftv.news/3617910) points to `releases/latest/download/KayanIPTV.apk`, so a new release updates it automatically.

## Testing
- `node lg-iptv/service/guard.test.js` checks the helper token, CORS, and blocked targets.
- `node lg-iptv/js/privacy.test.js` checks the PIN hash and that a backup omits passwords and the PIN.
- Live and VOD still have to be played on the real TV after a helper change. Package `lg-iptv` together with `lg-iptv/service`.

## Known issues / open work
- **Old webOS install:** `com.amrkz.lumioplayer` may still be on the TV. Remove it by hand. Storage does not move to `com.amrkz.kayaniptv`. Do not rename the new id after the first Seller Lounge submission.
- **Android on old WebViews** (for example a ClassPro TV): streams never start and the app shows "slow internet". hls.js and the WebView's MSE fail there. Planned fix: native Media3 ExoPlayer playback through a Capacitor plugin, used only on Android.
- **Play closed test:** blocked on reviewer sign-in details. The plan is to give reviewers the free playlist https://iptv-org.github.io/iptv/index.m3u.
- **Ads:** none yet. Advertising ID is declared as "No"; change that declaration before adding ads.
