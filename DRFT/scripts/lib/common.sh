#!/usr/bin/env bash
# Shared helpers sourced by every DRFT script.
# POSIX-leaning bash 4+. Idempotent — safe to source multiple times.

# Guard against double-source.
[ -n "${DRFT_COMMON_SH_LOADED:-}" ] && return 0
DRFT_COMMON_SH_LOADED=1

set -euo pipefail

# ---- Paths ----------------------------------------------------------------
# Resolve repo root from this file's location: scripts/lib/common.sh -> ../..
DRFT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRFT_SCRIPTS_DIR="$(cd "${DRFT_LIB_DIR}/.." && pwd)"
DRFT_REPO_ROOT="$(cd "${DRFT_SCRIPTS_DIR}/.." && pwd)"

# ---- Config loading -------------------------------------------------------
# Load config/versions.env, then config/versions.local.env if present.
# Both files are KEY=VALUE lines, no shell features. We `source` them after
# verifying they contain only assignments so we get the values into the env.
drft_load_config() {
  local main_cfg="${DRFT_REPO_ROOT}/config/versions.env"
  local local_cfg="${DRFT_REPO_ROOT}/config/versions.local.env"

  if [ ! -f "${main_cfg}" ]; then
    drft_die "config/versions.env not found at ${main_cfg}"
  fi
  # shellcheck disable=SC1090
  source "${main_cfg}"

  if [ -f "${local_cfg}" ]; then
    drft_log "Loading local overrides from config/versions.local.env"
    # shellcheck disable=SC1090
    source "${local_cfg}"
  fi

  # Derived paths.
  DRFT_BUILD_DIR="${DRFT_REPO_ROOT}/${DRFT_BUILD_DIR_NAME}"
  DRFT_SRC_DIR="${DRFT_BUILD_DIR}/${DRFT_SRC_DIR_NAME}"
  DRFT_DIST_DIR="${DRFT_REPO_ROOT}/${DRFT_DIST_DIR_NAME}"
  DRFT_FOCUS_DIR="${DRFT_SRC_DIR}/${FOCUS_MODULE_PATH}"
  DRFT_PATCHES_DIR="${DRFT_REPO_ROOT}/patches"
  DRFT_STAMP_DIR="${DRFT_BUILD_DIR}/.stamps"

  export DRFT_BUILD_DIR DRFT_SRC_DIR DRFT_DIST_DIR DRFT_FOCUS_DIR \
         DRFT_PATCHES_DIR DRFT_STAMP_DIR
}

# ---- Logging --------------------------------------------------------------
# Use stderr so script output (APK paths etc.) can be cleanly piped.
drft_log()  { printf '\033[1;34m[DRFT]\033[0m %s\n' "$*" >&2; }
drft_warn() { printf '\033[1;33m[DRFT WARN]\033[0m %s\n' "$*" >&2; }
drft_die()  { printf '\033[1;31m[DRFT ERR]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- Tool checks ----------------------------------------------------------
drft_require_cmd() {
  command -v "$1" >/dev/null 2>&1 || drft_die "required command not found: $1"
}

# Verify minimal host toolchain. JDK & Android SDK are checked separately
# inside the build step because some scripts (fetch, patch) don't need them.
# python3 is not checked here: Glean (a gradle plugin used deep inside the
# Focus build) needs it, but flagging it upfront leads to false negatives on
# Windows where Python often ships as `py -3` rather than `python3`. The
# gradle build itself produces a clearer error if it's actually missing.
drft_check_host_basics() {
  drft_require_cmd curl
  drft_require_cmd tar
  drft_require_cmd patch
}

# Verify Java is reachable and matches the pinned major version.
drft_check_jdk() {
  drft_require_cmd java
  local actual_major
  actual_major="$(java -version 2>&1 | awk -F'"' '/version/ {print $2}' \
                 | awk -F'.' '{ if ($1 == "1") print $2; else print $1 }')"
  if [ "${actual_major}" != "${JDK_VERSION}" ]; then
    drft_warn "JDK major version is ${actual_major}, expected ${JDK_VERSION}."
    drft_warn "Build may fail or behave differently than CI. Set JAVA_HOME accordingly."
  fi
}

# Verify Android SDK env. Accepts ANDROID_HOME or ANDROID_SDK_ROOT.
drft_check_android_sdk() {
  if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ]; then
    drft_die "ANDROID_HOME (or ANDROID_SDK_ROOT) not set. Install Android SDK first."
  fi
  : "${ANDROID_HOME:=${ANDROID_SDK_ROOT}}"
  export ANDROID_HOME
  if [ ! -d "${ANDROID_HOME}" ]; then
    drft_die "ANDROID_HOME points to a non-existent directory: ${ANDROID_HOME}"
  fi
}

# ---- Stamp helpers --------------------------------------------------------
# Stamps record completion of a long step so we can skip on re-runs.
drft_stamp_path()  { echo "${DRFT_STAMP_DIR}/$1"; }
drft_stamp_exists() { [ -f "$(drft_stamp_path "$1")" ]; }
drft_stamp_set()   { mkdir -p "${DRFT_STAMP_DIR}"; touch "$(drft_stamp_path "$1")"; }
drft_stamp_clear() { rm -f "$(drft_stamp_path "$1")"; }

# ---- Misc -----------------------------------------------------------------
# Print a section header for readability.
drft_section() {
  printf '\n\033[1;36m==> %s\033[0m\n' "$*" >&2
}
