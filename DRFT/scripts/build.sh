#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config

VARIANT="$DRFT_VARIANT" EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) printf 'Usage: %s [focusDebug|focusRelease|focusBeta|focusNightly|klarDebug|klarRelease|klarBeta|klarNightly] [-- gradle-args]\n' "$0"; exit 0 ;;
    --) shift; EXTRA=("$@"); break ;;
    -*) drft_die "unknown flag: $1" ;;
    *) VARIANT="$1" ;;
  esac
  shift
done
case "$VARIANT" in focusDebug|focusRelease|focusBeta|focusNightly|klarDebug|klarRelease|klarBeta|klarNightly) ;; *) drft_die "unsupported variant: $VARIANT" ;; esac
[ -d "$DRFT_FOCUS_DIR" ] || drft_die "source tree not prepared"
[ -f "$DRFT_STATE_DIR/patches.env" ] || drft_die "patch state missing; run scripts/patch.sh"
drft_check_host_basics; drft_check_jdk; drft_check_android_sdk
for tool in git unzip zip; do drft_require_cmd "$tool"; done
available_kb="$(df -Pk "$DRFT_BUILD_DIR" | awk 'NR==2 {print $4}')"
[ "$available_kb" -ge "${DRFT_MIN_DISK_KB:-5242880}" ] || drft_die "at least 5 GiB free disk is required"

task="focus-android:assemble${VARIANT^}"
mozconfig="$DRFT_BUILD_DIR/mozconfig"
objdir="$DRFT_BUILD_DIR/obj-android"
drft_atomic_write "$mozconfig" <<EOF
ac_add_options --enable-application=mobile/android
ac_add_options --enable-artifact-builds
ac_add_options --enable-bootstrap=embedded-uniffi-bindgen,nimbus-fml
ac_add_options --target=aarch64-linux-android
ac_add_options --with-android-sdk="$ANDROID_HOME"
ac_add_options --with-java-bin-path="$JAVA_HOME/bin"
mk_add_options MOZ_OBJDIR="$objdir"
EOF
export MOZCONFIG="$mozconfig"
[ -x "$DRFT_SRC_DIR/mach" ] || chmod +x "$DRFT_SRC_DIR/mach"
if [ ! -f "$objdir/config.status.json" ]; then
  drft_section "Configuring Mozilla Android artifact build"
  (cd "$DRFT_SRC_DIR" && ./mach configure)
fi
drft_section "Installing pinned Mozilla build artifacts"
(cd "$DRFT_SRC_DIR" && ./mach artifact install --no-tests --tree "$FIREFOX_TREE")
drft_section "Generating Mozilla pre-export build inputs"
(cd "$DRFT_SRC_DIR" && ./mach build pre-export)
output="$objdir/gradle/build/mobile/android/focus-android/app/outputs/apk"
rm -rf "$DRFT_DIST_DIR"
mkdir -p "$DRFT_DIST_DIR"
daemon=--no-daemon; [ "${DRFT_USE_GRADLE_DAEMON:-0}" = 1 ] && daemon=''
(cd "$DRFT_SRC_DIR" && ./mach gradle ${daemon:+$daemon} --stacktrace "$task" "${EXTRA[@]}")

count=0 manifest="$DRFT_DIST_DIR/build-manifest.txt"
{
  printf 'firefox_repo=%s\nfirefox_rev=%s\nvariant=%s\nbuilt_at=%s\n' "$FIREFOX_REPO" "$FIREFOX_REV" "$VARIANT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  while IFS= read -r -d '' apk; do
    rel="${apk#"${output}"/}"; dest="$DRFT_DIST_DIR/$rel"; mkdir -p "$(dirname "$dest")"; cp "$apk" "$dest"
    [ -s "$dest" ] || drft_die "empty APK produced: $rel"
    printf 'apk=%s sha256=%s\n' "$rel" "$(drft_sha256 "$dest")"
    count=$((count + 1))
  done < <(find "$output" -type f -name '*arm64-v8a*.apk' -print0 2>/dev/null)
} > "$manifest"
[ "$count" -gt 0 ] || drft_die "no APKs produced for $VARIANT"
drft_log "$count APK(s) and build manifest staged in dist/"
