# Kayan IPTV — Google Play listing

**Package:** `com.amrkz.kayaniptv`  
**versionCode:** 4 · **versionName:** 1.0.3  
**Upload key alias:** `kayan` (keystore file `android-app/keystore/kayan-release.jks`, not in git; passwords in `android-app/keystore.properties` or `KAYAN_*` env vars)  
**Privacy policy URL:** https://amrkz.github.io/lg-iptv/  
**Fallback raw URL:** https://raw.githubusercontent.com/Amrkz/lg-iptv/main/PRIVACY.md

---

## English

### App name (30)
Kayan IPTV

### Short description (≤80)
Media player for your own M3U & Xtream playlists. No channels included.

### Full description (≤4000)
Kayan IPTV is a clean media player for Android phones, tablets, and Android TV. It does **not** include any TV channels, movies, or series. You bring your own playlist.

**What you get**
• Play M3U / M3U8 playlists and Xtream Codes accounts you already have  
• Browse Live TV, Movies, and Series from **your** provider  
• Favorites, Recent / History (grouped by series), Search  
• Downloads for VOD with free-space warnings before large saves  
• Live streams use a larger buffer (live TV cannot be “downloaded” as a file)  
• Full Control Center: playlists & accounts, player & buffering, subtitles & audio, parental PIN, appearance, downloads & storage, backup & reset  
• Seven themes: Default, Glass, Neo Brutalism, Bento Grid, Swiss, Claymorphism, Skeuomorphism  
• English and Arabic (RTL)  
• Leanback launcher support for Android TV remotes, plus touch for phones

**Important**
Kayan IPTV is a player only. We do not sell, host, or provide streams. You are responsible for using playlists and credentials you are allowed to use. The app talks only to the server you configure; there is no tracking and no ads.

**Need help?** amokazes@gmail.com

---

## Arabic / العربية

### اسم التطبيق
كيان IPTV

### وصف قصير (≤80)
مشغّل وسائط لقوائم M3U وXtream الخاصة بك. بلا قنوات مضمّنة.

### الوصف الكامل
كيان IPTV مشغّل وسائط لأجهزة أندرويد والهواتف وأندرويد TV. **لا يتضمّن** أي قنوات أو أفلام أو مسلسلات. أنت تزوّد التطبيق بقائمة التشغيل الخاصة بك.

**الميزات**
• تشغيل قوائم M3U/M3U8 وحسابات Xtream التي تملكها  
• تصفّح البث المباشر والأفلام والمسلسلات من مزوّدك  
• المفضّلة، الأخير/السجل (تجميع المسلسلات)، البحث  
• تنزيلات للفيديو حسب الطلب مع تحذير قبل امتلاء المساحة  
• مركز تحكم كامل: الحسابات، المشغّل، الترجمة والصوت، رمز أبوي، المظهر، التخزين، النسخ الاحتياطي  
• سبع سمات للواجهة  
• العربية والإنجليزية (دعم RTL)  
• دعم ريموت أندرويد TV واللمس على الهاتف

**مهم**
التطبيق مشغّل فقط. لا نبيع ولا نستضيف أي بث. أنت مسؤول عن استخدام قوائم وتشغيل مصرّح لك بها. لا تتبّع ولا إعلانات.

**للتواصل:** amokazes@gmail.com

---

## Data safety (Play Console answers)

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
| Is all user data encrypted in transit? | N/A (no developer collection). Connections to the user’s own provider may be HTTP or HTTPS depending on that provider. |
| Can users request data deletion? | Yes — Logout / Reset in Settings, or uninstall the app (data is only on-device). |
| Do you provide a privacy policy? | Yes — URL above |
| Data collected by the app / developer | None (no personal info, no financial, no location, no emails, no photos, no contacts, no app activity sent to us, no web browsing, no crash logs to us, no device IDs to us) |
| Data shared with third parties by us | None |
| Independent security review | No |

**Note for reviewers:** Credentials and watch history stay in app private storage on the device so the player can function. They are never transmitted to the developer.

---

## Content rating questionnaire notes

Suggested ratings path (IARC / Play questionnaire):

- **Category:** Utilities / Media & Video player (not a streaming service with catalog)
- **User-generated content?** No (users paste their own provider URL; not a social UGC feed)
- **Share location?** No  
- **Buy / in-app products?** No (unless you add them later)  
- **Personal info collected?** No  
- **Violence / sexual content / profanity from the app itself?** No — the app ships with **zero** media. Any mature material would come only from a playlist the user adds; the app does not promote it.  
- **Describe the app:** “Offline-capable IPTV/media *player*. No channels or VOD are bundled. Users must supply their own legal M3U or Xtream source.”

Expect rating roughly **PEGI 3 / ESRB Everyone** for the app binary itself; some questionnaires ask about possible third-party content — answer honestly that content depends on the user’s provider, and the app includes none.

---

## Store assets in this folder

| File | Spec |
|---|---|
| `icon-512.png` | 512×512 app icon |
| `feature-graphic-1024x500.png` | 1024×500 feature graphic |
| `tv-banner-1280x720.png` | 1280×720 Android TV banner |
| `screenshots/phone-*.png` | Phone (1080×1920 and 1920×1080) |
| `screenshots/tv-01-home-en.png` | TV 1920×1080 |
| `KayanIPTV-1.0.3.aab` | Signed release App Bundle (upload key) |

Screenshots use **generic placeholder titles only** (e.g. Northern Lights, Harbor Night). No copyrighted channel or studio names/logos.
