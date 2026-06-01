#!/usr/bin/env bash
# Download and extract the pinned mozilla-firefox/firefox snapshot into
# build/firefox-src/. Idempotent: re-running is a no-op unless --force.
#
# Why GitHub tarball download (not git clone):
#   - The firefox repo has full mozilla-central history; a clone is many GB.
#     The codeload tarball is a single-commit snapshot, ~700MB compressed.
#   - Matches IronFox's approach, so source ingestion is consistent.
#   - No git metadata is needed: we apply patches with `patch -p1`, not git.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config
drft_check_host_basics

FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    -f|--force) FORCE=1 ;;
    -h|--help)
      cat >&2 <<EOF
Usage: $0 [--force]

Downloads mozilla-firefox/firefox at the pinned commit FIREFOX_REV
(${FIREFOX_REV:-unset}) into ${DRFT_SRC_DIR:-build/firefox-src}.

  --force    Re-download even if already extracted.
EOF
      exit 0 ;;
    *) drft_die "unknown argument: $1" ;;
  esac
  shift
done

STAMP="fetch-${FIREFOX_REV}"
if [ "${FORCE}" -eq 0 ] && drft_stamp_exists "${STAMP}"; then
  drft_log "Sources already at ${FIREFOX_REV} (stamp present). Use --force to re-fetch."
  exit 0
fi

# Clean slate when forcing or when the previous fetch was a different rev.
if [ -d "${DRFT_SRC_DIR}" ]; then
  drft_log "Removing stale source tree at ${DRFT_SRC_DIR}"
  rm -rf "${DRFT_SRC_DIR}"
fi
# Any stamp from a previous rev is now invalid.
rm -f "${DRFT_STAMP_DIR}"/fetch-* "${DRFT_STAMP_DIR}"/patches-applied 2>/dev/null || true

mkdir -p "${DRFT_BUILD_DIR}"

TARBALL_URL="https://codeload.github.com/${FIREFOX_REPO}/tar.gz/${FIREFOX_REV}"
TARBALL_PATH="${DRFT_BUILD_DIR}/firefox-${FIREFOX_REV}.tar.gz"

drft_section "Downloading firefox source @ ${FIREFOX_REV}"
drft_log "URL : ${TARBALL_URL}"
drft_log "Dest: ${TARBALL_PATH}"

# -L follow redirects (codeload redirects), --fail so HTTP errors bail.
# --retry handles transient network blips.
curl --fail --location --retry 3 --retry-delay 5 \
     --output "${TARBALL_PATH}.partial" \
     "${TARBALL_URL}"
mv "${TARBALL_PATH}.partial" "${TARBALL_PATH}"

drft_section "Extracting to ${DRFT_SRC_DIR}"
mkdir -p "${DRFT_SRC_DIR}"
# --strip-components=1 drops the top-level "firefox-<sha>/" directory so the
# tree lives directly under build/firefox-src/, making relative paths predictable.
tar -xzf "${TARBALL_PATH}" -C "${DRFT_SRC_DIR}" --strip-components=1

# Remove tarball to save disk; the stamp tells us we don't need to re-extract.
rm -f "${TARBALL_PATH}"

if [ ! -d "${DRFT_FOCUS_DIR}" ]; then
  drft_die "expected ${FOCUS_MODULE_PATH} not present in extracted tree"
fi

drft_stamp_set "${STAMP}"
drft_log "Sources ready at ${DRFT_SRC_DIR}"
