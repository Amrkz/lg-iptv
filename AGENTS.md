# AGENTS.md — Kayan IPTV

Brief for any AI agent working on this repo. Read fully before changing anything.

## What this is
Kayan IPTV is an IPTV *viewer* (no content of its own). The user signs in with Xtream Codes or an M3U playlist.
One web app (`lg-iptv/`) is shipped to several platforms:
- **LG webOS TV**: app id `com.amrkz.kayaniptv`, helper `com.amrkz.kayaniptv.proxy` (the main target, a 2021 LG TV). No hyphen in either name. The id locks after the first Content Store submission.
- **Android / Android TV**: Capacitor app, package `com.amrkz.kayaniptv` (Play Console, account amokazes@gmail.com).
- **iPhone / iPad**: Capacitor 7 app in `ios-app/` (Swift Package Manager, no CocoaPods), bundle id `com.amrkz.kayaniptv`, version 1.0.6 (build 8). **Landscape-only since build 8** (iPhone and iPad; the TV layout only filled a thin strip in portrait). App Store Connect record exists: Apple ID `6834382655`, SKU `kayaniptv-ios` (listing details and status in `ios-app/STORE.md`).
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
- `ios-app/`: iOS wrapper. `ios-app/scripts/copy-web.js` copies `lg-iptv/` into `ios-app/www/` and marks the page `plat-android plat-ios` (same touch stage-fit, HLS-first and downloads code as Android; the Android-only ExoPlayer plugin is skipped because `Capacitor.getPlatform()` is `ios`). iOS plays through `<video playsinline>` (native HLS, AirPlay and picture-in-picture allowed).
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
As of Nov 13, 2026 the TV runs 1.0.6 under `com.amrkz.kayaniptv` and the old `com.amrkz.lumioplayer` app is gone.

**Android** (JDK 21 — Capacitor 7 and Android Gradle Plugin 8.7 do not build on JDK 17):
```
export JAVA_HOME=/path/to/jdk-21 ANDROID_HOME=/path/to/Android/Sdk
cd android-app && npm install && node scripts/copy-web.js && npx cap sync android && cd android && ./gradlew assembleDebug
```
- Release (`bundleRelease` / `assembleRelease`) needs `android-app/keystore.properties` (copy `keystore.properties.example`) or `KAYAN_STORE_PASSWORD` and `KAYAN_KEY_PASSWORD`. Debug does not.
- Bump `versionCode` and `versionName` in `android-app/android/app/build.gradle` for every Play upload.
- The signing keystore is `android-app/keystore/kayan-release.jks` (not in git; alias `kayan`). Do not put the passwords back in `build.gradle`.
- Check the result with `apksigner verify`, putting `$JAVA_HOME/bin` on PATH.

**iOS** (on the Mac with Xcode 16+; one command does web copy, `cap sync`, a Simulator build, a signed archive and an install on a paired iPhone):
```
cd ~/Developer/lg-iptv-github && git pull -q && bash ios-app/build-mac.sh          # all
bash ios-app/build-mac.sh sim | archive | device                                   # one step
```
- Signing is automatic. The team comes from `$KAYAN_TEAM` or the OU of the first "Apple Development" certificate in the keychain.
- Output goes to `~/Desktop/KayanIPTV-ios/` (`KayanIPTV.xcarchive` → Xcode Organizer → Distribute App → TestFlight). Never upload to App Store Connect / TestFlight without Amr's explicit ask. (Build 1.0.6 (8) was uploaded on Nov 13, 2026 with his OK and is attached to the 1.0.6 App Store version.)
- Info.plist already has ATS arbitrary loads (IPTV is mostly http), background audio (PiP / AirPlay keep playing), local-network text, `ITSAppUsesNonExemptEncryption = false`.
- Icon is `store/master-icon.svg` rendered to 1024 px (same art as the Android icon).
- Raw MPEG-TS (`.ts`) does not play in iOS `<video>`; Xtream live already prefers `.m3u8` (`prefer-hls`). M3U playlists that only list `.ts` need an HLS link from the provider.
- **App Store screenshots** are in `store/ios-screenshots/` (6 screens each: home, live, search, player, Arabic, settings): `6.3/` 2622×1206 (the size App Store Connect requires now, "iPhone with Dynamic Island, medium display"; it is reused for every iPhone size), `6.9/` 2868×1320, `6.5/` 2778×1284, `ipad13/` 2752×2064 (required iPad 13" size). All landscape. They were made with headless Chrome (puppeteer) against the web app served locally, iPhone/iPad Safari user agent with touch, viewport 874×402 / 956×440 / 926×428 @3x and 1376×1032 @2x, signed in only with the free M3U https://iptv-org.github.io/iptv/index.m3u. On iPad the 16:9 stage is letterboxed (black bars top and bottom), same as the real app.
- Provider APIs/playlists are fetched from `capacitor://localhost`, so they need CORS like on Android (most Xtream panels send it).

**Sideload release:** run `gh release create vX.Y.Z KayanIPTV.apk`. The Downloader code **3617910** (https://aftv.news/3617910) points to `releases/latest/download/KayanIPTV.apk`, so a new release updates it automatically.

## Testing
- `node lg-iptv/service/guard.test.js` checks the helper token, CORS, and blocked targets.
- `node lg-iptv/js/privacy.test.js` checks the PIN hash and that a backup omits passwords and the PIN.
- Live and VOD still have to be played on the real TV after a helper change. Package `lg-iptv` together with `lg-iptv/service`.

## UI rules added in 1.0.6
- **Search is first** in the top menu (magnifier pill). It is not a landing section (`firstSection()` skips it).
- **Enter starts the search**: keyboard Enter, remote OK on the field, iOS/Android keyboard "Search"/"Go" (the field is `type=search`, `enterkeyhint=search`, inside a `<form>`; submit, Enter and `change` all search). Results get the focus.
- **Player controls** (`player.js`): auto-hide only while really playing (`mayAutoHide()`: not paused, failed, opening/buffering, scrubbing or in a drawer). Any key (except volume), mouse move, touch or click brings them back and restarts the timer. The pause card sits above the controls and never hides them. A finger tap on the picture toggles the controls; one tap that arrives as two clicks is ignored (`shownAt`). The control bars have `z-index: 10` above the video.
- **Android native player** (`NativePlayerActivity`): Media3 `PlayerView` controller is on (seek bar, ±10 s), shows on any remote key and on tap, hides after 4 s while playing, stays while paused.
- **Touch devices** (`html.touch`): an on-screen Back arrow appears in the top bar whenever there is a level to go back to (`App.canGoBack()`); the colour-button hints are hidden. iOS never shows the Exit dialog.

## Known issues / open work
- **Old webOS install:** `com.amrkz.lumioplayer` has been removed from Amr's TV (Nov 13, 2026). On any other TV remove it by hand; storage does not move to `com.amrkz.kayaniptv`. Do not rename the new id after the first Seller Lounge submission.
- **App Store review:** iOS 1.0.6 (8) was submitted on Nov 13, 2026 and is **Waiting for Review** (auto-release after approval). Check App Store Connect → Kayan IPTV → App Review for the result; if rejected, fix and resubmit from the version page.
- **Android on old WebViews** (for example a ClassPro TV): streams never started in the WebView ("slow internet"). Since 1.0.5 (code 6) the Android app hands every stream to a native Media3 ExoPlayer screen (`NativePlayerPlugin` + `NativePlayerActivity`, called from `startExo()` in `player.js`; it falls back to the page player only for a decoder/format failure). webOS and Tizen never see the plugin. Not yet confirmed on a real ClassPro box.
- **Play closed test:** blocked on reviewer sign-in details. The plan is to give reviewers the free playlist https://iptv-org.github.io/iptv/index.m3u.
- **Ads:** none yet. Advertising ID is declared as "No"; change that declaration before adding ads.

- iOS device install (2026-11-13): `KAYAN_DEVICE=<devicectl UDID> bash ios-app/build-mac.sh device` picks the phone (iPhone Ak = 33F8C86A-F768-58BB-88FB-E391331BD1C7). Device builds use /tmp/kayan-dd as derived data, because building under ~/Desktop fails codesign ("resource fork, Finder information... not allowed").
