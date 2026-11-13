#!/bin/bash
# Kayan IPTV for iPhone / iPad — one command on the Mac:
#   cd ~/Developer/lg-iptv-github && git pull && bash ios-app/build-mac.sh [sim|device|archive|all]
# sim     = build for the iOS Simulator (no signing)
# device  = build + install on a connected / paired iPhone (automatic signing)
# archive = signed .xcarchive in ~/Desktop/KayanIPTV-ios (ready for Xcode Organizer → TestFlight)
# all     = sim, then archive, then device (default)
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-all}"
PROJ=ios/App/App.xcodeproj
OUT="$HOME/Desktop/KayanIPTV-ios"
mkdir -p "$OUT"

echo "== web app + Capacitor =="
npm install --no-audit --no-fund
node scripts/copy-web.js
npx cap sync ios

# Apple team: $KAYAN_TEAM, then Distribution certificate, then Development certificate
TEAM="${KAYAN_TEAM:-}"
if [ -z "$TEAM" ]; then
  for name in "Apple Distribution" "Apple Development" "iPhone Developer"; do
    TEAM=$(security find-certificate -a -c "$name" -p 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | head -1 || true)
    [ -n "$TEAM" ] && break
  done
fi
echo "Apple team: ${TEAM:-<none found>}"

sim() {
  echo "== Simulator build =="
  xcodebuild -project "$PROJ" -scheme App -configuration Debug -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$OUT/dd-sim" \
    CODE_SIGNING_ALLOWED=NO build | tail -5
  echo "Simulator app: $OUT/dd-sim/Build/Products/Debug-iphonesimulator/App.app"
}
archive() {
  [ -n "$TEAM" ] || { echo "No Apple team found. Open Xcode > Settings > Accounts, sign in, then rerun (or KAYAN_TEAM=XXXXXXXXXX)."; return 1; }
  echo "== Signed archive (team $TEAM) =="
  xcodebuild -project "$PROJ" -scheme App -configuration Release -destination 'generic/platform=iOS' \
    -archivePath "$OUT/KayanIPTV.xcarchive" -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic archive | tail -5
  echo "Archive: $OUT/KayanIPTV.xcarchive"
  cp ExportOptions.plist "$OUT/ExportOptions.plist"
  cp STORE.md "$OUT/AppStore-listing.md"
  xcodebuild -exportArchive -archivePath "$OUT/KayanIPTV.xcarchive" \
    -exportOptionsPlist ExportOptions.plist -exportPath "$OUT" -allowProvisioningUpdates | tail -5
  echo "IPA exported (NOT uploaded): $OUT"
}
device() {
  [ -n "$TEAM" ] || { echo "No Apple team found."; return 1; }
  echo "== Device build =="
  xcodebuild -project "$PROJ" -scheme App -configuration Release -destination 'generic/platform=iOS' \
    -derivedDataPath "$OUT/dd-dev" -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic build | tail -5
  APP="$OUT/dd-dev/Build/Products/Release-iphoneos/App.app"
  DEV=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone|iPad/ && /available|connected/ {for(i=1;i<=NF;i++) if ($i ~ /^[0-9A-F-]{25,}$/) {print $i; exit}}' || true)
  if [ -n "$DEV" ]; then
    xcrun devicectl device install app --device "$DEV" "$APP" && xcrun devicectl device process launch --device "$DEV" com.amrkz.kayaniptv || true
  else
    echo "No paired iPhone found; app built at $APP"
  fi
}
case "$MODE" in
  sim) sim ;;
  archive) archive ;;
  device) device ;;
  all) sim; archive || true; device || true ;;
  *) echo "usage: $0 [sim|device|archive|all]"; exit 2 ;;
esac
