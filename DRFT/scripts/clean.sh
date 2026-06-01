#!/usr/bin/env bash
# Remove build artifacts.
#
#   --all     wipe build/ and dist/  (default)
#   --build   wipe build/ only       (keeps dist/, fastest force-rebuild)
#   --dist    wipe dist/ only

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config

TARGET="all"
[ $# -gt 0 ] && case "$1" in
  --all)   TARGET="all" ;;
  --build) TARGET="build" ;;
  --dist)  TARGET="dist" ;;
  -h|--help) sed -n '2,7p' "$0" >&2; exit 0 ;;
  *) drft_die "unknown argument: $1" ;;
esac

case "${TARGET}" in
  all)   rm -rf "${DRFT_BUILD_DIR}" "${DRFT_DIST_DIR}"; drft_log "removed build/ and dist/" ;;
  build) rm -rf "${DRFT_BUILD_DIR}";                    drft_log "removed build/" ;;
  dist)  rm -rf "${DRFT_DIST_DIR}";                     drft_log "removed dist/" ;;
esac
