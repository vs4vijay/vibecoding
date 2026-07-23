#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config
drft_require_cmd unzip
manifest="${1:-${DRFT_DIST_DIR}/build-manifest.txt}"
[ -f "$manifest" ] || drft_die "build manifest missing: $manifest"
expected_rev="$(awk -F= '$1=="firefox_rev" {print $2}' "$manifest")"
variant="$(awk -F= '$1=="variant" {print $2}' "$manifest")"
[ "$expected_rev" = "$FIREFOX_REV" ] || drft_die "artifact revision does not match configuration"
case "$variant" in focusDebug|focusRelease|focusBeta|focusNightly|klarDebug|klarRelease|klarBeta|klarNightly) ;; *) drft_die "manifest has invalid variant: $variant" ;; esac
count=0
while read -r path checksum; do
  path="${path#apk=}"; checksum="${checksum#sha256=}"
  apk="$DRFT_DIST_DIR/$path"; [ -s "$apk" ] || drft_die "manifest APK missing or empty: $path"
  [ "$(drft_sha256 "$apk")" = "$checksum" ] || drft_die "checksum mismatch: $path"
  entries="$(unzip -Z1 "$apk")"
  grep -qx 'AndroidManifest.xml' <<<"$entries" || drft_die "APK lacks AndroidManifest.xml: $path"
  grep -qx 'classes.dex' <<<"$entries" || drft_die "APK lacks classes.dex: $path"
  grep -Eq '^lib/[^/]+/libxul\.so$' <<<"$entries" || drft_die "APK lacks Gecko libxul.so: $path"
  grep -Eq '^lib/[^/]+/libmozglue\.so$' <<<"$entries" || drft_die "APK lacks Gecko libmozglue.so: $path"
  if [ -x "${ANDROID_HOME:-}/build-tools/${ANDROID_BUILD_TOOLS}/aapt" ]; then "${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS}/aapt" dump badging "$apk" >/dev/null; fi
  count=$((count + 1))
done < <(awk '/^apk=/ {print $1, $2}' "$manifest")
[ "$count" -gt 0 ] || drft_die "manifest contains no APKs"
extra="$(find "$DRFT_DIST_DIR" -type f ! -name 'build-manifest.txt' ! -name '*.apk' -print -quit)"
[ -z "$extra" ] || drft_die "unexpected artifact in dist: $extra"
drft_log "Verified $count APK(s) for $variant at $expected_rev"
