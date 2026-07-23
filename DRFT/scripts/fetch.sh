#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config

FORCE=0 KEEP_ARCHIVE="${DRFT_KEEP_SOURCE_ARCHIVE:-0}"
while [ $# -gt 0 ]; do
  case "$1" in
    -f|--force) FORCE=1 ;;
    --keep-archive) KEEP_ARCHIVE=1 ;;
    -h|--help) printf 'Usage: %s [--force] [--keep-archive]\n' "$0"; exit 0 ;;
    *) drft_die "unknown argument: $1" ;;
  esac
  shift
done
drft_check_host_basics

MANIFEST="${DRFT_STATE_DIR}/source.env"
source_valid() {
  [ -f "$MANIFEST" ] && [ -d "$DRFT_FOCUS_DIR" ] || return 1
  local manifest_repo='' manifest_rev='' manifest_complete='' manifest_vcs=''
  # shellcheck disable=SC1090
  source "$MANIFEST"
  [ "${manifest_repo:-}" = "$FIREFOX_REPO" ] && [ "${manifest_rev:-}" = "$FIREFOX_REV" ] && [ "${manifest_complete:-}" = 1 ] && {
    [ -n "${DRFT_SOURCE_ARCHIVE:-}" ] || { [ "${manifest_vcs:-}" = 1 ] && [ -d "$DRFT_SRC_DIR/.git" ]; }
  }
}
if [ "$FORCE" -eq 0 ] && source_valid; then drft_log "Reusing verified Firefox source at $FIREFOX_REV"; exit 0; fi

drft_require_cmd curl
drft_require_cmd tar
drft_require_cmd git
mkdir -p "$DRFT_BUILD_DIR" "$DRFT_STATE_DIR"
archive="${DRFT_BUILD_DIR}/firefox-${FIREFOX_REV}.tar.gz"
partial="${archive}.partial"
extract="${DRFT_BUILD_DIR}/.${DRFT_SRC_DIR_NAME}.extracting.$$"
trap 'rm -f "$partial"; rm -rf "$extract"' EXIT
rm -f "$MANIFEST"
rm -f "${DRFT_STATE_DIR}/patches.env"
rm -rf "$DRFT_SRC_DIR" "$extract"

if [ ! -s "$archive" ]; then
  drft_section "Downloading Firefox $FIREFOX_REV"
  if [ -n "${DRFT_SOURCE_ARCHIVE:-}" ]; then
    [ -s "$DRFT_SOURCE_ARCHIVE" ] || drft_die "DRFT_SOURCE_ARCHIVE does not exist or is empty: $DRFT_SOURCE_ARCHIVE"
    cp "$DRFT_SOURCE_ARCHIVE" "$partial"
  else
    curl --fail --location --retry 3 --retry-delay 5 --output "$partial" "${DRFT_SOURCE_URL:-https://codeload.github.com/${FIREFOX_REPO}/tar.gz/${FIREFOX_REV}}"
  fi
  mv "$partial" "$archive"
fi
mkdir -p "$extract"
tar -xzf "$archive" -C "$extract" --strip-components=1
[ -d "$extract/$FOCUS_MODULE_PATH" ] || drft_die "archive does not contain FOCUS_MODULE_PATH: $FOCUS_MODULE_PATH"
mv "$extract" "$DRFT_SRC_DIR"
manifest_vcs=0
if [ -z "${DRFT_SOURCE_ARCHIVE:-}" ]; then
  drft_section "Attaching blobless metadata for Firefox $FIREFOX_REV"
  git -C "$DRFT_SRC_DIR" init --initial-branch=drft-source
  git -C "$DRFT_SRC_DIR" remote add origin "https://github.com/${FIREFOX_REPO}.git"
  git -C "$DRFT_SRC_DIR" fetch --filter=blob:none --no-tags --depth=1 origin "$FIREFOX_REV"
  git -C "$DRFT_SRC_DIR" update-ref refs/heads/drft-source FETCH_HEAD
  manifest_vcs=1
fi
drft_atomic_write "$MANIFEST" <<EOF
manifest_repo='$FIREFOX_REPO'
manifest_rev='$FIREFOX_REV'
manifest_focus_path='$FOCUS_MODULE_PATH'
manifest_vcs=$manifest_vcs
manifest_complete=1
EOF
[ "$KEEP_ARCHIVE" = 1 ] || rm -f "$archive"
trap - EXIT
drft_log "Verified source ready at $DRFT_SRC_DIR"
