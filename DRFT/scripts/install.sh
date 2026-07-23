#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config
drft_require_cmd adb
apk="${1:-}"; serial="${ANDROID_SERIAL:-}"
[ -n "$apk" ] || drft_die "usage: $0 <apk> (an explicit APK is required)"
[ -s "$apk" ] || drft_die "APK does not exist or is empty: $apk"
mapfile -t devices < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')
if [ -z "$serial" ]; then [ "${#devices[@]}" -eq 1 ] || drft_die "expected exactly one authorized online device; found ${#devices[@]}. Set ANDROID_SERIAL."; serial="${devices[0]}"; fi
state="$(adb -s "$serial" get-state 2>/dev/null || true)"; [ "$state" = device ] || drft_die "device $serial is offline or unauthorized"
device_abi="$(adb -s "$serial" shell getprop ro.product.cpu.abi | tr -d '\r')"
case "$(basename "$apk")" in *arm64-v8a*) [[ "$device_abi" == arm64-v8a* ]] || drft_die "APK ABI arm64-v8a is incompatible with $device_abi" ;; *armeabi-v7a*) [[ "$device_abi" == armeabi-v7a* || "$device_abi" == arm64-v8a* ]] || drft_die "APK ABI is incompatible with $device_abi" ;; *x86_64*) [[ "$device_abi" == x86_64* ]] || drft_die "APK ABI x86_64 is incompatible with $device_abi" ;; esac
adb -s "$serial" install -r "$apk"
drft_log "Installed $(basename "$apk") on $serial ($device_abi)"
