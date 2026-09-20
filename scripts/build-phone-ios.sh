#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
npm run build:phone
mkdir -p phone-ios/Web
# Only the generated bundle directory is replaced.
rsync -a --delete companion-web/dist/ phone-ios/Web/
build_args=(-project phone-ios/BondimalsPhone.xcodeproj -scheme BondimalsPhone -configuration Debug -derivedDataPath phone-ios/DerivedData)
if [[ "${1:-}" == "--simulator" ]]; then
  build_args+=(-sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO)
else
  : "${BONDIMALS_DEVELOPMENT_TEAM:?Set BONDIMALS_DEVELOPMENT_TEAM to your Apple development team ID}"
  build_args+=(-destination 'generic/platform=iOS' -allowProvisioningUpdates "DEVELOPMENT_TEAM=$BONDIMALS_DEVELOPMENT_TEAM")
fi
build_args+=("BONDIMALS_SERVER_URL=${BONDIMALS_SERVER_URL:-}" "BONDIMALS_WEB_URL=${BONDIMALS_WEB_URL:-}" build)
xcodebuild "${build_args[@]}"
