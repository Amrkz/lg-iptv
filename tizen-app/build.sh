#!/bin/bash
# Build Kayan IPTV for Samsung TV (Tizen). Needs Tizen Studio CLI + a Samsung certificate profile.
# Usage: ./build.sh [profile]   then: tizen install -n KayanIPTV.wgt -t <tv>
set -e
cd "$(dirname "$0")"
rm -rf build && mkdir build
cp -R ../lg-iptv/index.html ../lg-iptv/css ../lg-iptv/js ../lg-iptv/lib ../lg-iptv/assets build/
cp config.xml build/
tizen build-web -- build
tizen package -t wgt -s "${1:-kayan}" -- build/.buildResult
mv build/.buildResult/*.wgt ./KayanIPTV.wgt && echo "Built KayanIPTV.wgt"
