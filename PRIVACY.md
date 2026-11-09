# Privacy Policy — Kayan IPTV

**Last updated:** 9 November 2026  
**Developer:** Amr Kazzaz (Amrkz)  
**Contact:** amokazes@gmail.com  
**Apps:** Kayan IPTV on Android (phones, tablets, Android TV) and LG webOS TV.

Kayan IPTV is a **media player only**. It does not include, host, sell, or provide any TV channels, movies, series, or playlists. You supply your own M3U playlist or Xtream Codes login from a provider you choose.

## What we collect

We collect **nothing**.

- There are **no analytics**, crash reporters, advertising SDKs, or trackers in the app.
- No account with us is required. We do not operate a cloud backend for this app.
- The developer never receives your playlists, passwords, watch history, or device identifiers from the app.

## Data stored on your device

Everything the app remembers stays **only on your device** (local storage / app private storage):

- Playlist URL or Xtream server URL, username, and password that **you** enter. The password stays on the device because the player has to send it to your provider. It is not written into a settings backup.
- Favorites, recent / history items, watch progress
- Theme, language, player and download preferences
- Parental PIN, stored as a salted hash of the digits, not as the digits themselves. A settings backup does not include the PIN or the hash.
- Optionally, media files **you** choose to download for offline playback

A settings export is a code you can copy. It includes preferences and playlist names, and it leaves out Xtream passwords, playlist password parameters, and the parental PIN. An export made before 9 November 2026 may still contain a password; importing that older code can restore the login on this device, and the next export leaves the password out.

Uninstalling the app, or using Logout / Reset in Settings, removes this data from the device (downloaded files are removed when you delete them or uninstall). On Android, app data is not included in Android backup (`android:allowBackup` is false). Release builds do not enable WebView remote debugging.

## Network use

The app opens network connections only to:

1. **Your IPTV provider** — the server URL you configured (playlist, EPG, streams, poster URLs that appear in that provider’s lists).
2. **Poster / artwork hosts** named in those lists (images only).

On an LG webOS TV, a small helper runs **on the TV itself**. Some providers refuse the TV browser, so the helper fetches the stream and hands it to the player. It is not a cloud proxy, and the developer does not receive that traffic. Only this app can call the helper (a random token created on the TV, returned over the TV’s local service bus). The helper does not fetch loopback, link-local, or private LAN addresses. Its log on the TV masks usernames, passwords, and the token.

That helper does not verify TLS certificates. Many IPTV panels present a certificate that is self-signed, expired, or issued for a different name, and verifying it would stop playback. The connection between the TV and your provider is therefore not protected against someone on the network who can present a different certificate. Prefer a provider you reach over a network you trust.

On Android there is no helper. The app talks to your provider directly. Cleartext (HTTP) may be used when your provider’s server requires it; prefer HTTPS providers when available.

## Permissions (Android)

Typical permissions:

- **Internet** — reach your provider and load artwork
- **Network state** — detect connectivity
- **Wake lock** — keep playback from sleeping while you watch

No SMS, call log, contacts, precise location, microphone, or camera access is requested. Storage access, if used, is only for downloads you start inside the app.

## Children

The app is a general-purpose player. Parental PIN features are local device locks you configure; they are not a substitute for your provider’s content policies. Do not share adult-oriented playlists with children.

## Third parties

Google Play / device OEMs may process install and update data under their own policies. That is outside this app’s control.

## Changes

We may update this policy when the app changes. The “Last updated” date above will change. Continued use after an update means you accept the revised policy.

## Contact

Questions about privacy: **amokazes@gmail.com**
