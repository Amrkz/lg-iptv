# Kayan IPTV — Android

Capacitor 7 wrapper around the Kayan IPTV web app (`lg-iptv/`, the sibling of this folder). This is the Android project for the repo.

- Package: `com.amrkz.kayaniptv`
- JDK: **21** (Capacitor 7 and Android Gradle Plugin 8.7). JDK 17 does not build this project.
- Targets: phones (touch) + Android TV (leanback launcher)
- Keystore: `android-app/keystore/kayan-release.jks` (not in git; alias `kayan`)
- Passwords: `android-app/keystore.properties` (gitignored; copy `keystore.properties.example`) or `KAYAN_STORE_FILE`, `KAYAN_STORE_PASSWORD`, `KAYAN_KEY_ALIAS`, `KAYAN_KEY_PASSWORD`

## Debug build

Debug uses the Android debug keystore. It does not need `keystore.properties`.

```bash
export JAVA_HOME=/path/to/jdk-21
export ANDROID_HOME=/path/to/Android/Sdk
npm install
node scripts/copy-web.js
npx cap sync android
cd android && ./gradlew assembleDebug
```

`scripts/copy-web.js` copies `../lg-iptv` into `www/`.

## Release build

```bash
cp keystore.properties.example keystore.properties
# fill storePassword and keyPassword, then:
cd android && ./gradlew bundleRelease assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../KayanIPTV.apk
```

Bump `versionCode` and `versionName` in `android/app/build.gradle` before a Play upload. Do not put the passwords back in that file. The previous password is still in git history; rotating the key is a separate decision and is not done here.

Check the APK with `apksigner verify` (`$JAVA_HOME/bin` on `PATH`).

## Notes

- The webOS helper (`lg-iptv/service/`) is not bundled. On Android, downloads use Capacitor Filesystem; images load directly from the provider.
- Cleartext HTTP streams are allowed (`network_security_config`).
- Live channels prefer HLS (`.m3u8`) for WebView + hls.js.
- `android:allowBackup` is false, so Android backup does not copy app data.
- WebView remote debugging is off (`webContentsDebuggingEnabled` is false, and release builds force it off in `MainActivity`).
- Do not upload to the Play **Production** track unless the owner asks. Closed testing uses the Alpha track.
