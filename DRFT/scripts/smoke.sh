#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config
drft_require_cmd adb
serial="${ANDROID_SERIAL:-}"; package="${DRFT_PACKAGE_ID:-org.mozilla.focus}"
[ -n "$serial" ] || { mapfile -t d < <(adb devices | awk 'NR>1 && $2=="device" {print $1}'); [ "${#d[@]}" -eq 1 ] || drft_die "set ANDROID_SERIAL when zero or multiple devices are attached"; serial="${d[0]}"; }
log="${DRFT_BUILD_DIR}/smoke-${serial//[^A-Za-z0-9_.-]/_}.log"; mkdir -p "$DRFT_BUILD_DIR"
adb -s "$serial" logcat -c
if ! adb -s "$serial" shell monkey -p "$package" -c android.intent.category.LAUNCHER 1 >/dev/null; then adb -s "$serial" logcat -d > "$log"; drft_die "activity launch failed; logs: $log"; fi
for _ in 1 2 3 4 5 6 7 8 9 10; do pid="$(adb -s "$serial" shell pidof "$package" | tr -d '\r')"; [ -n "$pid" ] && break; sleep 1; done
if [ -z "${pid:-}" ]; then adb -s "$serial" logcat -d > "$log"; drft_die "process did not remain alive; logs: $log"; fi
if adb -s "$serial" logcat -d | grep -E "FATAL EXCEPTION|Process ${package}.*has died" > "$log"; then drft_die "runtime crash detected; logs: $log"; fi
rm -f "$log"; drft_log "$package launched and remained alive (pid $pid)"
