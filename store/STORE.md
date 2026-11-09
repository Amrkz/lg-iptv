# LG Content Store — what is ready, and what is still yours

App id `com.amrkz.kayaniptv` (helper `com.amrkz.kayaniptv.proxy`). The id cannot change after the first Seller Lounge submission. Version in `lg-iptv/appinfo.json` is `1.0.0`, so the package name is `com.amrkz.kayaniptv_1.0.0_all.ipk`.

If `com.amrkz.lumioplayer` is still on the TV, uninstall it by hand before testing this package. Saved logins, the PIN, and downloads stay with the old app.

Text to paste (English and Arabic descriptions, and 1.0.0 release notes) is in [`LISTING.md`](LISTING.md).

## Ready in this repository

| Item | Where | Size / note |
|---|---|---|
| App id, vendor, title | `lg-iptv/appinfo.json` | `com.amrkz.kayaniptv`, Amrkz, "Kayan IPTV" |
| In-package tagline | `appinfo.json` `appDescription` | 57 characters (limit 60) |
| Test icon | `lg-iptv/assets/icon.png` | 80×80 PNG. Used while testing, not as the store icon |
| Large test icon | `lg-iptv/assets/largeIcon.png` | 130×130 PNG |
| Store icon | `store/store-icon-400.png` | 400×400. Every pixel is opaque. The file is still saved as RGBA; if Seller Lounge rejects an alpha channel, re-save it as RGB. Tile color `#0c0c0e` |
| Icon master | `store/master-icon.svg` | Source drawing |
| Splash | `lg-iptv/assets/splash.png` | 1920×1080 RGB PNG, no text. Confirm it actually shows on a TV |
| Launcher background | `lg-iptv/assets/bg.png` | 1920×1080. webOS 3 and later ignore `bgImage`; the splash is the one that matters |
| Store description and release notes | `store/LISTING.md` | English and Arabic. English description is 1165 characters (Seller Lounge allows 50–4000) |
| Privacy policy text | `PRIVACY.md` | Must be updated on the URL you submit. It is not live until this is published |

## Still needed before Seller Lounge will accept it

These are not in the repo. LG's approval page requires the UX scenario and the self-checklist as uploads, from their own templates.

- [ ] **Seller Lounge account** registered and verified.
- [ ] **Package upload:** `ares-package lg-iptv lg-iptv/service`, then upload `com.amrkz.kayaniptv_1.0.0_all.ipk`. The helper has to be inside the package.
- [ ] **Store icon upload:** `store/store-icon-400.png`, and tile color `#0c0c0e`.
- [ ] **Screenshots:** none yet. Capture the real app on the TV at 1920×1080 (sign-in, Live, a film or series, player). Do not submit desktop mockups.
- [ ] **Paste the listing:** title, description, and release notes from `store/LISTING.md`. Add Arabic if you submit an Arabic locale. Keywords already drafted below.
- [ ] **Privacy policy URL:** a public page that serves this `PRIVACY.md` after it is merged. `https://raw.githubusercontent.com/Amrkz/lg-iptv/main/PRIVACY.md` updates only after merge. If `https://amrkz.github.io/lg-iptv/` is a separate copy, update that copy too.
- [ ] **Test account for LG QA:** a working Xtream login, or the free playlist `https://iptv-org.github.io/iptv/index.m3u`, plus the steps: sign in, play a live channel, play a film. Without this, playback QA fails.
- [ ] **UX scenario:** download LG's template from Seller Lounge and fill it from a real remote pass (sign-in, live zap, film, Back, Arabic).
- [ ] **Self-checklist:** download LG's checklist and fill it with results from the TV. LG rejects the app if this form is missing or thin.
- [ ] **Content rating, countries, and category** (Entertainment) chosen in the form.
- [ ] **Name check:** search the Content Store and trademark registers for "Kayan" before submitting. Do not use "LTV Player"; that is a provider's app name.
- [ ] **Splash on a real TV:** the file is the right size; the simulator does not show it.

### Keywords (draft)

iptv, player, streaming, m3u, xtream, live tv, arabic

## Risks LG may still reject

1. **Local helper.** `lg-iptv/service/proxy.js` runs on the TV and listens on port `18491` (the TV's LAN address and loopback, or `0.0.0.0` only if no LAN address is reported). It re-fetches streams as "LTVPlayer" because some providers answer the TV browser with HTTP 409. Each install has a random token, returned only on the Luna bus. Upstream fetches to loopback, link-local, and private LAN addresses are refused. Reviewers may still question a background helper that changes request headers.
2. **IPTV policy.** A public Content Store rule for IPTV players was not found. The app has not been through LG QA, and this package has not been played on the TV yet.
3. **Old id.** Shipping `com.amrkz.lumioplayer` now would lock the wrong name. This tree uses `com.amrkz.kayaniptv`.
