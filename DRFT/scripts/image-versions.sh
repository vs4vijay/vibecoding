#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config
drft_check_jdk
drft_check_android_sdk
[ -s "${ANDROID_BUNDLETOOL_PATH:-}" ] || drft_die "bundletool is missing"
printf 'java=%s\ncompile_sdk=%s\ncompile_sdk_extension=%s\nbuild_tools=%s\nndk=%s\n' "$JDK_VERSION" "$ANDROID_COMPILE_SDK" "$ANDROID_COMPILE_SDK_EXTENSION" "$ANDROID_BUILD_TOOLS" "$ANDROID_NDK_VERSION"
