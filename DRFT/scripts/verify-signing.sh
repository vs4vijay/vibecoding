#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config

case "${1:-}" in
  --expect-signed) expected=SIGNED ;;
  --expect-unsigned) expected=UNSIGNED ;;
  *) drft_die "usage: $0 {--expect-signed|--expect-unsigned}" ;;
esac
apksigner="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}/build-tools/${ANDROID_BUILD_TOOLS}/apksigner"
[ -x "$apksigner" ] || drft_die "apksigner not found for build-tools $ANDROID_BUILD_TOOLS"
mapfile -d '' apks < <(find "$DRFT_DIST_DIR" -type f -name '*.apk' -print0)
[ "${#apks[@]}" -gt 0 ] || drft_die "no APKs found in dist"
status_file="$DRFT_DIST_DIR/signing-status.txt"
: > "$status_file"
for apk in "${apks[@]}"; do
  actual=UNSIGNED
  if "$apksigner" verify "$apk" >/dev/null 2>&1; then actual=SIGNED; fi
  [ "$actual" = "$expected" ] || drft_die "expected $expected APK, found $actual: ${apk#"$DRFT_DIST_DIR"/}"
  printf '%s %s\n' "$actual" "${apk#"$DRFT_DIST_DIR"/}" >> "$status_file"
done
drft_log "Verified ${#apks[@]} APK signing state: $expected"
