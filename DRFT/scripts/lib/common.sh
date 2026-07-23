#!/usr/bin/env bash

[ -n "${DRFT_COMMON_SH_LOADED:-}" ] && return 0
DRFT_COMMON_SH_LOADED=1
set -euo pipefail

if [ -z "${BASH_VERSION:-}" ] || [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  printf '[DRFT ERR] Bash 4 or newer is required (found %s).\n' "${BASH_VERSION:-not Bash}" >&2
  exit 1
fi

DRFT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRFT_SCRIPTS_DIR="$(cd "${DRFT_LIB_DIR}/.." && pwd)"
DRFT_REPO_ROOT="${DRFT_REPO_ROOT_OVERRIDE:-$(cd "${DRFT_SCRIPTS_DIR}/.." && pwd)}"

drft_log() { printf '[DRFT] %s\n' "$*" >&2; }
drft_warn() { printf '[DRFT WARN] %s\n' "$*" >&2; }
drft_die() { printf '[DRFT ERR] %s\n' "$*" >&2; exit 1; }
drft_section() { printf '\n==> %s\n' "$*" >&2; }
drft_require_cmd() { command -v "$1" >/dev/null 2>&1 || drft_die "required command not found: $1"; }

drft_validate_config_file() {
  local file="$1" line number=0 assignment_re
  assignment_re='^[A-Z][A-Z0-9_]*=("[^"]*"|[A-Za-z0-9._:/@+-]+)$'
  [ -f "$file" ] || drft_die "configuration file not found: $file"
  while IFS= read -r line || [ -n "$line" ]; do
    number=$((number + 1))
    case "$line" in
      ''|'#'*) continue ;;
    esac
    if [[ ! "$line" =~ $assignment_re ]]; then
      drft_die "$file:$number: only simple KEY=value assignments are allowed"
    fi
  done < "$file"
}

drft_load_config() {
  local main_cfg="${DRFT_REPO_ROOT}/config/versions.env"
  local local_cfg="${DRFT_REPO_ROOT}/config/versions.local.env"
  drft_validate_config_file "$main_cfg"
  # shellcheck disable=SC1090
  source "$main_cfg"
  if [ -f "$local_cfg" ]; then
    drft_validate_config_file "$local_cfg"
    drft_log "Loading local overrides from config/versions.local.env"
    # shellcheck disable=SC1090
    source "$local_cfg"
  fi
  local key
  for key in FIREFOX_REPO FIREFOX_REV FIREFOX_TREE FIREFOX_VERSION FOCUS_MODULE_PATH DRFT_VARIANT JDK_VERSION ANDROID_COMPILE_SDK ANDROID_COMPILE_SDK_EXTENSION ANDROID_BUILD_TOOLS ANDROID_NDK_VERSION BUNDLETOOL_VERSION DRFT_BUILD_DIR_NAME DRFT_SRC_DIR_NAME DRFT_DIST_DIR_NAME DOCKER_BASE_IMAGE ANDROID_CMDLINE_TOOLS_VERSION DRFT_DOCKER_IMAGE; do
    [ -n "${!key:-}" ] || drft_die "required configuration key is missing or empty: $key"
  done
  [[ "$FIREFOX_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || drft_die "FIREFOX_REPO must be owner/repository"
  [[ "$FIREFOX_REV" =~ ^[0-9a-f]{40}$ ]] || drft_die "FIREFOX_REV must be a 40-character lowercase commit SHA"
  [[ "$JDK_VERSION" =~ ^[0-9]+$ ]] || drft_die "JDK_VERSION must be numeric"
  DRFT_BUILD_DIR="${DRFT_REPO_ROOT}/${DRFT_BUILD_DIR_NAME}"
  DRFT_SRC_DIR="${DRFT_BUILD_DIR}/${DRFT_SRC_DIR_NAME}"
  DRFT_DIST_DIR="${DRFT_REPO_ROOT}/${DRFT_DIST_DIR_NAME}"
  DRFT_FOCUS_DIR="${DRFT_SRC_DIR}/${FOCUS_MODULE_PATH}"
  DRFT_PATCHES_DIR="${DRFT_REPO_ROOT}/patches"
  DRFT_STATE_DIR="${DRFT_BUILD_DIR}/state"
  export DRFT_BUILD_DIR DRFT_SRC_DIR DRFT_DIST_DIR DRFT_FOCUS_DIR DRFT_PATCHES_DIR DRFT_STATE_DIR
}

drft_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

drft_check_host_basics() { drft_require_cmd curl; drft_require_cmd tar; drft_require_cmd patch; }
drft_check_jdk() {
  drft_require_cmd java
  local actual
  actual="$(java -version 2>&1 | awk -F'"' '/version/ {print $2}' | awk -F. '{print ($1 == 1 ? $2 : $1)}')"
  [ "$actual" = "$JDK_VERSION" ] || drft_die "JDK $JDK_VERSION is required; found $actual. Select the pinned builder image or correct JAVA_HOME."
}
drft_check_android_sdk() {
  : "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-}}"
  [ -n "$ANDROID_HOME" ] || drft_die "ANDROID_HOME or ANDROID_SDK_ROOT must be set"
  [ -d "$ANDROID_HOME" ] || drft_die "Android SDK directory does not exist: $ANDROID_HOME"
  [ -d "$ANDROID_HOME/platforms/android-${ANDROID_COMPILE_SDK}" ] || drft_die "missing Android platform android-${ANDROID_COMPILE_SDK}"
  [ -d "$ANDROID_HOME/platforms/android-${ANDROID_COMPILE_SDK_EXTENSION}" ] || drft_die "missing Android platform android-${ANDROID_COMPILE_SDK_EXTENSION}"
  [ -d "$ANDROID_HOME/build-tools/${ANDROID_BUILD_TOOLS}" ] || drft_die "missing Android build-tools ${ANDROID_BUILD_TOOLS}"
  [ -d "$ANDROID_HOME/ndk/${ANDROID_NDK_VERSION}" ] || drft_die "missing Android NDK ${ANDROID_NDK_VERSION}"
  export ANDROID_HOME
}

drft_atomic_write() { local target="$1"; local tmp="${target}.tmp.$$"; mkdir -p "$(dirname "$target")"; cat > "$tmp"; mv "$tmp" "$target"; }
