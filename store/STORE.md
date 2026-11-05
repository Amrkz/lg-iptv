# LG Content Store Submission Plan

## Listing Metadata
- **App Name:** Kayan IPTV
- **Category:** Entertainment
- **Keywords:** iptv, player, streaming, m3u, xtream, live tv, arabic
- **Short Description:** A fast, lightweight IPTV player for your personal playlists.
- **Long Description:** A streamlined, responsive player for your personal IPTV subscriptions. Features include favorite channels, watch progress tracking, and recent channel history. Available in English and Arabic (العربية). Your data is stored locally on your device for maximum privacy. Note: This app does not include any media or playlists; you must provide your own content.

## Assets in this repository
- `store/master-icon.svg` — vector master of the icon.
- `store/store-icon-400.png` — 400x400 icon to upload at Seller Lounge.
- `lg-iptv/assets/icon.png` (80x80) and `lg-iptv/assets/largeIcon.png` (130x130) — referenced by `appinfo.json`.
- `PRIVACY.md` — the privacy policy. Its raw GitHub address can serve as the policy URL.
- `lg-iptv/assets/splash.png` — 1920x1080 splash, referenced by `splashBackground` in `appinfo.json`. The webOS simulator does not show it; check it on a real TV.

## User Supply Checklist (Required for Submission)
- [x] **App ID & Vendor:** done: `com.amrkz.lumioplayer` and `Amrkz` in `lg-iptv/appinfo.json`; the helper service id is `com.amrkz.lumioplayer.proxy` in `lg-iptv/service/services.json`. The app id cannot change after the first submission.
- [x] **Splash screen:** done (1920x1080 PNG, no text). Confirm it shows on a real TV.
- [ ] **Seller Lounge Account:** Registered and verified.
- [ ] **Self-checklist and UX scenario document:** filled in with real test results from a TV (the on-TV checklist is at the bottom of `PLAN.md`).
- [ ] **Test Account:** Active provider credentials for LG reviewers to test playback.
- [ ] **Screenshots:** Real screenshots of the app running on the webOS TV (1920x1080).
- [ ] **Privacy Policy URL:** Link to the raw `PRIVACY.md` on GitHub.

## Honest Risk Assessment
1. **Naming:** The app was renamed from "LG IPTV" (LG's trademarked name) to "Kayan IPTV". It has not been checked against the LG Content Store or trademark registers; search both for "Kayan" before the first submission. Do not use "LTV Player": it is the provider's own app name.
2. **Local Proxy Service:** The helper service (`lg-iptv/service/proxy.js`) runs on the TV and listens on `0.0.0.0:18491`. It re-fetches streams with a player identity ("LTVPlayer") because the provider answers the TV browser with HTTP 409. It serves only loopback and private network ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x) and refuses loopback targets. LG reviewers may still scrutinise or reject a background network proxy that changes request headers.
3. **General IPTV Policy:** The Content Store rules for IPTV players were not found in LG's public pages. The app has not been through LG's QA, and the latest player phases have not yet been checked on a real TV.
