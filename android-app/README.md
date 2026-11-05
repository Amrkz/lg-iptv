# Kayan IPTV — Android

Capacitor 7 wrapper around the Kayan IPTV web app (`lg-iptv/`).

- Package: `com.amrkz.kayaniptv`
- Targets: phones (touch) + Android TV (leanback launcher)
- Output: `KayanIPTV.apk` (signed with `keystore/kayan-release.jks`)

## Build

```bash
export JAVA_HOME=/path/to/jdk-21
export ANDROID_HOME=/path/to/Android/Sdk
npm install
node scripts/copy-web.js
npx cap sync android
cd android && ./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../KayanIPTV.apk
```

## Notes

- webOS Node service (image cache / downloads proxy) is not bundled. On Android, downloads use Capacitor Filesystem; images load directly from the provider.
- Cleartext HTTP streams are allowed (`network_security_config`).
- Live channels prefer HLS (`.m3u8`) for WebView + hls.js.
- Keystore passwords are in `android/app/build.gradle` for local sideload — change before a store release.
